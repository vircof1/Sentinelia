import {
  bytesAUuidV7Auditoria,
  generarUuidV7Auditoria
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  construirIntencionAuditoriaDdns,
  construirPayloadAuditoriaDdns
} from './EventosAuditoriaDdnsAgentes.js';
import { RepositorioCausalDdnsAgentes } from './RepositorioCausalDdnsAgentes.js';
import { RepositorioConcesionesDdnsAgentes } from './RepositorioConcesionesDdnsAgentes.js';

export class PreparadorEliminacionDdnsAgentesEnTransaccion {
  constructor({
    clienteSql,
    servicioAuditoria,
    repositorioConcesiones = new RepositorioConcesionesDdnsAgentes(clienteSql),
    repositorioCausal = new RepositorioCausalDdnsAgentes(clienteSql),
    generarEventoId = generarUuidV7Auditoria
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function' ||
        typeof servicioAuditoria?.registrarEnTransaccion !== 'function' ||
        typeof repositorioConcesiones?.cerrarConcesionEnTransaccion !== 'function' ||
        typeof repositorioCausal?.terminarObjetivoEnTransaccion !== 'function' ||
        typeof generarEventoId !== 'function') {
      throw new TypeError('La preparación DDNS de bajas exige sus puertos completos.');
    }
    Object.assign(this, {
      clienteSql,
      servicioAuditoria,
      repositorioConcesiones,
      repositorioCausal,
      generarEventoId
    });
  }

