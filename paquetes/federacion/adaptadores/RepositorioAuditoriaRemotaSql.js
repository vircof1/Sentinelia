import { createHash } from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';
import { validarPayloadAuditoriaFederada } from '../src/PayloadAuditoriaFederada.js';
import { evaluarEvidenciaAuditoriaFederada } from './EvaluadorEvidenciaAuditoriaFederada.js';

const DOMINIO_ANCLA_RECEPTOR = Buffer.from(
  'sentinelia-auditoria-federada-ancla-receptor-v1\0',
  'utf8'
);

export class ErrorAuditoriaRemotaFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorAuditoriaRemotaFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioAuditoriaRemotaSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La auditoría remota requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async materializarEnTransaccion(
    { operacion, payload, contexto } = {},
    { conexion } = {}
  ) {
    await exigirTransaccion(conexion);
    const trabajo = await obtenerTrabajoBloqueado(conexion, contexto);
    if (operacion !== trabajo.operacion) {
      fallar('operacion_auditoria_remota_no_corresponde', 'La operación no coincide con el trabajo reclamado.');
    }
    if (operacion === 'salidaProyeccion') {
      return Object.freeze({
        estado: 'sinCambio',
        causa: 'auditoriaHistoricaNoRetirablePorSalida',
        proyeccionId: trabajo.proyeccion_id,
        secuenciaElemento: String(trabajo.secuencia_elemento)
      });
    }
    if (operacion === 'retirada') {
      fallar(
        'retirada_auditoria_federada_no_permitida',
        'Un evento remoto de auditoría solo queda sujeto a retención local.'
      );
    }
    const normalizado = validarPayloadAuditoriaFederada(payload, { operacion });
    const canonico = canonicalizarJsonFederacion(normalizado);
    const validacion = evaluarEvidenciaAuditoriaFederada(normalizado);
    const existente = await obtenerRegistro(conexion, trabajo);
    if (existente) {
      if (
        existente.trabajo_entrega_id !== trabajo.entrega_id ||
        existente.representacion_canonica !== canonico
      ) {
        fallar(
          'registro_auditoria_remota_divergente',
          'La secuencia auditable ya fue materializada con otro contenido.'
        );
      }
      return resultado(trabajo, validacion, true);
    }
    const existentePorEvento = await obtenerRegistroPorEvento(
      conexion,
      trabajo,
      normalizado.eventoOrigenId
    );
    if (existentePorEvento) {
      if (existentePorEvento.representacion_canonica !== canonico) {
        fallar(
          'identidad_evento_auditoria_remota_divergente',
          'La identidad del evento remoto ya representa otro contenido en esta proyección.'
        );
      }
      return resultado(trabajo, validacion, true);
    }
    const evidencia = normalizado.evidenciaOrigen;
    const sobre = evidencia.estado === 'verificable'
      ? evidencia.sobreCanonico
      : null;
    const hashRepresentacion = createHash('sha256').update(canonico, 'utf8').digest();
    const hashAncla = crearAnclaReceptor({
      trabajo,
      eventoOrigenId: normalizado.eventoOrigenId,
      hashRepresentacion
    });
    const vista = normalizado.vistaAutorizada;
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO registros_auditoria_remota (
         proyeccion_id,generacion_id,secuencia_elemento,
         trabajo_entrega_id,inbox_ocurrencia_id,ocurrencia_origen_id,
         evento_origen_id,clave_cadena_origen,secuencia_cadena_origen,
         estado_verificabilidad_origen,resultado_validacion_receptor,
         causa_validacion,hash_payload_origen,hash_anterior_origen,
         hash_actual_origen,hash_representacion_receptor,hash_ancla_receptor,
         efectivo_en_origen_utc,registrado_en_origen_utc,
         representacion_canonica,materializada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        trabajo.proyeccion_id,
        trabajo.generacion_id,
        String(trabajo.secuencia_elemento),
        trabajo.entrega_id,
        String(trabajo.inbox_ocurrencia_id),
        trabajo.ocurrencia_origen_id,
        normalizado.eventoOrigenId,
        sobre?.claveCadena ?? null,
        sobre?.secuencia ?? null,
        evidencia.estado,
        validacion.estado,
        validacion.causa,
        evidencia.estado === 'verificable' ? Buffer.from(evidencia.hashPayload, 'hex') : null,
        evidencia.estado === 'verificable' ? Buffer.from(evidencia.hashAnterior, 'hex') : null,
        evidencia.estado === 'verificable' ? Buffer.from(evidencia.hashActual, 'hex') : null,
        hashRepresentacion,
        hashAncla,
        fechaSqlOpcional(vista.efectivoEnUtc),
        fechaSqlOpcional(vista.registradoEnUtc),
        canonico,
        ahora
      ]
    );
    return resultado(trabajo, validacion, false);
  }

  async listarEventos({
    installationOrigenId = null,
    scope = null,
    eventoOrigenId = null,
    claveCadenaOrigen = null,
    resultadoValidacion = null,
    desdeUtc = null,
    hastaUtc = null,
    limite = 200
  } = {}) {
    const condiciones = [];
    const parametros = [];
    const filtroScope = construirFiltroScope(scope, 'p');
    condiciones.push(filtroScope.clausula);
    parametros.push(...filtroScope.parametros);
    if (installationOrigenId !== null) {
      condiciones.push('p.installation_origen_id=?');
      parametros.push(identidad(installationOrigenId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION));
    }
    if (eventoOrigenId !== null) {
      condiciones.push('r.evento_origen_id=?');
      parametros.push(uuidV7(eventoOrigenId));
    }
    if (claveCadenaOrigen !== null) {
      const clave = String(claveCadenaOrigen || '');
      if (!clave || clave.length > 128 || !/^[\x20-\x7e]+$/u.test(clave)) {
        fallar('clave_cadena_auditoria_remota_invalida', 'La clave de cadena no es válida.');
      }
      condiciones.push('r.clave_cadena_origen=?');
      parametros.push(clave);
    }
    if (resultadoValidacion !== null) {
      if (!['verificada', 'noVerificable', 'invalida'].includes(resultadoValidacion)) {
        fallar('resultado_validacion_auditoria_remota_invalido', 'El resultado de validación no existe.');
      }
      condiciones.push('r.resultado_validacion_receptor=?');
      parametros.push(resultadoValidacion);
    }
    const desde = desdeUtc === null ? null : fechaConsulta(desdeUtc);
    const hasta = hastaUtc === null ? null : fechaConsulta(hastaUtc);
    if (desde !== null && hasta !== null && hasta <= desde) {
      fallar('rango_consulta_auditoria_remota_invalido', 'El rango temporal no es válido.');
    }
    if (desde !== null) { condiciones.push('r.registrado_en_origen_utc>=?'); parametros.push(desde); }
    if (hasta !== null) { condiciones.push('r.registrado_en_origen_utc<?'); parametros.push(hasta); }
    const maximo = limiteConsulta(limite);
    const filtro = condiciones.length ? `AND ${condiciones.join(' AND ')}` : '';
    const filas = await this.clienteSql.consultar(
      `WITH actuales AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,v.ultima_secuencia_evaluada,
                (SELECT MAX(r2.secuencia_elemento)
                   FROM registros_auditoria_remota r2
                  WHERE r2.proyeccion_id=p.proyeccion_id
                    AND r2.generacion_id=a.generacion_actual_id
                    AND r2.secuencia_elemento<=v.ultima_secuencia_evaluada) AS secuencia
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='auditoria'
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              a.generacion_actual_id,r.secuencia_elemento,r.ocurrencia_origen_id,
              r.evento_origen_id,r.clave_cadena_origen,r.secuencia_cadena_origen,
              r.estado_verificabilidad_origen,r.resultado_validacion_receptor,
              r.causa_validacion,HEX(r.hash_payload_origen) AS hash_payload_origen,
              HEX(r.hash_anterior_origen) AS hash_anterior_origen,
              HEX(r.hash_actual_origen) AS hash_actual_origen,
              HEX(r.hash_representacion_receptor) AS hash_representacion_receptor,
              HEX(r.hash_ancla_receptor) AS hash_ancla_receptor,
              r.efectivo_en_origen_utc,r.registrado_en_origen_utc,
              r.representacion_canonica,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion
         FROM actuales a
         JOIN proyecciones_federacion p ON p.proyeccion_id=a.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=a.proyeccion_id
          AND v.generacion_id=a.generacion_actual_id
         JOIN registros_auditoria_remota r
           ON r.proyeccion_id=a.proyeccion_id
          AND r.generacion_id=a.generacion_actual_id
          AND r.secuencia_elemento=a.secuencia
        WHERE 1=1 ${filtro}
        ORDER BY r.registrado_en_origen_utc DESC,r.evento_origen_id
        LIMIT ${maximo}`,
      parametros
    );
    return Object.freeze(filas.map(mapearRegistro));
  }

  async listarAnclajesRetencion({
    installationOrigenId = null,
    scope = null,
    claveCadenaOrigen = null,
    limite = 200
  } = {}) {
    const filtroScope = construirFiltroScope(scope, 'f');
    const condiciones = [filtroScope.clausula];
    const parametros = [...filtroScope.parametros];
    if (installationOrigenId !== null) {
      condiciones.push('a.installation_origen_id=?');
      parametros.push(identidad(
        installationOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION
      ));
    }
    if (claveCadenaOrigen !== null) {
      const clave = String(claveCadenaOrigen || '');
      if (!clave || clave.length > 128 || !/^[\x20-\x7e]+$/u.test(clave)) {
        fallar(
          'clave_cadena_auditoria_remota_invalida',
          'La clave de cadena no es válida.'
        );
      }
      condiciones.push('a.clave_cadena_origen=?');
      parametros.push(clave);
    }
    const filtro = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const filas = await this.clienteSql.consultar(
      `SELECT a.generacion_id,g.flujo_id,f.relacion_id,
              a.installation_origen_id,a.clave_cadena_origen,
              f.scope_nivel,f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id,
              a.ultima_secuencia_retirada,a.ultimo_evento_retirado_id,
              HEX(a.hash_actual_ultimo_retirado) AS hash_actual_ultimo_retirado,
              HEX(a.hash_ancla_local) AS hash_ancla_local,
              a.primera_secuencia_conservada,a.primer_evento_conservado_id,
              a.estado_continuidad,a.causa_continuidad,
              a.eventos_retirados_acumulados,a.politica_dias,
              a.version_politica,a.aplicado_en_utc
         FROM anclajes_retencion_auditoria_remota a
         JOIN generaciones_flujos_federacion g
           ON g.generacion_id=a.generacion_id
         JOIN flujos_federacion f ON f.flujo_id=g.flujo_id
         ${filtro}
        ORDER BY a.aplicado_en_utc DESC,a.generacion_id,a.clave_cadena_origen
        LIMIT ${limiteConsulta(limite)}`,
      parametros
    );
    return Object.freeze(filas.map(mapearAnclaRetencion));
  }
}

