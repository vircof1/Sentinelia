import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CAUSALIDADES_AUDITORIA,
  FLUJOS_AUDITORIA,
  SUJETOS_AUDITORIA,
  construirClaveCadenaAuditoria,
  obtenerDefinicionTipoEventoAuditoria
} from '../paquetes/auditoria/src/CatalogoAuditoria.js';
import { construirSobreCanonicoAuditoriaV1 } from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import {
  RepositorioLecturaAuditoriaSql,
  __testablesRepositorioLecturaAuditoriaSql
} from '../paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js';
import {
  MANIFIESTO_PRODUCTORES_INTERNOS_AUDITORIA,
  MANIFIESTO_RUTAS_AUDITORIA
} from '../paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js';
import {
  construirIntencionAuditoriaConsumoRecuperacionPassword,
  construirIntencionAuditoriaEmisionRecuperacionPassword
} from '../paquetes/usuarios/src/EventosAuditoriaRecuperacionPassword.js';

const IDS = Object.freeze({
  solicitud: '01984f5a-9b8c-7def-8123-456789abcdef',
  emision: '01984f5a-9b8d-7def-8123-456789abcdef',
  consumo: '01984f5a-9b8e-7def-8123-456789abcdef'
});
const FECHA = '2026-09-06T10:00:00.000Z';

await main();

async function main() {
  verificarCatalogosYCadena();
  const emision = verificarEmision();
  const consumo = verificarConsumo();
  verificarSobreCanonico(emision, '1');
  verificarSobreCanonico(consumo, '1');
  await verificarRedaccionYFronteras(emision, consumo);
  await verificarPresentacion();
  console.log(
    '[usuarios] OK 5.30.2a: flujo=internet cadena=internet:portal ' +
    'emision=anonima consumo=usuario causalidad=solicitudId ids=preasignados ' +
    'visibilidad=portal productores_reales=0 secretos=redactados'
  );
}

function verificarCatalogosYCadena() {
  assert.ok(FLUJOS_AUDITORIA.includes('internet'));
  assert.ok(SUJETOS_AUDITORIA.includes('frontera_internet'));
  assert.ok(CAUSALIDADES_AUDITORIA.includes('solicitud_recuperacion_password'));
  assert.equal(construirClaveCadenaAuditoria({ flujo: 'internet' }), 'internet:portal');
  assert.throws(
    () => construirClaveCadenaAuditoria({ flujo: 'internet', tenantId: '7' }),
    /solo admite la cadena portal/iu
  );

  const emision = obtenerDefinicionTipoEventoAuditoria(
    'recuperacion_password.solicitud_emitida'
  );
  const consumo = obtenerDefinicionTipoEventoAuditoria('usuario.password_recuperado');
  assert.deepEqual(emision.parejasActorOrigen, [{ actor: 'sistema', origen: 'web' }]);
  assert.deepEqual(emision.sujetos, ['frontera_internet']);
  assert.deepEqual(consumo.parejasActorOrigen, [{ actor: 'sistema', origen: 'web' }]);
  assert.deepEqual(consumo.sujetos, ['usuario']);
}

function verificarEmision() {
  const intencion = construirIntencionAuditoriaEmisionRecuperacionPassword({
    solicitudId: IDS.solicitud,
    eventoEmisionId: IDS.emision,
    eventoConsumoId: IDS.consumo,
    buzonCanonico: 'persona@example.test',
    direccionIp: '2001:db8::1',
    efectivoEnUtc: FECHA,
    token: 'no-debe-sobrevivir',
    frontera: [{ usuarioId: '1' }]
  });
  assert.equal(intencion.eventoId, IDS.emision);
  assert.equal(intencion.correlacionId, IDS.solicitud);
  assert.equal(intencion.claveCadena, 'internet:portal');
  assert.deepEqual(intencion.scope, { tenantId: null, empresaId: null, sitioId: null });
  assert.deepEqual(intencion.actorReal, { tipo: 'sistema', id: 'sentinelia-system' });
  assert.deepEqual(intencion.sujeto, { tipo: 'frontera_internet', id: 'portal' });
  assert.equal(intencion.causalidad, null);
  assert.ok(Object.isFrozen(intencion));
  assert.throws(
    () => construirIntencionAuditoriaEmisionRecuperacionPassword({
      solicitudId: IDS.solicitud,
      eventoEmisionId: IDS.emision,
      eventoConsumoId: IDS.consumo,
      buzonCanonico: 'persona@EXAMPLE.test',
      direccionIp: '198.51.100.7',
      efectivoEnUtc: FECHA
    }),
    /canónic|canonic/iu
  );
  assert.throws(
    () => construirIntencionAuditoriaEmisionRecuperacionPassword({
      solicitudId: IDS.solicitud,
      eventoEmisionId: IDS.emision,
      eventoConsumoId: IDS.consumo,
      buzonCanonico: 'persona@example.test',
      direccionIp: 'proxy-no-confiable',
      efectivoEnUtc: FECHA
    }),
    /direccionIp/iu
  );
  return intencion;
}