  prepararAgenteEnTransaccion(datos = {}, { conexion } = {}) {
    return this.#preparar({
      agenteIds: [idPositivo(datos.agenteId, 'agenteId')],
      raiz: null,
      actores: datos.actores,
      operacionId: datos.operacionId
    }, conexion);
  }

  prepararOrganizacionEnTransaccion(datos = {}, { conexion } = {}) {
    return this.#preparar({
      agenteIds: idsUnicos(datos.agenteIds || []),
      raiz: normalizarRaiz(datos.raiz),
      actores: datos.actores,
      operacionId: datos.operacionId
    }, conexion);
  }

  async #preparar({ agenteIds, raiz, actores, operacionId }, conexion) {
    exigirConexion(conexion);
    const operacion = uuid(datosUuid(operacionId, 'operacionId'));
    const actorRealId = idPositivo(actores?.real?.usuarioId, 'actores.real.usuarioId');
    const actorEfectivoId = idPositivo(
      actores?.efectivo?.usuarioId,
      'actores.efectivo.usuarioId'
    );
    const afectadas = await cargarConcesionesAfectadas({
      conexion,
      agenteIds,
      raiz
    });
    await bloquearTrabajo(conexion, afectadas);

    let cerradas = 0;
    let agentesDesacoplados = 0;
    let registrosDesacoplados = 0;
    let objetivosEliminados = 0;
    let aceptadasSupervivientes = 0;
    for (const afectada of afectadas) {
      const eliminaAgente = agenteIds.includes(afectada.agenteId);
      const eliminaRegistro = afectada.registroIncluido;
      let terminacion = null;
      if (eliminaRegistro && afectada.intencionGobernanteId !== null &&
          afectada.intencionGobernanteTerminal === null) {
        terminacion = await this.repositorioCausal.terminarObjetivoEnTransaccion({
          intencionInternaId: afectada.intencionGobernanteId,
          terminal: 'objetivo_eliminado'
        }, { conexion });
        if (terminacion.terminada) objetivosEliminados += 1;
      } else if (eliminaAgente && afectada.intencionGobernanteId !== null &&
          afectada.intencionGobernanteTerminal === null) {
        aceptadasSupervivientes += 1;
      }
      if (afectada.estado === 'vigente') {
        const cerrada = await this.repositorioConcesiones
          .cerrarConcesionEnTransaccion({
            concesionId: afectada.concesionId,
            causa: eliminaRegistro ? 'registro_eliminado' : 'agente_eliminado'
          }, { conexion });
        cerradas += 1;
        await this.#auditarCierre({
          conexion,
          operacion,
          actorRealId,
          actorEfectivoId,
          concesion: cerrada,
          eliminaRegistro,
          terminacion
        });
      } else if (terminacion?.terminada) {
        await this.#auditarTerminacion({
          conexion,
          operacion,
          concesion: afectada,
          terminacion
        });
      }
      if (eliminaAgente && afectada.agenteId !== null) agentesDesacoplados += 1;
      if (eliminaRegistro && afectada.registroDnsId !== null) registrosDesacoplados += 1;
      await conexion.execute(
        `UPDATE concesiones_ddns_agentes
            SET agente_id=IF(?,NULL,agente_id),
                registro_dns_id=IF(?,NULL,registro_dns_id)
          WHERE id=? AND estado='revocada'`,
        [eliminaAgente ? 1 : 0, eliminaRegistro ? 1 : 0, afectada.idInterno]
      );
    }

    const causasPolDescartadas = await descartarCausasPolNoConvertidas(
      conexion,
      agenteIds
    );
    return congelar({
      concesionesAfectadas: String(afectadas.length),
      concesionesCerradas: String(cerradas),
      extremosAgenteDesacoplados: String(agentesDesacoplados),
      extremosRegistroDesacoplados: String(registrosDesacoplados),
      intencionesObjetivoEliminado: String(objetivosEliminados),
      intencionesAceptadasSupervivientes: String(aceptadasSupervivientes),
      causasPolDescartadas: String(causasPolDescartadas),
      registrosObjetivoIds: afectadas
        .filter(({ registroIncluido }) => registroIncluido)
        .map(({ registroDnsIdFotografia }) => registroDnsIdFotografia)
    });
  }

  async #auditarCierre({
    conexion,
    operacion,
    actorRealId,
    actorEfectivoId,
    concesion,
    eliminaRegistro,
    terminacion
  }) {
    const actorReal = { tipo: 'usuario', id: actorRealId };
    const actorEfectivo = actorRealId === actorEfectivoId
      ? null
      : { tipo: 'usuario', id: actorEfectivoId };
    await registrar(this.servicioAuditoria, conexion,
      construirIntencionAuditoriaDdns({
        eventoId: this.generarEventoId(),
        tipo: 'ddns.concesion_revocada',
        actorReal,
        actorEfectivo,
        sujetoId: concesion.concesionId,
        scope: concesion.scopeRegistro,
        correlacionId: operacion,
        productor: 'runtime_operaciones_administrativas',
        claveOperacion: `ddns:baja:${operacion}:${concesion.concesionId}`,
        payload: construirPayloadAuditoriaDdns({
          resultado: 'revocada',
          modo: concesion.modo,
          estadoAnterior: concesion.contenidoDeseado,
          versionDdns: concesion.version,
          causa: eliminaRegistro ? 'registro_eliminado' : 'agente_eliminado',
          agenteId: concesion.agenteIdFotografia,
          registroDnsId: concesion.registroDnsIdFotografia,
          extremo: eliminaRegistro ? 'registro' : 'agente'
        })
      })
    );
    if (!terminacion?.terminada) return;
    await this.#auditarTerminacion({
      conexion,
      operacion,
      concesion,
      terminacion
    });
  }

  async #auditarTerminacion({ conexion, operacion, concesion, terminacion }) {
    const intencion = terminacion.intencion;
    await registrar(this.servicioAuditoria, conexion,
      construirIntencionAuditoriaDdns({
        eventoId: this.generarEventoId(),
        tipo: 'ddns.intencion_terminada',
        actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
        sujetoId: intencion.intencionId,
        scope: concesion.scopeRegistro,
        correlacionId: operacion,
        causalidadIntencionId: intencion.intencionId,
        productor: 'runtime_dns',
        claveOperacion:
          `ddns:terminal:${concesion.concesionId}:${intencion.version}:objetivo_eliminado`,
        rolEvento: 'resultado',
        payload: construirPayloadAuditoriaDdns({
          resultado: 'objetivo_eliminado',
          modo: intencion.modo,
          estadoPosterior: intencion.estadoDeseado,
          versionDdns: intencion.version,
          origenIntencion: intencion.origen,
          causa: 'registro_eliminado',
          agenteId: intencion.agenteIdFotografia,
          registroDnsId: intencion.registroDnsIdFotografia
        })
      })
    );
  }
}