async function obtenerTrabajoBloqueado(conexion, contexto) {
  const entregaId = identidad(contexto?.entregaId, TIPOS_IDENTIDAD_FEDERADA.ENTREGA);
  const propietario = String(contexto?.propietario || '');
  const fencingToken = String(contexto?.fencingToken || '');
  const [filas] = await conexion.execute(
    `SELECT t.*,p.familia AS familia_proyeccion
       FROM trabajos_materializacion_federacion t
       JOIN proyecciones_federacion p ON p.proyeccion_id=t.proyeccion_id
      WHERE t.entrega_id=? AND t.estado='procesando'
        AND t.propietario_lease=? AND t.fencing_token=?
        AND t.lease_hasta_utc>UTC_TIMESTAMP(3)
      FOR UPDATE`,
    [entregaId, propietario, fencingToken]
  );
  if (!filas[0]) fallar('fencing_materializacion_auditoria_obsoleto', 'El trabajo no está gobernado por este materializador.');
  if (filas[0].familia !== 'auditoria' || filas[0].familia_proyeccion !== 'auditoria') {
    fallar('familia_materializacion_auditoria_incompatible', 'El trabajo pertenece a otra familia.');
  }
  return filas[0];
}

async function obtenerRegistro(conexion, trabajo) {
  const [filas] = await conexion.execute(
    `SELECT * FROM registros_auditoria_remota
      WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=?
      FOR UPDATE`,
    [trabajo.proyeccion_id, trabajo.generacion_id, String(trabajo.secuencia_elemento)]
  );
  return filas[0] || null;
}

