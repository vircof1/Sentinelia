import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ServicioLecturaAuditoria } from '../paquetes/auditoria/src/ServicioLecturaAuditoria.js';

const UUID_INCIDENTE = '018f1f77-1f23-7000-8000-000000000101';

const ARCHIVOS = Object.freeze({
  rutas: 'apps/sentinelia-web/src/rutas/crearRutasPortal.js',
  controlador: 'apps/sentinelia-web/src/controladores/ControladorAuditoria.js',
  vista: 'apps/sentinelia-web/src/views/portal/auditoria-cronologia.ejs',
  js: 'apps/sentinelia-web/src/public/js/auditoria-cronologia.js',
  css: 'apps/sentinelia-web/src/public/css/portal.css',
  servicio: 'paquetes/auditoria/src/ServicioLecturaAuditoria.js',
  repositorio: 'paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js',
  index: 'apps/sentinelia-web/src/index.js'
});

async function main() {
  const archivos = await leerArchivos();
  verificarContratoEstatico(archivos);
  await verificarVistaSegura();
  await verificarReconocimiento();
  console.log('[auditoria] OK 5.21.14c: integridad=progresiva resumen=prudente incidentes=reconocibles scope=completo ui=sin_promesas');
}

async function leerArchivos() {
  const entradas = await Promise.all(
    Object.entries(ARCHIVOS).map(async ([clave, ruta]) => [
      clave,
      await readFile(new URL(`../${ruta}`, import.meta.url), 'utf8')
    ])
  );
  return Object.fromEntries(entradas);
}