async function cargarConcesionesAfectadas({ conexion, agenteIds, raiz }) {
  const parametros = [];
  const condiciones = [];
  if (agenteIds.length > 0) {
    condiciones.push(`c.agente_id IN (${agenteIds.map(() => '?').join(',')})`);
    parametros.push(...agenteIds);
  }
  let expresionRegistro = '0';
  if (raiz) {
    expresionRegistro = `EXISTS (
      SELECT 1 FROM registros_dns r
       WHERE r.id=c.registro_dns_id AND r.${raiz.tipo}_id=?
    )`;
    condiciones.push(expresionRegistro);
    parametros.push(raiz.id);
  }
  if (condiciones.length === 0) return [];
  const [filas] = await conexion.execute(
    `SELECT c.id,c.concesion_id,c.agente_id,c.registro_dns_id,
            c.agente_id_fotografia,c.registro_dns_id_fotografia,c.estado,
            c.intencion_gobernante_id,i.terminal AS intencion_gobernante_terminal,
            c.registro_scope_tenant_id,c.registro_scope_empresa_id,
            c.registro_scope_sitio_id,
            (${expresionRegistro}) AS registro_incluido
       FROM concesiones_ddns_agentes c
       LEFT JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
      WHERE ${condiciones.join(' OR ')}
      ORDER BY c.id FOR UPDATE`,
    raiz ? [raiz.id, ...parametros] : parametros
  );
  return filas.map((fila) => ({
    idInterno: String(fila.id),
    concesionId: bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId'),
    agenteId: fila.agente_id === null ? null : String(fila.agente_id),
    registroDnsId: fila.registro_dns_id === null ? null : String(fila.registro_dns_id),
    agenteIdFotografia: String(fila.agente_id_fotografia),
    registroDnsIdFotografia: String(fila.registro_dns_id_fotografia),
    estado: String(fila.estado),
    intencionGobernanteId: fila.intencion_gobernante_id === null
      ? null
      : String(fila.intencion_gobernante_id),
    intencionGobernanteTerminal: fila.intencion_gobernante_terminal === null
      ? null
      : String(fila.intencion_gobernante_terminal),
    scopeRegistro: Object.freeze({
      tenantId: fila.registro_scope_tenant_id === null
        ? null
        : String(fila.registro_scope_tenant_id),
      empresaId: fila.registro_scope_empresa_id === null
        ? null
        : String(fila.registro_scope_empresa_id),
      sitioId: fila.registro_scope_sitio_id === null
        ? null
        : String(fila.registro_scope_sitio_id)
    }),
    registroIncluido: Number(fila.registro_incluido) === 1
  }));
}

async function bloquearTrabajo(conexion, concesiones) {
  const ids = concesiones.map(({ idInterno }) => idInterno);
  if (ids.length === 0) return;
  const marcas = ids.map(() => '?').join(',');
  await conexion.execute(
    `SELECT id FROM intenciones_ddns_agentes
      WHERE concesion_interna_id IN (${marcas}) ORDER BY id FOR UPDATE`,
    ids
  );
  await conexion.execute(
    `SELECT id FROM intentos_publicacion_ddns
      WHERE concesion_interna_id IN (${marcas}) ORDER BY id FOR UPDATE`,
    ids
  );
}

async function descartarCausasPolNoConvertidas(conexion, agenteIds) {
  if (agenteIds.length === 0) return 0;
  const marcas = agenteIds.map(() => '?').join(',');
  await conexion.execute(
    `SELECT causa_id FROM causas_pol_ddns
      WHERE agente_id_fotografia IN (${marcas})
        AND estado IN ('pendiente','procesando','reintentable')
        AND NOT EXISTS (
          SELECT 1 FROM intenciones_ddns_agentes i
           WHERE i.causa_tipo='pol' AND i.causa_id=causas_pol_ddns.causa_id
        )
      ORDER BY causa_id FOR UPDATE`,
    agenteIds
  );
  const [resultado] = await conexion.execute(
    `UPDATE causas_pol_ddns
        SET estado='fallida',instancia_id=NULL,lease_token=NULL,
            lease_expira_utc=NULL,codigo_diagnostico='agente_eliminado',
            mensaje_diagnostico='El agente fue eliminado antes de convertir la causa POL.',
            actualizada_en_utc=UTC_TIMESTAMP(3),terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE agente_id_fotografia IN (${marcas})
        AND estado IN ('pendiente','procesando','reintentable')
        AND NOT EXISTS (
          SELECT 1 FROM intenciones_ddns_agentes i
           WHERE i.causa_tipo='pol' AND i.causa_id=causas_pol_ddns.causa_id
        )`,
    agenteIds
  );
  return Number(resultado.affectedRows || 0);
}

function normalizarRaiz(raiz) {
  const tipo = String(raiz?.tipo || '');
  if (!['tenant', 'empresa', 'sitio'].includes(tipo)) {
    throw new TypeError('La raíz organizativa DDNS no es válida.');
  }
  return Object.freeze({ tipo, id: idPositivo(raiz.id, 'raiz.id') });
}

function idsUnicos(ids) {
  return [...new Set(ids.map((id, indice) => idPositivo(id, `agenteIds[${indice}]`)))]
    .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
}

function idPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new TypeError(`${campo} no es válido.`);
  return texto;
}

function datosUuid(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    .test(texto)) throw new TypeError(`${campo} no es un UUIDv7 canónico.`);
  return texto;
}

function uuid(valor) {
  return valor;
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new TypeError('La preparación DDNS de bajas exige conexión prestada.');
  }
}

async function registrar(servicioAuditoria, conexion, intencion) {
  await servicioAuditoria.registrarEnTransaccion({
    cambioEfectivo: true,
    intencion
  }, { conexion });
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
