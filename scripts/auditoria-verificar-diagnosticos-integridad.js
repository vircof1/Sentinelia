import assert from 'node:assert/strict';
import {
  ServicioDiagnosticosIntegridadAuditoria,
  __testablesServicioDiagnosticosIntegridadAuditoria
} from '../paquetes/auditoria/src/ServicioDiagnosticosIntegridadAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';

async function main() {
  await verificarDedupeResolucionYRecurrencia();
  await verificarPendientePorCabeceraAvanzada();
  await verificarReconocimientoAtomico();
  console.log('[auditoria] OK 5.21.12b: diagnosticos=vigentes incidentes=dedupe reconocimiento=atomico deteccion=activa_resuelta');
}

async function verificarDedupeResolucionYRecurrencia() {
  const repositorio = new RepositorioDiagnosticosFixture();
  const servicio = new ServicioDiagnosticosIntegridadAuditoria({
    repositorioDiagnosticos: repositorio,
    ahora: reloj('2026-07-25T11:00:00.000Z')
  });
  const roto = resultadoRoto();
  const primera = await servicio.registrarResultadoVerificacion(roto, {
    ejecucionId: generarUuidV7Auditoria()
  });
  const repetida = await servicio.registrarResultadoVerificacion(roto, {
    ejecucionId: generarUuidV7Auditoria()
  });

  assert.equal(primera.incidente.repetido, false);
  assert.equal(repetida.incidente.repetido, true);
  assert.equal(primera.incidente.episodioId, repetida.incidente.episodioId);
  assert.equal(repositorio.incidentes.length, 1);
  assert.equal(repositorio.incidentes[0].estadoDeteccion, 'activo');
  assert.equal(repositorio.incidentes[0].reconocidoEnUtc, null);

  await servicio.registrarResultadoVerificacion(resultadoIntegro(), {
    ejecucionId: generarUuidV7Auditoria()
  });
  assert.equal(repositorio.incidentes[0].estadoDeteccion, 'resuelto');
  assert.notEqual(repositorio.incidentes[0].resueltoEnUtc, null);

  const recurrencia = await servicio.registrarResultadoVerificacion(roto, {
    ejecucionId: generarUuidV7Auditoria()
  });
  assert.equal(recurrencia.incidente.repetido, false);
  assert.notEqual(recurrencia.incidente.episodioId, primera.incidente.episodioId);
  assert.equal(repositorio.incidentes.length, 2);
}

async function verificarPendientePorCabeceraAvanzada() {
  const repositorio = new RepositorioDiagnosticosFixture();
  const servicio = new ServicioDiagnosticosIntegridadAuditoria({
    repositorioDiagnosticos: repositorio,
    ahora: reloj('2026-07-25T12:00:00.000Z')
  });
  const resultado = resultadoIntegro({
    intervalo: {
      desdeSecuencia: '1',
      hastaSecuencia: '5',
      ultimaSecuenciaVerificada: '5'
    },
    anclas: {
      cabecera: {
        ultimaSecuencia: '8',
        ultimoHash: HASH_B
      }
    }
  });
  const registrado = await servicio.registrarResultadoVerificacion(resultado, {
    ejecucionId: generarUuidV7Auditoria()
  });
  assert.equal(registrado.pendienteRevision, true);
  assert.equal(registrado.diagnostico.estadoVerificacion, 'pendiente');
  assert.equal(repositorio.diagnosticos.get(CLAVE_CADENA).pendienteRevision, true);
  assert.equal(repositorio.incidentes.length, 0);
}

async function verificarReconocimientoAtomico() {
  const repositorio = new RepositorioDiagnosticosFixture();
  const auditoria = new ServicioAuditoriaFixture();
  const servicio = new ServicioDiagnosticosIntegridadAuditoria({
    repositorioDiagnosticos: repositorio,
    servicioAuditoria: auditoria,
    ahora: reloj('2026-07-25T13:00:00.000Z')
  });
  const apertura = await servicio.registrarResultadoVerificacion(resultadoRoto(), {
    ejecucionId: generarUuidV7Auditoria()
  });

  const reconocimiento = await servicio.reconocerIncidente({
    episodioId: apertura.incidente.episodioId,
    actor: { tipo: 'usuario', id: '7' },
    comentario: 'Revisado por operación.'
  });
  assert.equal(reconocimiento.evento.estado, 'incorporado');
  assert.equal(repositorio.incidentes[0].reconocidoPorUsuarioId, '7');
  assert.equal(repositorio.incidentes[0].comentarioReconocimiento, 'Revisado por operación.');
  assert.equal(auditoria.intenciones[0].claveCadena, 'sistema:tenant:9');
  assert.equal(auditoria.intenciones[0].payload.estado, 'reconocido');

  const repositorioFallido = new RepositorioDiagnosticosFixture();
  const auditoriaFallida = new ServicioAuditoriaFixture({ fallar: true });
  const servicioFallido = new ServicioDiagnosticosIntegridadAuditoria({
    repositorioDiagnosticos: repositorioFallido,
    servicioAuditoria: auditoriaFallida,
    ahora: reloj('2026-07-25T13:10:00.000Z')
  });
  const abierto = await servicioFallido.registrarResultadoVerificacion(resultadoRoto(), {
    ejecucionId: generarUuidV7Auditoria()
  });
  await assert.rejects(
    () => servicioFallido.reconocerIncidente({
      episodioId: abierto.incidente.episodioId,
      actor: { tipo: 'usuario', id: '7' },
      comentario: null
    }),
    /cadena de gobierno bloqueada/
  );
  assert.equal(repositorioFallido.incidentes[0].reconocidoEnUtc, null);

  const huella = __testablesServicioDiagnosticosIntegridadAuditoria.calcularHuellaIncidente({
    claveCadena: CLAVE_CADENA,
    estadoVerificacion: 'rota',
    codigo: 'hash_evento_incoherente',
    secuencia: '4'
  });
  assert.equal(huella, apertura.incidente.huella);
}

