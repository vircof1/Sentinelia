import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ServicioVisibilidadDiagnosticosIntegridadAuditoria
} from '../paquetes/auditoria/src/ServicioVisibilidadDiagnosticosIntegridadAuditoria.js';

async function main() {
  await verificarVisibilidadPorScope();
  await verificarNotificacionesSoloTransicionesNuevas();
  await verificarContratoRepositorioSql();
  console.log('[auditoria] OK 5.21.12d: visibilidad=scope detalle=completo notificaciones=transiciones_nuevas fugas=0');
}

async function verificarVisibilidadPorScope() {
  const servicio = new ServicioVisibilidadDiagnosticosIntegridadAuditoria();
  const portal = servicio.construirVista({
    contextoUsuarioActual: contexto('portal'),
    diagnosticos: DIAGNOSTICOS,
    incidentes: INCIDENTES
  });
  assert.equal(portal.autorizado, true);
  assert.equal(portal.cadenas.length, 3);
  assert.equal(portal.cadenas[0].alcanceDetalle, 'completo');
  assert.equal(portal.cadenas.some((cadena) => cadena.hashFinalEsperado === HASH_B), true);

  const tenant = servicio.construirVista({
    contextoUsuarioActual: contexto('tenant', { tenantId: '9' }),
    diagnosticos: DIAGNOSTICOS,
    incidentes: INCIDENTES
  });
  assert.deepEqual(tenant.cadenas.map((cadena) => cadena.claveCadena), ['monitores:tenant:9']);
  assert.equal(tenant.cadenas[0].alcanceDetalle, 'completo');
  assert.equal(tenant.cadenas[0].hastaSecuencia, '5');
  assert.equal(tenant.incidentes[0].huella, HASH_A);

  const empresa = servicio.construirVista({
    contextoUsuarioActual: contexto('empresa', { tenantId: '9', empresaId: '20' }),
    diagnosticos: DIAGNOSTICOS,
    incidentes: INCIDENTES
  });
  assert.deepEqual(empresa.cadenas.map((cadena) => cadena.claveCadena), ['monitores:tenant:9']);
  assert.equal(empresa.cadenas[0].alcanceDetalle, 'resumen');
  assert.equal('hastaSecuencia' in empresa.cadenas[0], false);
  assert.equal('hashFinalEsperado' in empresa.cadenas[0], false);
  assert.equal('detalle' in empresa.incidentes[0], false);
  assert.equal(JSON.stringify(empresa).includes(HASH_A), false);
  assert.equal(JSON.stringify(empresa).includes('secuencia'), false);

  const sitio = servicio.construirVista({
    contextoUsuarioActual: contexto('sitio', { tenantId: '9', empresaId: '20', sitioId: '30' }),
    diagnosticos: DIAGNOSTICOS,
    incidentes: INCIDENTES
  });
  assert.equal(sitio.cadenas.length, 1);
  assert.equal(JSON.stringify(sitio).includes(HASH_B), false);

  const ajeno = servicio.construirVista({
    contextoUsuarioActual: contexto('tenant', { tenantId: '7' }),
    diagnosticos: DIAGNOSTICOS,
    incidentes: INCIDENTES
  });
  assert.equal(ajeno.cadenas.length, 0);
  assert.equal(ajeno.incidentes.length, 0);

  const sinPermiso = servicio.construirVista({
    contextoUsuarioActual: contexto('portal', { verAuditoria: false }),
    diagnosticos: DIAGNOSTICOS,
    incidentes: INCIDENTES
  });
  assert.equal(sinPermiso.autorizado, false);
  assert.equal(sinPermiso.cadenas.length, 0);
}

async function verificarNotificacionesSoloTransicionesNuevas() {
  const servicio = new ServicioVisibilidadDiagnosticosIntegridadAuditoria();
  const contextoTenant = contexto('tenant', { tenantId: '9' });
  const nuevas = servicio.planificarNotificaciones({
    diagnosticoAnterior: { ...DIAGNOSTICOS[0], estadoVerificacion: 'integra' },
    diagnosticoActual: DIAGNOSTICOS[0],
    incidentesActivos: [
      INCIDENTES[0],
      { ...INCIDENTES[0], episodioId: 'duplicado' },
      { ...INCIDENTES[0], huella: HASH_B, episodioId: 'reconocido', reconocidoEnUtc: '2026-07-25T11:00:00.000Z' }
    ],
    contextoDestino: contextoTenant
  });
  assert.equal(nuevas.length, 1);
  assert.equal(nuevas[0].incidente.huella, HASH_A);
  assert.equal(nuevas[0].severidad, 'critica');

  const repetida = servicio.planificarNotificaciones({
    diagnosticoAnterior: DIAGNOSTICOS[0],
    diagnosticoActual: DIAGNOSTICOS[0],
    incidentesActivos: [INCIDENTES[0]],
    contextoDestino: contextoTenant
  });
  assert.equal(repetida.length, 0);

  const noVisible = servicio.planificarNotificaciones({
    diagnosticoAnterior: { ...DIAGNOSTICOS[1], estadoVerificacion: 'integra' },
    diagnosticoActual: DIAGNOSTICOS[1],
    incidentesActivos: [INCIDENTES[1]],
    contextoDestino: contextoTenant
  });
  assert.equal(noVisible.length, 0);

  const empresa = servicio.planificarNotificaciones({
    diagnosticoAnterior: { ...DIAGNOSTICOS[0], estadoVerificacion: 'integra' },
    diagnosticoActual: DIAGNOSTICOS[0],
    incidentesActivos: [INCIDENTES[0]],
    contextoDestino: contexto('empresa', { tenantId: '9', empresaId: '20' })
  });
  assert.equal(empresa.length, 1);
  assert.equal('huella' in empresa[0].incidente, false);
  assert.equal('hastaSecuencia' in empresa[0].resumen, false);
}