function verificarConsumo() {
  const intencion = construirIntencionAuditoriaConsumoRecuperacionPassword({
    solicitudId: IDS.solicitud,
    eventoEmisionId: IDS.emision,
    eventoConsumoId: IDS.consumo,
    usuarioId: '42',
    scope: { tenantId: '7', empresaId: '8', sitioId: null },
    efectivoEnUtc: FECHA,
    buzonCanonico: 'no-debe-sobrevivir@example.test',
    tokenHashSha256: 'a'.repeat(64)
  });
  assert.equal(intencion.eventoId, IDS.consumo);
  assert.equal(intencion.correlacionId, IDS.solicitud);
  assert.equal(intencion.claveCadena, 'usuarios:tenant:7');
  assert.deepEqual(intencion.sujeto, { tipo: 'usuario', id: '42' });
  assert.deepEqual(intencion.causalidad, {
    tipo: 'solicitud_recuperacion_password',
    id: IDS.solicitud
  });
  assert.deepEqual(intencion.payload, {
    operacion: 'recuperacion',
    resultado: 'recuperada',
    causa: 'posesion_buzon_verificada'
  });
  assert.throws(
    () => construirIntencionAuditoriaConsumoRecuperacionPassword({
      solicitudId: IDS.solicitud,
      eventoEmisionId: IDS.emision,
      eventoConsumoId: IDS.emision,
      usuarioId: '42',
      scope: { tenantId: null, empresaId: null, sitioId: null },
      efectivoEnUtc: FECHA
    }),
    /deben ser distintos/iu
  );
  return intencion;
}

function verificarSobreCanonico(intencion, secuencia) {
  assert.doesNotThrow(() => construirSobreCanonicoAuditoriaV1({
    ...intencion,
    secuencia,
    registradoEnUtc: FECHA
  }));
}

async function verificarRedaccionYFronteras(emision, consumo) {
  const serializado = JSON.stringify([emision, consumo]);
  for (const prohibido of [
    'no-debe-sobrevivir',
    'tokenHashSha256',
    'usuarioId',
    'generacionRecuperacion',
    'totalCandidatos'
  ]) {
    assert.ok(!serializado.includes(prohibido), `Se filtró ${prohibido}.`);
  }
  const eventosNuevos = new Set([
    'recuperacion_password.solicitud_emitida',
    'usuario.password_recuperado'
  ]);
  const eventosRutas = new Set(MANIFIESTO_RUTAS_AUDITORIA.flatMap(
    (entrada) => entrada.eventos
  ));
  assert.ok([...eventosNuevos].every((tipo) => eventosRutas.has(tipo)));
  assert.ok(MANIFIESTO_PRODUCTORES_INTERNOS_AUDITORIA.every(
    (entrada) => entrada.eventos.every((tipo) => !eventosNuevos.has(tipo))
  ));

  const portal = __testablesRepositorioLecturaAuditoriaSql.condicionScopeEvento(
    { nivelScope: 'portal' },
    'e'
  );
  const tenant = __testablesRepositorioLecturaAuditoriaSql.condicionScopeEvento(
    { nivelScope: 'tenant', tenantId: '7' },
    'e'
  );
  assert.equal(portal.condicion, '1 = 1');
  assert.match(tenant.condicion, /scope_tenant_id = \?/u);

  const repositorio = new RepositorioLecturaAuditoriaSql({
    clienteSql: { obtenerConexion() { throw new Error('No debe consultar SQL.'); } }
  });
  assert.deepEqual(
    await repositorio.causalidadesVisiblesPorTipo({
      tipo: 'solicitud_recuperacion_password',
      ids: [IDS.solicitud],
      contextoUsuarioActual: { nivelScope: 'portal' }
    }),
    [IDS.solicitud]
  );
  assert.deepEqual(
    await repositorio.causalidadesVisiblesPorTipo({
      tipo: 'solicitud_recuperacion_password',
      ids: [IDS.solicitud],
      contextoUsuarioActual: { nivelScope: 'tenant', tenantId: '7' }
    }),
    []
  );
}

async function verificarPresentacion() {
  const vista = await readFile(
    new URL('../apps/sentinelia-web/src/views/portal/auditoria-cronologia.ejs', import.meta.url),
    'utf8'
  );
  assert.match(vista, /value="internet">Frontera de Internet</u);
  assert.match(vista, /value="frontera_internet">Frontera de Internet</u);
  assert.match(vista, /value="solicitud_recuperacion_password"/u);
  assert.match(vista, /pattern="\(internet\|sistema\|/u);
}