async function obtenerRegistroPorEvento(conexion, trabajo, eventoOrigenId) {
  const [filas] = await conexion.execute(
    `SELECT representacion_canonica
       FROM registros_auditoria_remota
      WHERE proyeccion_id=? AND generacion_id=? AND evento_origen_id=?
      FOR UPDATE`,
    [trabajo.proyeccion_id, trabajo.generacion_id, eventoOrigenId]
  );
  return filas[0] || null;
}

function crearAnclaReceptor({ trabajo, eventoOrigenId, hashRepresentacion }) {
  return createHash('sha256')
    .update(DOMINIO_ANCLA_RECEPTOR)
    .update(trabajo.proyeccion_id, 'ascii')
    .update('\0')
    .update(trabajo.generacion_id, 'ascii')
    .update('\0')
    .update(String(trabajo.secuencia_elemento), 'ascii')
    .update('\0')
    .update(eventoOrigenId, 'ascii')
    .update('\0')
    .update(hashRepresentacion)
    .digest();
}

function resultado(trabajo, validacion, yaMaterializada) {
  return Object.freeze({
    estado: 'materializada',
    yaMaterializada,
    resultadoValidacion: validacion.estado,
    causaValidacion: validacion.causa,
    proyeccionId: trabajo.proyeccion_id,
    generacionId: trabajo.generacion_id,
    secuenciaElemento: String(trabajo.secuencia_elemento)
  });
}

