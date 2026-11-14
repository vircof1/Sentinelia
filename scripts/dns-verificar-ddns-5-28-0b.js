import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  PERFILES_DDNS_AGENTES,
  VERSION_CONTRATO_DDNS_AGENTES
} from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import {
  PRESUPUESTO_PUBLICACION_DDNS_AGENTES,
  cambiarOperabilidadRegistroDdnsAgentes,
  crearEstadoInicialDdnsAgentes,
  decidirIntencionDdnsAgentes,
  marcarContenidoDeseadoPersistidoDdnsAgentes,
  marcarContenidoPublicadoDdnsAgentes,
  marcarObjetivoEliminadoDdnsAgentes,
  marcarObjetivoIncompatibleDdnsAgentes,
  recuperarBloqueoPublicacionDdnsAgentes,
  registrarFalloPublicacionDdnsAgentes,
  revocarConcesionDdnsAgentes
} from '../paquetes/dns/src/MaquinaEstadoDdnsAgentes.js';

verificarNacimientoYCambioDeModo();
verificarVersionEIdempotencia();
verificarConvergenciaYSustitucion();
verificarPublicacionYPresupuesto();
verificarPausaYBloqueo();
verificarRevocacionYObjetivos();
await verificarPureza();

console.log(
  '[dns-ddns] OK 5.28.0b: nacimiento=pendiente version=optimista ' +
  'idempotencia=estable convergencia=semantica presupuesto=3 ' +
  'pausa=conservativa terminales=cerrados pureza=verificada'
);

function estado(tipo = 'A', modo = 'declarada', valor = { direccionIpv4: '192.0.2.10' }) {
  return {
    perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    tipo,
    modo,
    valor
  };
}

function solicitud(versionEsperada, estadoDeseado, solicitudId = generarUuidV7Auditoria()) {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId,
    versionEsperada,
    estadoDeseado
  };
}

function inicial() {
  return crearEstadoInicialDdnsAgentes({ concesionId: generarUuidV7Auditoria() });
}

function aceptar(base, deseado = estado(), solicitudId = generarUuidV7Auditoria()) {
  return decidirIntencionDdnsAgentes(
    base,
    solicitud(base.version, deseado, solicitudId)
  );
}

function gobernante(maquina) {
  return maquina.intenciones.find(
    ({ version }) => version === maquina.intencionGobernanteVersion
  );
}

function verificarNacimientoYCambioDeModo() {
  const base = inicial();
  assert.equal(base.version, '0');
  assert.equal(base.decision, 'pendiente_decision_agente');
  assert.equal(base.condicion, 'pendiente_decision_agente');
  assert.equal(Object.isFrozen(base), true);

  const cambio = aceptar(base, estado('AAAA', 'observada', null));
  assert.equal(cambio.respuesta.resultado, 'aceptada');
  assert.equal(cambio.estado.version, '1');
  assert.equal(cambio.estado.condicion, 'esperando_observacion');
  assert.equal(gobernante(cambio.estado).hito, 'intencion_aceptada');
  assert.equal(gobernante(cambio.estado).presupuestoAbierto, false);
  assert.throws(
    () => marcarContenidoDeseadoPersistidoDdnsAgentes(cambio.estado),
    /causa POL posterior/iu
  );
}

function verificarVersionEIdempotencia() {
  const id = generarUuidV7Auditoria();
  const primera = aceptar(inicial(), estado(), id);
  const repetida = decidirIntencionDdnsAgentes(
    primera.estado,
    solicitud('0', estado(), id)
  );
  assert.equal(repetida.respuesta.resultado, 'repetida');
  assert.deepEqual(repetida.estado, primera.estado);
  assert.equal(repetida.estado.version, '1');
  assert.equal(gobernante(repetida.estado).intentosConsumidos, 0);

  const conflicto = decidirIntencionDdnsAgentes(
    primera.estado,
    solicitud('1', estado('A', 'declarada', { direccionIpv4: '192.0.2.11' }), id)
  );
  assert.equal(conflicto.respuesta.error, 'idempotencia_conflictiva');
  assert.deepEqual(conflicto.estado, primera.estado);

  const obsoleta = decidirIntencionDdnsAgentes(
    primera.estado,
    solicitud('0', estado('A', 'declarada', { direccionIpv4: '192.0.2.12' }))
  );
  assert.equal(obsoleta.respuesta.error, 'version_obsoleta');
  assert.equal(obsoleta.estado.version, '1');
}

