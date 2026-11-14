import { createHash } from 'node:crypto';
import { canonicalizarJcsAuditoriaV1 } from './PerfilJcsAuditoria.js';
import {
  ESTADOS_VERIFICACION_CADENA_AUDITORIA
} from './VerificadorCadenaAuditoria.js';
import { generarUuidV7Auditoria } from './UuidV7Auditoria.js';

const ESTADOS_PROBLEMATICOS = new Set([
  ESTADOS_VERIFICACION_CADENA_AUDITORIA.ROTA,
  ESTADOS_VERIFICACION_CADENA_AUDITORIA.INCOMPLETA,
  ESTADOS_VERIFICACION_CADENA_AUDITORIA.SIN_DATOS
]);

export class ServicioDiagnosticosIntegridadAuditoria {
  constructor({
    repositorioDiagnosticos,
    servicioAuditoria = null,
    clienteSql = null,
    ahora = () => new Date().toISOString()
  } = {}) {
    if (!repositorioDiagnosticos?.guardarEjecucion) {
      throw new Error('ServicioDiagnosticosIntegridadAuditoria requiere repositorio de diagnósticos.');
    }
    if (typeof ahora !== 'function') {
      throw new Error('ServicioDiagnosticosIntegridadAuditoria requiere reloj inyectable.');
    }
    this.repositorioDiagnosticos = repositorioDiagnosticos;
    this.servicioAuditoria = servicioAuditoria;
    this.clienteSql = clienteSql;
    this.ahora = ahora;
  }

  async registrarResultadoVerificacion(resultadoVerificacion, opciones = {}) {
    const fecha = opciones.fecha ?? this.ahora();
    const ejecucion = normalizarResultado(resultadoVerificacion, {
      ejecucionId: opciones.ejecucionId ?? generarUuidV7Auditoria(),
      fecha
    });
    await this.repositorioDiagnosticos.guardarEjecucion(ejecucion);

    const pendiente = cabeceraAvanzoSobreRango(ejecucion);
    const diagnostico = {
      ...ejecucion,
      estadoVerificacion: pendiente ? 'pendiente' : ejecucion.estadoVerificacion,
      pendienteRevision: pendiente
    };
    await this.repositorioDiagnosticos.actualizarDiagnosticoVigente(diagnostico);

    let incidente = null;
    if (ESTADOS_PROBLEMATICOS.has(ejecucion.estadoVerificacion)) {
      const candidato = construirIncidente(ejecucion, fecha);
      incidente = await this.repositorioDiagnosticos.abrirOActualizarIncidente(candidato);
    } else if (ejecucion.estadoVerificacion === ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA) {
      await this.repositorioDiagnosticos.resolverIncidentesCadena({
        claveCadena: ejecucion.claveCadena,
        fecha,
        ejecucionId: ejecucion.ejecucionId
      });
    }

    return Object.freeze({
      ejecucion,
      diagnostico,
      incidente,
      pendienteRevision: pendiente
    });
  }

  async reconocerIncidente({ episodioId, actor, comentario = null, eventoId = generarUuidV7Auditoria(), correlacionId = generarUuidV7Auditoria(), efectivoEnUtc = this.ahora() } = {}) {
    validarActorReconocimiento(actor);
    validarComentario(comentario);
    if (typeof this.servicioAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('El reconocimiento de incidencia requiere servicio de auditoría operativo.');
    }
    if (!this.clienteSql?.obtenerConexion && !this.repositorioDiagnosticos?.enTransaccion) {
      throw new Error('El reconocimiento auditable exige una frontera transaccional.');
    }
    const trabajo = async ({ repositorio, conexion }) => {
      const incidente = await repositorio.bloquearIncidenteActivo({ episodioId });
      const intencion = construirIntencionReconocimiento({
        incidente,
        actor,
        comentario,
        eventoId,
        correlacionId,
        efectivoEnUtc
      });
      const registro = await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion
      }, { conexion });
      await repositorio.confirmarReconocimiento({
        episodioId,
        usuarioId: actor.id,
        comentario,
        eventoReconocimientoId: registro.evento.eventoId,
        fecha: efectivoEnUtc
      });
      return Object.freeze({ incidente, evento: registro.evento });
    };
    if (this.repositorioDiagnosticos.enTransaccion) {
      return this.repositorioDiagnosticos.enTransaccion(trabajo);
    }
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const repositorio = this.repositorioDiagnosticos.conConexion(conexion);
      const resultado = await trabajo({ repositorio, conexion });
      await conexion.commit();
      return resultado;
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }
}