class RepositorioDiagnosticosFixture {
  constructor() {
    this.ejecuciones = [];
    this.diagnosticos = new Map();
    this.incidentes = [];
  }

  async guardarEjecucion(ejecucion) {
    this.ejecuciones.push(ejecucion);
  }

  async actualizarDiagnosticoVigente(diagnostico) {
    this.diagnosticos.set(diagnostico.claveCadena, diagnostico);
  }

  async abrirOActualizarIncidente(incidente) {
    const activo = this.incidentes.find(
      (actual) => actual.huella === incidente.huella && actual.estadoDeteccion === 'activo'
    );
    if (activo) {
      activo.ultimaDeteccionUtc = incidente.ultimaDeteccionUtc;
      activo.ultimaEjecucionId = incidente.ultimaEjecucionId;
      activo.detalle = incidente.detalle;
      return Object.freeze({ ...activo, repetido: true });
    }
    const nuevo = {
      ...incidente,
      reconocidoEnUtc: null,
      reconocidoPorUsuarioId: null,
      comentarioReconocimiento: null,
      eventoReconocimientoId: null,
      resueltoEnUtc: null
    };
    this.incidentes.push(nuevo);
    return Object.freeze({ ...nuevo, repetido: false });
  }

  async resolverIncidentesCadena({ claveCadena, fecha, ejecucionId }) {
    for (const incidente of this.incidentes) {
      if (incidente.claveCadena === claveCadena && incidente.estadoDeteccion === 'activo') {
        incidente.estadoDeteccion = 'resuelto';
        incidente.resueltoEnUtc = fecha;
        incidente.ultimaEjecucionId = ejecucionId;
      }
    }
  }

  async enTransaccion(tarea) {
    const copia = JSON.stringify(this.incidentes);
    try {
      return await tarea({ repositorio: this, conexion: { id: 'fixture' } });
    } catch (error) {
      this.incidentes = JSON.parse(copia);
      throw error;
    }
  }

  async bloquearIncidenteActivo({ episodioId }) {
    const incidente = this.incidentes.find(
      (actual) => actual.episodioId === episodioId && actual.estadoDeteccion === 'activo'
    );
    if (!incidente) throw new Error('El incidente no está activo o no existe.');
    return Object.freeze({ ...incidente });
  }

  async confirmarReconocimiento({ episodioId, usuarioId, comentario, eventoReconocimientoId, fecha }) {
    const incidente = this.incidentes.find((actual) => actual.episodioId === episodioId);
    incidente.reconocidoEnUtc = fecha;
    incidente.reconocidoPorUsuarioId = String(usuarioId);
    incidente.comentarioReconocimiento = comentario;
    incidente.eventoReconocimientoId = eventoReconocimientoId;
  }
}

class ServicioAuditoriaFixture {
  constructor({ fallar = false } = {}) {
    this.fallar = fallar;
    this.intenciones = [];
  }

  async registrarEnTransaccion({ intencion }, { conexion }) {
    assert.equal(conexion.id, 'fixture');
    if (this.fallar) throw new Error('cadena de gobierno bloqueada');
    this.intenciones.push(intencion);
    return Object.freeze({
      evento: Object.freeze({
        estado: 'incorporado',
        eventoId: intencion.eventoId
      })
    });
  }
}

const CLAVE_CADENA = 'monitores:tenant:9';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function resultadoRoto() {
  return Object.freeze({
    estado: 'rota',
    claveCadena: CLAVE_CADENA,
    intervalo: Object.freeze({
      desdeSecuencia: '1',
      hastaSecuencia: '5',
      ultimaSecuenciaVerificada: '3'
    }),
    paginas: 2,
    eventosVerificados: 3,
    ultimoHashVerificado: HASH_A,
    hashFinalEsperado: HASH_B,
    anclas: Object.freeze({
      cabecera: Object.freeze({
        ultimaSecuencia: '5',
        ultimoHash: HASH_B
      })
    }),
    incidencias: Object.freeze([
      Object.freeze({
        codigo: 'hash_evento_incoherente',
        secuencia: '4',
        mensaje: 'Hash manipulado.'
      })
    ])
  });
}

function resultadoIntegro(sobrescritura = {}) {
  return Object.freeze({
    estado: 'integra',
    claveCadena: CLAVE_CADENA,
    intervalo: Object.freeze({
      desdeSecuencia: '1',
      hastaSecuencia: '5',
      ultimaSecuenciaVerificada: '5'
    }),
    paginas: 1,
    eventosVerificados: 5,
    ultimoHashVerificado: HASH_B,
    hashFinalEsperado: HASH_B,
    anclas: Object.freeze({
      cabecera: Object.freeze({
        ultimaSecuencia: '5',
        ultimoHash: HASH_B
      })
    }),
    incidencias: Object.freeze([]),
    ...sobrescritura
  });
}

function reloj(fecha) {
  return () => fecha;
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.12b');
  console.error(error);
  process.exitCode = 1;
});