function mapearRegistro(fila) {
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    generacionId: fila.generacion_actual_id,
    secuenciaElemento: String(fila.secuencia_elemento),
    ocurrenciaOrigenId: fila.ocurrencia_origen_id,
    eventoOrigenId: fila.evento_origen_id,
    claveCadenaOrigen: fila.clave_cadena_origen,
    secuenciaCadenaOrigen: fila.secuencia_cadena_origen === null
      ? null
      : String(fila.secuencia_cadena_origen),
    estadoVerificabilidadOrigen: fila.estado_verificabilidad_origen,
    resultadoValidacionReceptor: fila.resultado_validacion_receptor,
    causaValidacion: fila.causa_validacion,
    hashesOrigen: Object.freeze({
      payload: hexadecimalOpcional(fila.hash_payload_origen),
      anterior: hexadecimalOpcional(fila.hash_anterior_origen),
      actual: hexadecimalOpcional(fila.hash_actual_origen)
    }),
    anclaReceptor: Object.freeze({
      hashRepresentacion: String(fila.hash_representacion_receptor).toLowerCase(),
      hashAncla: String(fila.hash_ancla_receptor).toLowerCase()
    }),
    efectivoEnOrigenUtc: serializarFecha(fila.efectivo_en_origen_utc),
    registradoEnOrigenUtc: serializarFecha(fila.registrado_en_origen_utc),
    scopeRecepcion: Object.freeze({
      nivel: fila.scope_nivel,
      tenantId: decimalOpcional(fila.scope_tenant_id),
      empresaId: decimalOpcional(fila.scope_empresa_id),
      sitioId: decimalOpcional(fila.scope_sitio_id)
    }),
    completitud: Object.freeze({
      interpretable: fila.completitud_interpretable,
      observable: fila.completitud_observable,
      reconstruible: fila.completitud_reconstruible
    }),
    estadoProyeccion: Object.freeze({
      vigencia: fila.estado_vigencia,
      soporte: fila.estado_soporte,
      autorizacion: fila.estado_autorizacion
    }),
    payload: JSON.parse(fila.representacion_canonica)
  });
}