function normalizarResultado(resultado, { ejecucionId, fecha }) {
  if (!resultado?.claveCadena || !resultado?.estado) {
    throw new Error('El resultado de verificación no es registrable.');
  }
  return Object.freeze({
    ejecucionId,
    claveCadena: resultado.claveCadena,
    estadoVerificacion: resultado.estado,
    desdeSecuencia: resultado.intervalo?.desdeSecuencia ?? null,
    hastaSecuencia: resultado.intervalo?.hastaSecuencia ?? null,
    ultimaSecuenciaVerificada: resultado.intervalo?.ultimaSecuenciaVerificada ?? null,
    hashFinalVerificado: resultado.ultimoHashVerificado ?? null,
    hashFinalEsperado: resultado.hashFinalEsperado ?? null,
    cabeceraUltimaSecuencia: resultado.anclas?.cabecera?.ultimaSecuencia ?? null,
    cabeceraUltimoHash: resultado.anclas?.cabecera?.ultimoHash ?? null,
    paginas: Number(resultado.paginas ?? 0),
    eventosVerificados: Number(resultado.eventosVerificados ?? 0),
    verificadoEnUtc: fecha,
    incidencias: Object.freeze([...(resultado.incidencias || [])]),
    detalle: Object.freeze({
      estado: resultado.estado,
      intervalo: resultado.intervalo ?? null,
      anclas: resultado.anclas ?? null,
      incidencias: resultado.incidencias ?? []
    })
  });
}

function cabeceraAvanzoSobreRango(ejecucion) {
  if (ejecucion.cabeceraUltimaSecuencia == null || ejecucion.hastaSecuencia == null) return false;
  return BigInt(ejecucion.cabeceraUltimaSecuencia) > BigInt(ejecucion.hastaSecuencia);
}

function construirIncidente(ejecucion, fecha) {
  const primera = ejecucion.incidencias[0] ?? { codigo: ejecucion.estadoVerificacion };
  const huella = calcularHuellaIncidente({
    claveCadena: ejecucion.claveCadena,
    estadoVerificacion: ejecucion.estadoVerificacion,
    codigo: primera.codigo,
    secuencia: primera.secuencia ?? primera.secuenciaEsperada ?? null
  });
  return Object.freeze({
    episodioId: generarUuidV7Auditoria(),
    huella,
    claveCadena: ejecucion.claveCadena,
    codigo: primera.codigo,
    estadoVerificacion: ejecucion.estadoVerificacion,
    estadoDeteccion: 'activo',
    primeraDeteccionUtc: fecha,
    ultimaDeteccionUtc: fecha,
    primeraEjecucionId: ejecucion.ejecucionId,
    ultimaEjecucionId: ejecucion.ejecucionId,
    detalle: ejecucion.detalle
  });
}

function construirIntencionReconocimiento({ incidente, actor, comentario, eventoId, correlacionId, efectivoEnUtc }) {
  const tenantId = tenantDeClaveCadena(incidente.claveCadena);
  const claveCadena = tenantId === null ? 'sistema:portal' : `sistema:tenant:${tenantId}`;
  return {
    eventoId,
    tipo: 'auditoria.incidencia_integridad_reconocida',
    versionContrato: 1,
    flujo: 'sistema',
    claveCadena,
    actorReal: { tipo: 'usuario', id: String(actor.id) },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'incidente_integridad', id: incidente.episodioId },
    origen: 'web',
    scope: { tenantId, empresaId: null, sitioId: null },
    correlacionId,
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: `auditoria:incidente:reconocer:${incidente.episodioId}`,
    rolEvento: 'principal',
    efectivoEnUtc,
    versionCanonicalizador: 'sentinelia-auditoria-jcs-v1',
    versionEncadenado: 'sentinelia-auditoria-sha256-v1',
    payload: {
      incidenteId: incidente.episodioId,
      huella: incidente.huella,
      estado: 'reconocido',
      comentario
    }
  };
}

function calcularHuellaIncidente(datos) {
  return createHash('sha256')
    .update(Buffer.from('sentinelia-auditoria-incidente-integridad-v1', 'utf8'))
    .update(Buffer.from([0]))
    .update(Buffer.from(canonicalizarJcsAuditoriaV1(datos), 'utf8'))
    .digest('hex');
}

function tenantDeClaveCadena(claveCadena) {
  const coincidencia = String(claveCadena).match(/^[a-z_]+:tenant:([1-9][0-9]*)$/);
  return coincidencia ? coincidencia[1] : null;
}

function validarActorReconocimiento(actor) {
  if (!actor || actor.tipo !== 'usuario' || !/^[1-9][0-9]*$/.test(String(actor.id))) {
    throw new Error('El reconocimiento de incidencia exige actor usuario.');
  }
}

function validarComentario(comentario) {
  if (comentario === null) return;
  if (
    typeof comentario !== 'string' ||
    comentario.length === 0 ||
    [...comentario].length > 1000 ||
    Buffer.byteLength(comentario, 'utf8') > 4096 ||
    /[<>]/.test(comentario)
  ) {
    throw new Error('Comentario de reconocimiento no válido.');
  }
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva la autoridad diagnóstica.
  }
}

export const __testablesServicioDiagnosticosIntegridadAuditoria = Object.freeze({
  calcularHuellaIncidente,
  construirIntencionReconocimiento
});