async function verificarContratoRepositorioSql() {
  const fuente = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioLecturaDiagnosticosIntegridadAuditoriaSql.js', import.meta.url),
    'utf8'
  );
  assert.match(fuente, /diagnosticos_integridad_auditoria/);
  assert.match(fuente, /incidentes_integridad_auditoria/);
  assert.match(fuente, /condicionScope/);
  assert.doesNotMatch(fuente, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const DIAGNOSTICOS = Object.freeze([
  Object.freeze({
    claveCadena: 'monitores:tenant:9',
    estadoVerificacion: 'rota',
    pendienteRevision: false,
    desdeSecuencia: '1',
    hastaSecuencia: '5',
    ultimaSecuenciaVerificada: '3',
    hashFinalVerificado: HASH_A,
    hashFinalEsperado: HASH_B,
    cabeceraUltimaSecuencia: '5',
    cabeceraUltimoHash: HASH_B,
    actualizadoEnUtc: '2026-07-25T10:00:00.000Z',
    diagnostico: { incidencias: [{ codigo: 'hash_evento_incoherente', secuencia: '4' }] }
  }),
  Object.freeze({
    claveCadena: 'dns:tenant:8',
    estadoVerificacion: 'incompleta',
    pendienteRevision: false,
    desdeSecuencia: '1',
    hastaSecuencia: '2',
    hashFinalVerificado: HASH_A,
    hashFinalEsperado: HASH_B,
    cabeceraUltimaSecuencia: '4',
    cabeceraUltimoHash: HASH_B,
    actualizadoEnUtc: '2026-07-25T10:00:00.000Z',
    diagnostico: { incidencias: [{ codigo: 'hueco_secuencia', secuenciaEsperada: '3' }] }
  }),
  Object.freeze({
    claveCadena: 'sistema:portal',
    estadoVerificacion: 'integra',
    pendienteRevision: false,
    desdeSecuencia: '1',
    hastaSecuencia: '2',
    hashFinalVerificado: HASH_A,
    hashFinalEsperado: HASH_A,
    cabeceraUltimaSecuencia: '2',
    cabeceraUltimoHash: HASH_A,
    actualizadoEnUtc: '2026-07-25T10:00:00.000Z',
    diagnostico: { incidencias: [] }
  })
]);

const INCIDENTES = Object.freeze([
  Object.freeze({
    episodioId: '01890f47-7c6a-7b21-8f7a-0123456789ab',
    huella: HASH_A,
    claveCadena: 'monitores:tenant:9',
    codigo: 'hash_evento_incoherente',
    estadoDeteccion: 'activo',
    reconocidoEnUtc: null,
    primeraDeteccionUtc: '2026-07-25T10:00:00.000Z',
    ultimaDeteccionUtc: '2026-07-25T10:00:00.000Z',
    detalle: { incidencias: [{ codigo: 'hash_evento_incoherente', secuencia: '4' }] }
  }),
  Object.freeze({
    episodioId: '01890f47-7c6a-7b21-8f7a-0123456789ac',
    huella: HASH_B,
    claveCadena: 'dns:tenant:8',
    codigo: 'hueco_secuencia',
    estadoDeteccion: 'activo',
    reconocidoEnUtc: null,
    primeraDeteccionUtc: '2026-07-25T10:00:00.000Z',
    ultimaDeteccionUtc: '2026-07-25T10:00:00.000Z',
    detalle: { incidencias: [{ codigo: 'hueco_secuencia', secuenciaEsperada: '3' }] }
  })
]);

function contexto(nivelScope, {
  tenantId = null,
  empresaId = null,
  sitioId = null,
  verAuditoria = true
} = {}) {
  return {
    nivelScope,
    tenantId,
    empresaId,
    sitioId,
    permisos: { verAuditoria }
  };
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.12d');
  console.error(error);
  process.exitCode = 1;
});