function verificarConvergenciaYSustitucion() {
  const primera = aceptar(inicial());
  const convergente = decidirIntencionDdnsAgentes(
    primera.estado,
    solicitud('0', estado())
  );
  assert.equal(convergente.respuesta.resultado, 'convergente');
  assert.equal(convergente.estado.version, '1');
  assert.equal(convergente.estado.intenciones.length, 1);

  const segunda = aceptar(
    convergente.estado,
    estado('A', 'declarada', { direccionIpv4: '192.0.2.20' })
  );
  assert.equal(segunda.estado.version, '2');
  assert.equal(segunda.estado.intenciones[0].terminal, 'sustituida');
  assert.equal(segunda.estado.intenciones[1].terminal, null);

  const publicada = marcarContenidoPublicadoDdnsAgentes(
    marcarContenidoDeseadoPersistidoDdnsAgentes(segunda.estado)
  );
  const sinCambios = decidirIntencionDdnsAgentes(
    publicada,
    solicitud('0', estado('A', 'declarada', { direccionIpv4: '192.0.2.20' }))
  );
  assert.equal(sinCambios.respuesta.resultado, 'sin_cambios');
  assert.equal(sinCambios.estado.version, '2');
}

function verificarPublicacionYPresupuesto() {
  let maquina = marcarContenidoDeseadoPersistidoDdnsAgentes(
    aceptar(inicial()).estado
  );
  assert.equal(gobernante(maquina).presupuestoAbierto, true);
  assert.equal(PRESUPUESTO_PUBLICACION_DDNS_AGENTES, 3);
  for (let numero = 1; numero <= 3; numero += 1) {
    maquina = registrarFalloPublicacionDdnsAgentes(maquina, { atribuible: true });
    assert.equal(gobernante(maquina).intentosConsumidos, numero);
  }
  assert.equal(gobernante(maquina).terminal, 'publicacion_fallida');
  assert.equal(maquina.condicion, 'publicacion_fallida');
  assert.throws(
    () => registrarFalloPublicacionDdnsAgentes(maquina, { atribuible: true }),
    /terminal/iu
  );
  const mismo = decidirIntencionDdnsAgentes(maquina, solicitud('0', estado()));
  assert.equal(mismo.respuesta.resultado, 'sin_cambios');
  assert.equal(gobernante(mismo.estado).intentosConsumidos, 3);

  const exito = marcarContenidoPublicadoDdnsAgentes(
    marcarContenidoDeseadoPersistidoDdnsAgentes(aceptar(inicial()).estado)
  );
  assert.equal(gobernante(exito).terminal, 'publicada');
  assert.equal(gobernante(exito).hito, 'contenido_publicado');
}

function verificarPausaYBloqueo() {
  const persistida = marcarContenidoDeseadoPersistidoDdnsAgentes(
    aceptar(inicial()).estado
  );
  const bloqueada = registrarFalloPublicacionDdnsAgentes(
    persistida,
    { atribuible: false }
  );
  assert.equal(bloqueada.condicion, 'publicacion_bloqueada');
  assert.equal(gobernante(bloqueada).intentosConsumidos, 0);
  const recuperada = recuperarBloqueoPublicacionDdnsAgentes(bloqueada);
  assert.equal(recuperada.condicion, 'operativa');
  assert.equal(gobernante(recuperada).intentosConsumidos, 0);

  const pausada = cambiarOperabilidadRegistroDdnsAgentes(bloqueada, false);
  assert.equal(pausada.condicion, 'registro_no_operable');
  const rechazo = aceptar(pausada, estado('A', 'declarada', { direccionIpv4: '192.0.2.99' }));
  assert.equal(rechazo.respuesta.error, 'registro_no_operable');
  const reanudada = cambiarOperabilidadRegistroDdnsAgentes(pausada, true);
  assert.equal(reanudada.condicion, 'publicacion_bloqueada');
  assert.equal(gobernante(reanudada).intentosConsumidos, 0);
}

function verificarRevocacionYObjetivos() {
  const aceptada = aceptar(inicial()).estado;
  const revocada = revocarConcesionDdnsAgentes(aceptada);
  assert.equal(revocada.estadoConcesion, 'revocada');
  assert.equal(gobernante(revocada).terminal, null,
    'revocar después de aceptar conserva el curso causal');
  const posterior = aceptar(revocada, estado('A', 'declarada', { direccionIpv4: '192.0.2.30' }));
  assert.equal(posterior.respuesta.error, 'sin_autoridad');

  const incompatible = marcarObjetivoIncompatibleDdnsAgentes(aceptada);
  assert.equal(gobernante(incompatible).terminal, 'objetivo_incompatible');
  const eliminado = marcarObjetivoEliminadoDdnsAgentes(aceptada);
  assert.equal(gobernante(eliminado).terminal, 'objetivo_eliminado');
}

async function verificarPureza() {
  const fuente = await readFile(
    new URL('../paquetes/dns/src/MaquinaEstadoDdnsAgentes.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(
    fuente,
    /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\b(?:redis|express|rndc)\b|fetch\s*\(/u
  );
  assert.doesNotMatch(fuente, /Date\.now|new Date/u);
}