function verificarContratoEstatico(archivos) {
  assert.match(archivos.index, /ServicioDiagnosticosIntegridadAuditoria/, 'El portal debe inyectar el servicio de reconocimiento.');
  assert.match(archivos.index, /RepositorioDiagnosticosIntegridadAuditoriaSql/, 'El portal debe inyectar el repositorio transaccional.');
  assert.match(archivos.servicio, /reconocerIncidente/, 'El servicio de lectura debe exponer reconocimiento controlado.');
  assert.match(archivos.servicio, /tieneAlcanceCompletoCadenaIntegridad/, 'El reconocimiento debe exigir alcance completo.');
  assert.match(archivos.repositorio, /listarIncidentes/, 'La lectura debe exponer incidentes visibles.');
  assert.match(archivos.repositorio, /obtenerIncidenteVisible/, 'La lectura debe comprobar visibilidad de incidente antes de reconocer.');
  assert.match(
    archivos.rutas,
    /router\.post\(\s*['"]\/auditoria\/api\/incidentes\/:episodioId\/reconocer['"][\s\S]*requerirVerAuditoria[\s\S]*apiReconocerIncidente/,
    'La ruta de reconocimiento debe estar protegida por verAuditoria.'
  );
  assert.match(archivos.controlador, /apiReconocerIncidente/, 'Falta controlador JSON de reconocimiento.');

  for (const marca of [
    'data-url-diagnosticos="/auditoria/api/diagnosticos"',
    'data-auditoria-integridad',
    'data-auditoria-integridad-cadenas',
    'data-auditoria-integridad-incidentes',
    'Lectura prudente',
    'no promete integridad vigente'
  ]) {
    assert.ok(archivos.vista.includes(marca), `La vista no declara ${marca}.`);
  }

  for (const marca of [
    'cargarIntegridad',
    'renderizarCadenaIntegridad',
    'Íntegra hasta',
    'Pendiente:',
    'Ver detalle técnico',
    'data-auditoria-reconocer-incidente',
    'X-CSRF-Token'
  ]) {
    assert.ok(archivos.js.includes(marca), `El cliente no cubre ${marca}.`);
  }

  for (const clase of [
    '.auditoria-integridad__resumen',
    '.auditoria-integridad-cadena',
    '.auditoria-integridad-detalle',
    '.auditoria-integridad-incidente'
  ]) {
    assert.ok(archivos.css.includes(clase), `Falta estilo ${clase}.`);
  }
}

async function verificarVistaSegura() {
  const servicio = crearServicio();
  const portal = await servicio.listarDiagnosticos({
    contextoUsuarioActual: contexto({ nivelScope: 'portal' }),
    consulta: { limite: 10 }
  });
  assert.equal(portal.resumen.total, 2);
  assert.equal(portal.resumen.problematicos, 2);
  assert.equal(portal.cadenas[0].alcanceDetalle, 'completo');
  assert.equal(portal.incidentes[0].alcanceDetalle, 'completo');
  assert.equal(portal.incidentes[0].huella, 'a'.repeat(64));

  const empresa = await servicio.listarDiagnosticos({
    contextoUsuarioActual: contexto({
      nivelScope: 'empresa',
      tenantId: '9',
      empresaId: '4'
    }),
    consulta: { limite: 10 }
  });
  assert.equal(empresa.resumen.total, 1);
  assert.equal(empresa.cadenas[0].alcanceDetalle, 'resumen');
  assert.equal('hashFinalVerificado' in empresa.cadenas[0], false);
  assert.equal(empresa.incidentes[0].alcanceDetalle, 'resumen');
  assert.equal('detalle' in empresa.incidentes[0], false);
}

async function verificarReconocimiento() {
  const diagnosticos = new DiagnosticosFixture();
  const servicio = crearServicio({ servicioDiagnosticosIntegridad: diagnosticos });

  await assert.rejects(
    () => servicio.reconocerIncidente({
      contextoUsuarioActual: contexto({
        nivelScope: 'empresa',
        tenantId: '9',
        empresaId: '4'
      }),
      sesionActual: { id: 7 },
      episodioId: UUID_INCIDENTE
    }),
    /alcance/
  );
  assert.equal(diagnosticos.reconocimientos.length, 0);

  const resultado = await servicio.reconocerIncidente({
    contextoUsuarioActual: contexto({ nivelScope: 'tenant', tenantId: '9' }),
    sesionActual: { id: 7 },
    episodioId: UUID_INCIDENTE,
    comentario: 'Revisado por operación.'
  });
  assert.equal(resultado.ok, true);
  assert.equal(diagnosticos.reconocimientos.length, 1);
  assert.equal(diagnosticos.reconocimientos[0].actor.id, '7');
  assert.equal(diagnosticos.reconocimientos[0].comentario, 'Revisado por operación.');
}

function crearServicio({ servicioDiagnosticosIntegridad = new DiagnosticosFixture() } = {}) {
  return new ServicioLecturaAuditoria({
    repositorioLectura: new RepositorioLecturaFixture(),
    secretoCursores: 'secreto-estable-para-verificacion',
    servicioDiagnosticosIntegridad
  });
}

function contexto({
  nivelScope = 'portal',
  tenantId = null,
  empresaId = null,
  sitioId = null,
  verAuditoria = true
} = {}) {
  return Object.freeze({
    idUsuario: 7,
    idUsuarioReal: 7,
    nivelScope,
    tenantId,
    empresaId,
    sitioId,
    permisos: { verAuditoria },
    sesionAuditoriaId: '018f1f77-1f23-7000-8000-000000000777',
    versionSesionReal: 1,
    versionSesionEfectiva: 1
  });
}

class RepositorioLecturaFixture {
  async listarEventos() {
    return [];
  }

  async contarEventos() {
    return 0;
  }

  async listarDiagnosticos() {
    return [
      diagnostico({ claveCadena: 'sistema:tenant:9', estadoVerificacion: 'pendiente', pendienteRevision: true }),
      diagnostico({ claveCadena: 'sistema:tenant:10', estadoVerificacion: 'rota', pendienteRevision: false })
    ];
  }

  async listarIncidentes() {
    return [
      incidente({ claveCadena: 'sistema:tenant:9', episodioId: UUID_INCIDENTE }),
      incidente({ claveCadena: 'sistema:tenant:10', episodioId: '018f1f77-1f23-7000-8000-000000000202' })
    ];
  }

  async obtenerIncidenteVisible({ episodioId, contextoUsuarioActual }) {
    const candidato = incidente({ claveCadena: 'sistema:tenant:9', episodioId });
    if (contextoUsuarioActual.nivelScope === 'portal') return candidato;
    if (String(contextoUsuarioActual.tenantId) === '9') return candidato;
    return null;
  }

  async eventoVisiblePorId() {
    return false;
  }
}

class DiagnosticosFixture {
  constructor() {
    this.reconocimientos = [];
  }

  async reconocerIncidente(entrada) {
    this.reconocimientos.push(entrada);
    return {
      incidente: incidente({ episodioId: entrada.episodioId }),
      evento: { eventoId: '018f1f77-1f23-7000-8000-000000000303' }
    };
  }
}

function diagnostico({
  claveCadena,
  estadoVerificacion = 'integra',
  pendienteRevision = false
}) {
  return Object.freeze({
    claveCadena,
    estadoVerificacion,
    pendienteRevision,
    desdeSecuencia: '1',
    hastaSecuencia: '8',
    ultimaSecuenciaVerificada: '8',
    hashFinalVerificado: 'b'.repeat(64),
    hashFinalEsperado: 'b'.repeat(64),
    cabeceraUltimaSecuencia: pendienteRevision ? '13' : '8',
    cabeceraUltimoHash: 'c'.repeat(64),
    actualizadoEnUtc: '2026-07-25T12:00:00.000Z',
    diagnostico: { estado: estadoVerificacion, incidencias: [] }
  });
}

function incidente({
  claveCadena = 'sistema:tenant:9',
  episodioId = UUID_INCIDENTE
} = {}) {
  return Object.freeze({
    episodioId,
    huella: 'a'.repeat(64),
    claveCadena,
    codigo: 'hash_invalido',
    estadoVerificacion: 'rota',
    estadoDeteccion: 'activo',
    primeraDeteccionUtc: '2026-07-25T12:00:00.000Z',
    ultimaDeteccionUtc: '2026-07-25T12:00:01.000Z',
    resueltoEnUtc: null,
    reconocidoEnUtc: null,
    reconocidoPorUsuarioId: null,
    detalle: { incidencia: 'hash_invalido', secuencia: '8' }
  });
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.14c');
  console.error(error);
  process.exitCode = 1;
});
