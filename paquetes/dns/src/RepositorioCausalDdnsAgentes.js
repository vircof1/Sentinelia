import { timingSafeEqual } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';

export class ErrorRepositorioCausalDdns extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = 'ErrorRepositorioCausalDdns';
    this.codigo = codigo;
  }
}

export class RepositorioCausalDdnsAgentes {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new TypeError('El repositorio causal DDNS requiere un cliente SQL operativo.');
    }
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
  }

  async ejecutarConFotografiaBloqueada(argumentos, trabajo) {
    if (typeof trabajo !== 'function') {
      throw new TypeError('La operación causal DDNS requiere un trabajo transaccional.');
    }
    return this.frontera.ejecutar(async (conexion) => {
      const fotografia = await this.bloquearFotografiaEnTransaccion(
        argumentos,
        { conexion }
      );
      return trabajo({ conexion, fotografia });
    });
  }

  async bloquearFotografiaEnTransaccion(
    { concesionId, agenteId, solicitudId = null },
    { conexion }
  ) {
    validarConexion(conexion);
    const agente = idPositivo(agenteId, 'agenteId');
    const [concesiones] = await conexion.execute(
      `SELECT id,concesion_id,agente_id,registro_dns_id,
              agente_id_fotografia,registro_dns_id_fotografia,estado,
              causa_cierre,version_ddns,decision,modo,
              intencion_gobernante_id,contenido_deseado_canonico,
              contenido_deseado_sha256,contenido_publicado_canonico,
              contenido_publicado_sha256,generacion_dns_publicada,
              condicion_operativa,registro_scope_tenant_id,
              registro_scope_empresa_id,registro_scope_sitio_id
         FROM concesiones_ddns_agentes
        WHERE concesion_id=? FOR UPDATE`,
      [uuidV7AuditoriaABytes(concesionId, 'concesionId')]
    );
    const concesion = concesiones[0];
    if (!concesion) {
      throw new ErrorRepositorioCausalDdns(
        'La concesión DDNS no existe.',
        'concesion_no_encontrada'
      );
    }
    if (String(concesion.agente_id_fotografia) !== agente) {
      throw new ErrorRepositorioCausalDdns(
        'La concesión DDNS no pertenece al agente autenticado.',
        'concesion_ajena'
      );
    }

    let registro = null;
    if (concesion.registro_dns_id !== null) {
      const [registros] = await conexion.execute(
        `SELECT id,zona_id,host_relativo,tipo_registro,valor_principal,
                prioridad,peso,puerto,ttl_segundos,categoria_origen,
                tenant_id,empresa_id,sitio_id,activo,publicar_en_bind
           FROM registros_dns WHERE id=? FOR UPDATE`,
        [concesion.registro_dns_id]
      );
      registro = registros[0] || null;
    }

    let intencion = null;
    if (concesion.intencion_gobernante_id !== null) {
      const [intenciones] = await conexion.execute(
        `SELECT id,intencion_id,concesion_interna_id,
                agente_id_fotografia,registro_dns_id_fotografia,origen,
                version_ddns,modo,estado_deseado_canonico,
                estado_deseado_sha256,causa_tipo,causa_id,hito,terminal,
                aceptada_en_utc,persistida_en_utc,publicada_en_utc,
                terminada_en_utc
           FROM intenciones_ddns_agentes WHERE id=? FOR UPDATE`,
        [concesion.intencion_gobernante_id]
      );
      intencion = intenciones[0] || null;
      if (!intencion) {
        throw new ErrorRepositorioCausalDdns(
          'La intención gobernante DDNS no existe.',
          'fotografia_inconsistente'
        );
      }
    }

    let solicitud = null;
    let intencionSolicitud = null;
    if (solicitudId !== null) {
      const [solicitudes] = await conexion.execute(
        `SELECT id,solicitud_id,agente_id_fotografia,
                concesion_interna_id,cuerpo_canonico_sha256,
                intencion_interna_id,resultado,estado_http,creada_en_utc
           FROM solicitudes_ddns_agentes
          WHERE agente_id_fotografia=? AND solicitud_id=? FOR UPDATE`,
        [agente, uuidV7AuditoriaABytes(solicitudId, 'solicitudId')]
      );
      solicitud = solicitudes[0] || null;
      if (solicitud && solicitud.intencion_interna_id !== null &&
          String(solicitud.intencion_interna_id) !==
            String(concesion.intencion_gobernante_id)) {
        const [intencionesSolicitud] = await conexion.execute(
          `SELECT id,intencion_id,concesion_interna_id,
                  agente_id_fotografia,registro_dns_id_fotografia,origen,
                  version_ddns,modo,estado_deseado_canonico,
                  estado_deseado_sha256,causa_tipo,causa_id,hito,terminal,
                  aceptada_en_utc,persistida_en_utc,publicada_en_utc,
                  terminada_en_utc
             FROM intenciones_ddns_agentes WHERE id=? FOR UPDATE`,
          [solicitud.intencion_interna_id]
        );
        intencionSolicitud = intencionesSolicitud[0] || null;
        if (!intencionSolicitud) {
          throw new ErrorRepositorioCausalDdns(
            'La solicitud DDNS perdió su intención causal.',
            'fotografia_inconsistente'
          );
        }
      } else if (solicitud) {
        intencionSolicitud = intencion;
      }
    }

    return Object.freeze({
      concesion: mapearConcesion(concesion),
      registro: mapearRegistro(registro),
      intencionGobernante: mapearIntencion(intencion),
      intencionSolicitud: mapearIntencion(intencionSolicitud),
      solicitud: mapearSolicitud(solicitud)
    });
  }

  async registrarSolicitudEnTransaccion({
    solicitudId,
    agenteId,
    concesionInternaId,
    cuerpoCanonicoSha256,
    intencionInternaId,
    resultado,
    estadoHttp
  }, { conexion }) {
    validarConexion(conexion);
    const agente = idPositivo(agenteId, 'agenteId');
    const concesion = idPositivo(concesionInternaId, 'concesionInternaId');
    const intencion = idPositivo(intencionInternaId, 'intencionInternaId');
    const huella = exigirHuella(cuerpoCanonicoSha256);
    const solicitudBytes = uuidV7AuditoriaABytes(solicitudId, 'solicitudId');
    const existente = await buscarSolicitud(
      conexion,
      agente,
      solicitudBytes,
      true
    );
    if (existente) {
      exigirMismaSolicitud(existente, concesion, huella);
      return Object.freeze({ creada: false, solicitud: mapearSolicitud(existente) });
    }

    try {
      const [insercion] = await conexion.execute(
        `INSERT INTO solicitudes_ddns_agentes (
           solicitud_id,agente_id_fotografia,concesion_interna_id,
           cuerpo_canonico_sha256,intencion_interna_id,resultado,estado_http
         ) VALUES (?,?,?,?,?,?,?)`,
        [
          solicitudBytes, agente, concesion, huella, intencion,
          exigirResultado(resultado), exigirEstadoHttp(estadoHttp)
        ]
      );
      const [filas] = await conexion.execute(
        `SELECT id,solicitud_id,agente_id_fotografia,
                concesion_interna_id,cuerpo_canonico_sha256,
                intencion_interna_id,resultado,estado_http,creada_en_utc
           FROM solicitudes_ddns_agentes WHERE id=?`,
        [insercion.insertId]
      );
      return Object.freeze({ creada: true, solicitud: mapearSolicitud(filas[0]) });
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const concurrente = await buscarSolicitud(
        conexion,
        agente,
        solicitudBytes,
        true
      );
      if (!concurrente) throw error;
      exigirMismaSolicitud(concurrente, concesion, huella);
      return Object.freeze({ creada: false, solicitud: mapearSolicitud(concurrente) });
    }
  }

  async crearIntencionAceptadaEnTransaccion({
    intencionId,
    concesion,
    solicitudId,
    version,
    estadoDeseadoCanonico,
    estadoDeseadoSha256
  }, { conexion }) {
    validarConexion(conexion);
    const [insercion] = await conexion.execute(
      `INSERT INTO intenciones_ddns_agentes (
         intencion_id,concesion_interna_id,agente_id_fotografia,
         registro_dns_id_fotografia,origen,version_ddns,modo,
         estado_deseado_canonico,estado_deseado_sha256,
         causa_tipo,causa_id,hito
       ) VALUES (?,?,?,?,'agente_explicita',?,?,?,?,
                 'solicitud_agente',?,'intencion_aceptada')`,
      [
        uuidV7AuditoriaABytes(intencionId, 'intencionId'),
        idPositivo(concesion?.idInterno, 'concesion.idInterno'),
        idPositivo(concesion?.agenteIdFotografia, 'concesion.agenteIdFotografia'),
        idPositivo(concesion?.registroDnsIdFotografia, 'concesion.registroDnsIdFotografia'),
        decimal(version, 'version'),
        estadoDeseadoCanonico.modo,
        JSON.stringify(estadoDeseadoCanonico),
        exigirHuella(estadoDeseadoSha256),
        uuidV7AuditoriaABytes(solicitudId, 'solicitudId')
      ]
    );
    return String(insercion.insertId);
  }

  async buscarIntencionPolPorCausaEnTransaccion({
    concesionInternaId,
    causaId
  }, { conexion }) {
    validarConexion(conexion);
    const [filas] = await conexion.execute(
      `SELECT id,intencion_id,concesion_interna_id,
              agente_id_fotografia,registro_dns_id_fotografia,origen,
              version_ddns,modo,estado_deseado_canonico,
              estado_deseado_sha256,causa_tipo,causa_id,hito,terminal,
              aceptada_en_utc,persistida_en_utc,publicada_en_utc,
              terminada_en_utc
         FROM intenciones_ddns_agentes
        WHERE concesion_interna_id=? AND causa_tipo='pol' AND causa_id=?
        LIMIT 1 FOR UPDATE`,
      [
        idPositivo(concesionInternaId, 'concesionInternaId'),
        uuidV7AuditoriaABytes(causaId, 'causaId')
      ]
    );
    return mapearIntencion(filas[0] || null);
  }

  async crearIntencionPolAceptadaEnTransaccion({
    intencionId,
    concesion,
    causaId,
    version,
    estadoDeseadoCanonico,
    estadoDeseadoSha256
  }, { conexion }) {
    validarConexion(conexion);
    const [insercion] = await conexion.execute(
      `INSERT INTO intenciones_ddns_agentes (
         intencion_id,concesion_interna_id,agente_id_fotografia,
         registro_dns_id_fotografia,origen,version_ddns,modo,
         estado_deseado_canonico,estado_deseado_sha256,
         causa_tipo,causa_id,hito
       ) VALUES (?,?,?,?,'pol_observada',?,'observada',?,?,
                 'pol',?,'intencion_aceptada')`,
      [
        uuidV7AuditoriaABytes(intencionId, 'intencionId'),
        idPositivo(concesion?.idInterno, 'concesion.idInterno'),
        idPositivo(concesion?.agenteIdFotografia, 'concesion.agenteIdFotografia'),
        idPositivo(concesion?.registroDnsIdFotografia, 'concesion.registroDnsIdFotografia'),
        decimal(version, 'version'),
        JSON.stringify(estadoDeseadoCanonico),
        exigirHuella(estadoDeseadoSha256),
        uuidV7AuditoriaABytes(causaId, 'causaId')
      ]
    );
    return String(insercion.insertId);
  }

  async establecerIntencionGobernanteEnTransaccion({
    concesionInternaId,
    versionEsperada,
    version,
    modo,
    intencionInternaId,
    condicionOperativa
  }, { conexion }) {
    validarConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE concesiones_ddns_agentes
          SET version_ddns=?,decision='operativa',modo=?,
              intencion_gobernante_id=?,condicion_operativa=?
        WHERE id=? AND version_ddns=? AND estado='vigente'`,
      [
        decimal(version, 'version'), modo,
        idPositivo(intencionInternaId, 'intencionInternaId'),
        condicionOperativa,
        idPositivo(concesionInternaId, 'concesionInternaId'),
        decimal(versionEsperada, 'versionEsperada')
      ]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new ErrorRepositorioCausalDdns(
        'La versión causal DDNS cambió durante la aceptación.',
        'version_concurrente'
      );
    }
  }

  async sustituirIntencionGobernanteEnTransaccion(
    { intencionInternaId },
    { conexion }
  ) {
    validarConexion(conexion);
    if (intencionInternaId === null || intencionInternaId === undefined) {
      return Object.freeze({ sustituida: false, intentoEnCursoConservado: false });
    }
    const intencion = idPositivo(intencionInternaId, 'intencionInternaId');
    const [resultado] = await conexion.execute(
      `UPDATE intenciones_ddns_agentes
          SET terminal='sustituida',terminada_en_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND terminal IS NULL`,
      [intencion]
    );
    if (Number(resultado.affectedRows) === 0) {
      return Object.freeze({ sustituida: false, intentoEnCursoConservado: false });
    }
    await conexion.execute(
      `UPDATE intentos_publicacion_ddns
          SET estado='sustituida',terminada_en_utc=UTC_TIMESTAMP(3)
        WHERE intencion_interna_id=? AND estado IN ('pendiente','bloqueada')`,
      [intencion]
    );
    const [enCurso] = await conexion.execute(
      `SELECT id FROM intentos_publicacion_ddns
        WHERE intencion_interna_id=? AND estado='procesando' LIMIT 1`,
      [intencion]
    );
    return Object.freeze({
      sustituida: true,
      intentoEnCursoConservado: Boolean(enCurso[0])
    });
  }

  async terminarObjetivoEnTransaccion({
    intencionInternaId,
    terminal
  }, { conexion }) {
    validarConexion(conexion);
    if (!['objetivo_incompatible', 'objetivo_eliminado'].includes(terminal)) {
      throw new TypeError('El terminal de objetivo DDNS no es válido.');
    }
    if (intencionInternaId === null || intencionInternaId === undefined) {
      return Object.freeze({ terminada: false, intencion: null });
    }
    const intencion = idPositivo(intencionInternaId, 'intencionInternaId');
    const [filas] = await conexion.execute(
      `SELECT id,intencion_id,concesion_interna_id,
              agente_id_fotografia,registro_dns_id_fotografia,origen,
              version_ddns,modo,estado_deseado_canonico,
              estado_deseado_sha256,causa_tipo,causa_id,hito,terminal,
              aceptada_en_utc,persistida_en_utc,publicada_en_utc,
              terminada_en_utc
         FROM intenciones_ddns_agentes WHERE id=? FOR UPDATE`,
      [intencion]
    );
    const anterior = mapearIntencion(filas[0] || null);
    if (!anterior || anterior.terminal !== null) {
      return Object.freeze({ terminada: false, intencion: anterior });
    }
    await conexion.execute(
      `UPDATE intenciones_ddns_agentes
          SET terminal=?,terminada_en_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND terminal IS NULL`,
      [terminal, intencion]
    );
    await conexion.execute(
      `UPDATE intentos_publicacion_ddns
          SET estado=?,terminada_en_utc=UTC_TIMESTAMP(3),
              instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
              disponible_en_utc=NULL
        WHERE intencion_interna_id=?
          AND estado IN ('pendiente','procesando','bloqueada')`,
      [terminal, intencion]
    );
    return Object.freeze({
      terminada: true,
      intencion: Object.freeze({ ...anterior, terminal })
    });
  }
}

export function compararDecimalesDdns(izquierda, derecha) {
  const a = decimal(izquierda, 'izquierda');
  const b = decimal(derecha, 'derecha');
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : (a < b ? -1 : 1);
}

async function buscarSolicitud(conexion, agente, solicitudBytes, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT id,solicitud_id,agente_id_fotografia,
            concesion_interna_id,cuerpo_canonico_sha256,
            intencion_interna_id,resultado,estado_http,creada_en_utc
       FROM solicitudes_ddns_agentes
      WHERE agente_id_fotografia=? AND solicitud_id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [agente, solicitudBytes]
  );
  return filas[0] || null;
}

function exigirMismaSolicitud(existente, concesion, huella) {
  const mismaHuella = Buffer.isBuffer(existente.cuerpo_canonico_sha256) &&
    existente.cuerpo_canonico_sha256.length === huella.length &&
    timingSafeEqual(existente.cuerpo_canonico_sha256, huella);
  if (String(existente.concesion_interna_id) !== concesion || !mismaHuella) {
    throw new ErrorRepositorioCausalDdns(
      'La solicitud DDNS ya fue usada con otra intención.',
      'solicitud_reutilizada'
    );
  }
}

function mapearConcesion(fila) {
  return Object.freeze({
    idInterno: String(fila.id),
    concesionId: bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId'),
    agenteId: nullable(fila.agente_id),
    registroDnsId: nullable(fila.registro_dns_id),
    agenteIdFotografia: String(fila.agente_id_fotografia),
    registroDnsIdFotografia: String(fila.registro_dns_id_fotografia),
    estado: fila.estado,
    causaCierre: fila.causa_cierre,
    version: decimal(fila.version_ddns, 'version_ddns'),
    decision: fila.decision,
    modo: fila.modo,
    intencionGobernanteId: nullable(fila.intencion_gobernante_id),
    contenidoDeseado: json(fila.contenido_deseado_canonico),
    contenidoDeseadoSha256: copiarBuffer(fila.contenido_deseado_sha256),
    contenidoPublicado: json(fila.contenido_publicado_canonico),
    contenidoPublicadoSha256: copiarBuffer(fila.contenido_publicado_sha256),
    generacionDnsPublicada: nullable(fila.generacion_dns_publicada),
    condicionOperativa: fila.condicion_operativa,
    scopeRegistro: Object.freeze({
      tenantId: nullable(fila.registro_scope_tenant_id),
      empresaId: nullable(fila.registro_scope_empresa_id),
      sitioId: nullable(fila.registro_scope_sitio_id)
    })
  });
}

function mapearRegistro(fila) {
  if (!fila) return null;
  return Object.freeze({
    id: String(fila.id),
    zonaId: String(fila.zona_id),
    hostRelativo: fila.host_relativo,
    tipo: fila.tipo_registro,
    valorPrincipal: fila.valor_principal,
    prioridad: nullable(fila.prioridad),
    peso: nullable(fila.peso),
    puerto: nullable(fila.puerto),
    ttlSegundos: nullable(fila.ttl_segundos),
    categoriaOrigen: fila.categoria_origen,
    activo: Boolean(fila.activo),
    publicarEnBind: Boolean(fila.publicar_en_bind),
    scope: Object.freeze({
      tenantId: nullable(fila.tenant_id),
      empresaId: nullable(fila.empresa_id),
      sitioId: nullable(fila.sitio_id)
    })
  });
}

function mapearIntencion(fila) {
  if (!fila) return null;
  return Object.freeze({
    idInterno: String(fila.id),
    intencionId: bytesAUuidV7Auditoria(fila.intencion_id, 'intencionId'),
    concesionInternaId: String(fila.concesion_interna_id),
    agenteIdFotografia: String(fila.agente_id_fotografia),
    registroDnsIdFotografia: String(fila.registro_dns_id_fotografia),
    origen: fila.origen,
    version: decimal(fila.version_ddns, 'version_ddns'),
    modo: fila.modo,
    estadoDeseado: json(fila.estado_deseado_canonico),
    estadoDeseadoSha256: copiarBuffer(fila.estado_deseado_sha256),
    causaTipo: fila.causa_tipo,
    causaId: fila.causa_id
      ? bytesAUuidV7Auditoria(fila.causa_id, 'causaId')
      : null,
    hito: fila.hito,
    terminal: fila.terminal,
    aceptadaEnUtc: fila.aceptada_en_utc
  });
}

function mapearSolicitud(fila) {
  if (!fila) return null;
  return Object.freeze({
    idInterno: String(fila.id),
    solicitudId: bytesAUuidV7Auditoria(fila.solicitud_id, 'solicitudId'),
    agenteIdFotografia: String(fila.agente_id_fotografia),
    concesionInternaId: String(fila.concesion_interna_id),
    cuerpoCanonicoSha256: copiarBuffer(fila.cuerpo_canonico_sha256),
    intencionInternaId: nullable(fila.intencion_interna_id),
    resultado: fila.resultado,
    estadoHttp: Number(fila.estado_http),
    creadaEnUtc: fila.creada_en_utc
  });
}

function decimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) {
    throw new TypeError(`${nombre} no es un decimal sin signo válido.`);
  }
  return texto;
}

function idPositivo(valor, nombre) {
  const texto = decimal(valor, nombre);
  if (texto === '0') throw new TypeError(`${nombre} debe ser positivo.`);
  return texto;
}

function exigirHuella(valor) {
  if (!Buffer.isBuffer(valor) || valor.length !== 32) {
    throw new TypeError('cuerpoCanonicoSha256 debe contener 32 bytes.');
  }
  return Buffer.from(valor);
}

function exigirResultado(valor) {
  if (!['aceptada', 'repetida', 'convergente', 'sin_cambios'].includes(valor)) {
    throw new TypeError('El resultado de la solicitud DDNS no es válido.');
  }
  return valor;
}

function exigirEstadoHttp(valor) {
  const numero = Number(valor);
  if (![200, 202].includes(numero)) {
    throw new TypeError('El estado HTTP de la solicitud DDNS no es válido.');
  }
  return numero;
}

function json(valor) {
  if (valor === null) return null;
  const contenido = typeof valor === 'object' && !Buffer.isBuffer(valor)
    ? structuredClone(valor)
    : JSON.parse(String(valor));
  return Object.freeze(contenido);
}

function copiarBuffer(valor) {
  return valor === null ? null : Buffer.from(valor);
}

function nullable(valor) {
  return valor === null ? null : String(valor);
}

function validarConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new TypeError('La operación causal DDNS exige una conexión prestada.');
  }
}