function mapearAnclaRetencion(fila) {
  return Object.freeze({
    relacionId: fila.relacion_id,
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_id,
    installationOrigenId: fila.installation_origen_id,
    claveCadenaOrigen: fila.clave_cadena_origen,
    scopeRecepcion: Object.freeze({
      nivel: fila.scope_nivel,
      tenantId: decimalOpcional(fila.scope_tenant_id),
      empresaId: decimalOpcional(fila.scope_empresa_id),
      sitioId: decimalOpcional(fila.scope_sitio_id)
    }),
    ultimaSecuenciaRetirada: String(fila.ultima_secuencia_retirada),
    ultimoEventoRetiradoId: fila.ultimo_evento_retirado_id,
    hashActualUltimoRetirado: String(
      fila.hash_actual_ultimo_retirado
    ).toLowerCase(),
    hashAnclaLocal: String(fila.hash_ancla_local).toLowerCase(),
    primeraSecuenciaConservada: fila.primera_secuencia_conservada === null
      ? null
      : String(fila.primera_secuencia_conservada),
    primerEventoConservadoId: fila.primer_evento_conservado_id,
    estadoContinuidad: fila.estado_continuidad,
    causaContinuidad: fila.causa_continuidad,
    eventosRetiradosAcumulados: String(fila.eventos_retirados_acumulados),
    politicaDias: Number(fila.politica_dias),
    versionPolitica: String(fila.version_politica),
    aplicadoEnUtc: serializarFecha(fila.aplicado_en_utc)
  });
}

function identidad(valor, tipo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    fallar('identidad_auditoria_remota_invalida', 'La identidad federada no es válida.');
  }
}

function uuidV7(valor) {
  const texto = String(valor || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(texto)) {
    fallar('uuidv7_auditoria_remota_invalido', 'La identidad del evento no es UUIDv7.');
  }
  return texto;
}

function construirFiltroScope(scope, alias) {
  if (scope === null || scope?.nivel === 'portal') {
    return { clausula: '1=1', parametros: [] };
  }
  if (!scope || !['tenant', 'empresa', 'sitio'].includes(scope.nivel)) {
    fallar('scope_consulta_auditoria_remota_invalido', 'El scope de lectura remota no es válido.');
  }
  const partes = [`${alias}.scope_tenant_id=?`];
  const parametros = [idScope(scope.tenantId, 'tenantId')];
  if (['empresa', 'sitio'].includes(scope.nivel)) {
    partes.push(`${alias}.scope_empresa_id=?`);
    parametros.push(idScope(scope.empresaId, 'empresaId'));
  }
  if (scope.nivel === 'sitio') {
    partes.push(`${alias}.scope_sitio_id=?`);
    parametros.push(idScope(scope.sitioId, 'sitioId'));
  }
  return { clausula: partes.join(' AND '), parametros };
}

function idScope(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    fallar('scope_consulta_auditoria_remota_invalido', `${campo} no es válido.`);
  }
  return texto;
}

function fechaConsulta(valor) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) fallar('fecha_consulta_auditoria_remota_invalida', 'La fecha no es válida.');
  return fecha;
}

function fechaSqlOpcional(valor) {
  return valor === null || valor === undefined ? null : new Date(valor);
}

function limiteConsulta(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 1000) {
    fallar('limite_consulta_auditoria_remota_invalido', 'El límite debe estar entre 1 y 1000.');
  }
  return numero;
}

function hexadecimalOpcional(valor) {
  return valor === null || valor === undefined ? null : String(valor).toLowerCase();
}

function decimalOpcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function serializarFecha(valor) {
  return valor === null || valor === undefined ? null : new Date(valor).toISOString();
}

async function exigirTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function') fallar('conexion_auditoria_remota_ausente', 'Se requiere conexión compartida.');
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) fallar('transaccion_auditoria_remota_ausente', 'Se requiere transacción activa.');
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorAuditoriaRemotaFederacion(codigo, mensaje);
}
