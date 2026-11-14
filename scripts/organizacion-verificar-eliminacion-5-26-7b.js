import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { canonicalizarRfc8785 } from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  AdaptadorPreparacionEliminacionDirectaAgenteEnTransaccion
} from '../paquetes/agentes/src/AdaptadorPreparacionEliminacionDirectaAgenteEnTransaccion.js';
import { ErrorPreparacionEliminacionAgregadoAgente }
  from '../paquetes/agentes/src/NucleoPreparacionDependenciasAgenteEnTransaccion.js';
import { CoordinadorEliminacionAgregadoAgenteEnTransaccion }
  from '../paquetes/agentes/src/CoordinadorEliminacionAgregadoAgenteEnTransaccion.js';
import { RegistradorAuditoriaEliminacionAgente }
  from '../paquetes/agentes/src/RegistradorAuditoriaEliminacionAgente.js';

const CONEXION = Object.freeze({ id: 'conexion-prestada-5267b' });
const LEASE = Object.freeze({
  operacionId: '018f7f40-4444-7444-8444-444444444444',
  instanciaId: 'worker-5267b',
  leaseToken: '018f7f40-5555-7555-8555-555555555555',
  fencingToken: '3'
});

await main();

async function main() {
  await verificarFronteraDirecta();
  await verificarDefensasDirectas();
  await verificarUnSoloDeleteYEvento();
  await verificarSuperficiePrebeta();
  console.log(
    '[organizacion] OK 5.26.7b: adaptador=eliminacion_directa ' +
    'reclamo=delegado_bajo_lease guid=estricto scope=estricto huella=constante ' +
    'nucleo=unico delete_raiz=1 auditoria=agente_eliminado_unico ' +
    'ausencia=reentrada_sin_preparar compatibilidad_prebeta=retirada ' +
    'regresion_5_25=compatible'
  );
}

async function verificarFronteraDirecta() {
  const escenario = crearEscenario();
  const resultado = await escenario.adaptador.prepararEnTransaccion(
    { lease: LEASE },
    { conexion: CONEXION }
  );
  assert.equal(escenario.cargas.length, 1);
  assert.equal(escenario.cargas[0].lease, LEASE);
  assert.equal(escenario.cargas[0].conexion, CONEXION);
  assert.equal(escenario.invocacionesNucleo.length, 1);
  const entrada = escenario.invocacionesNucleo[0];
  assert.equal(entrada.conexion, CONEXION);
  assert.deepEqual(entrada.datos.agenteActual, escenario.bloqueado.comando.sujeto);
  assert.deepEqual(entrada.datos.operacionCausal, {
    operacionId: escenario.bloqueado.comando.identidades.operacionId,
    tipo: 'eliminar_agente',
    version: 1
  });
  assert.deepEqual(entrada.datos.scope, escenario.bloqueado.comando.sujeto.scope);
  assert.equal(entrada.datos.actores.real.usuarioId, '7');
  assert.equal(entrada.datos.actores.efectivo.usuarioId, '8');
  assert.equal(resultado.estado, 'inventariado');
  assert.equal(resultado.comando, escenario.bloqueado.comando);
  assert.deepEqual(resultado.conjuntosEstructurales.concesionesDdns,
    ['018f7f40-9999-7999-8999-999999999999']);
}

async function verificarDefensasDirectas() {
  for (const mutar of [
    (bloqueado) => { bloqueado.fotografiaAdministrativa.guid = 'guid-distinto'; },
    (bloqueado) => { bloqueado.fotografiaAdministrativa.scope.sitioId = '99'; },
    (bloqueado) => {
      bloqueado.comando.fotografiaEstructural.huellaEstructuralSha256 =
        '0'.repeat(64);
    }
  ]) {
    const escenario = crearEscenario({ mutar });
    await assert.rejects(
      escenario.adaptador.prepararEnTransaccion(
        { lease: LEASE },
        { conexion: CONEXION }
      ),
      (error) => error instanceof ErrorPreparacionEliminacionAgregadoAgente &&
        error.codigo === 'agente_eliminacion_estructura_modificada'
    );
    assert.equal(escenario.invocacionesNucleo.length, 0);
  }

  const ausente = crearEscenario({ ausente: true });
  const resultado = await ausente.adaptador.prepararEnTransaccion(
    { lease: LEASE },
    { conexion: CONEXION }
  );
  assert.equal(resultado.estado, 'agente_ausente');
  assert.equal(resultado.postcondicionesEsperadas.raizAntesDelDelete, '0');
  assert.equal(ausente.invocacionesNucleo.length, 0);
}

async function verificarUnSoloDeleteYEvento() {
  const escenario = crearEscenario();
  let deletes = 0;
  let verificaciones = 0;
  let finalizaciones = 0;
  const eventos = [];
  const registradorAuditoria = new RegistradorAuditoriaEliminacionAgente({
    servicioAuditoria: {
      async registrarEnTransaccion({ intencion }, { conexion }) {
        assert.equal(conexion, CONEXION);
        eventos.push(intencion);
        return {
          evento: intencion,
          genesis: [],
          registradoEnUtc: '2026-08-30T15:00:05.001Z',
          esNoOp: false
        };
      }
    }
  });
  const coordinador = new CoordinadorEliminacionAgregadoAgenteEnTransaccion({
    adaptadorPreparacion: escenario.adaptador,
    repositorioEliminacion: {
      async eliminarRaizEnTransaccion({ agenteId }, { conexion }) {
        assert.equal(agenteId, '41');
        assert.equal(conexion, CONEXION);
        deletes += 1;
        return {
          agenteId,
          eliminadas: '1',
          efectivoEnUtc: '2026-08-30T15:00:05.000Z'
        };
      },
      async verificarPostcondicionesEliminacionEnTransaccion(
        { preparacion },
        { conexion }
      ) {
        assert.equal(preparacion.sujeto.id, '41');
        assert.equal(conexion, CONEXION);
        verificaciones += 1;
        return { agente: '0', dependenciasCriticas: '0' };
      }
    },
    registradorAuditoria,
    finalizadorResultado: {
      async finalizarEnTransaccion({ registroAuditoria }, { conexion }) {
        assert.equal(registroAuditoria.evento.tipo, 'agente.eliminado');
        assert.equal(conexion, CONEXION);
        finalizaciones += 1;
        return { estado: 'completada' };
      }
    }
  });

  const resultado = await coordinador.ejecutar(
    { lease: LEASE },
    { conexion: CONEXION }
  );
  assert.equal(resultado.estado, 'eliminado_en_transaccion');
  assert.equal(deletes, 1);
  assert.equal(verificaciones, 1);
  assert.equal(finalizaciones, 1);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'agente.eliminado');
  assert.equal(eventos[0].sujeto.id, '41');
}

async function verificarSuperficiePrebeta() {
  const [runtime, coordinador] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/agentes/crearMotorEliminacionAdministrativaAgentesRuntime.js'),
    leer('../paquetes/agentes/src/CoordinadorEliminacionAgregadoAgenteEnTransaccion.js')
  ]);
  assert.match(runtime, /AdaptadorPreparacionEliminacionDirectaAgenteEnTransaccion/u);
  assert.match(coordinador, /prepararEnTransaccion/u);
  await assert.rejects(
    readFile(new URL(
      '../paquetes/agentes/src/PreparadorEliminacionAgregadoAgenteEnTransaccion.js',
      import.meta.url
    )),
    (error) => error.code === 'ENOENT'
  );
}

function crearEscenario({ mutar = null, ausente = false } = {}) {
  const bloqueado = crearBloqueado();
  if (mutar) mutar(bloqueado);
  const cargas = [];
  const invocacionesNucleo = [];
  const repositorioEliminacion = {
    async cargarInventarioBloqueadoEnTransaccion(lease, { conexion }) {
      cargas.push({ lease, conexion });
      return ausente
        ? {
            estado: 'agente_ausente',
            comando: bloqueado.comando,
            ordenBloqueo: ['operacion', 'reclamo', 'agente']
          }
        : bloqueado;
    }
  };
  const nucleoPreparacionDependencias = {
    async prepararEnTransaccion(datos, { conexion }) {
      invocacionesNucleo.push({ datos, conexion });
      return {
        agenteId: datos.agenteActual.id,
        retiradasFederadas: { identidadesRetiradas: '2' },
        neutralizacionSesion: {
          operacionesReemplazadas: '1',
          retiradasPendientes: []
        },
        obligacionesPostcommit: [{ obligacionId: 'obligacion-1' }],
        ejecucionesTriggers: { eliminadas: '2' },
        postcondicionesEsperadas: {
          agenteId: datos.agenteActual.id,
          raizAntesDelDelete: '1',
          ejecucionesTriggers: '0',
          obligacionesPostcommit: '1',
          operacionesSesionReemplazadas: '1'
        }
      };
    }
  };
  return {
    bloqueado,
    cargas,
    invocacionesNucleo,
    adaptador: new AdaptadorPreparacionEliminacionDirectaAgenteEnTransaccion({
      repositorioEliminacion,
      nucleoPreparacionDependencias
    })
  };
}

function crearBloqueado() {
  const sujeto = {
    tipo: 'agente',
    id: '41',
    guid: '01234567-89ab-4def-8abc-0123456789ab',
    scope: { nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '3' }
  };
  const fotografiaCanonica = {
    reglas: [],
    monitores: [{ id: '11' }],
    asignacionesTrigger: [],
    perfilesServidor: [{ generacion: '4' }],
    dependenciasFederadas: [],
    ddns: { concesiones: [{ concesionId: '018f7f40-9999-7999-8999-999999999999' }] }
  };
  const huella = createHash('sha256')
    .update(canonicalizarRfc8785(fotografiaCanonica), 'utf8')
    .digest('hex');
  return {
    estado: 'inventariado',
    comando: {
      version: 1,
      tipoOperacion: 'eliminar_agente',
      identidades: {
        operacionId: LEASE.operacionId,
        claveOperacion: '018f7f40-6666-7666-8666-666666666666',
        correlacionId: '018f7f40-7777-7777-8777-777777777777',
        eventoId: '018f7f40-8888-7888-8888-888888888888'
      },
      sujeto,
      fotografiaAutorizacion: {
        aceptadaEnUtc: '2026-08-30T15:00:00.000Z',
        actorReal: { usuarioId: '7' },
        actorEfectivo: { usuarioId: '8' },
        destinatarioUsuarioId: '7'
      },
      fotografiaEstructural: { huellaEstructuralSha256: huella },
      resumenImpacto: { perfil: 'impacto-agente-v1', version: 1 }
    },
    fotografiaAdministrativa: {
      ...structuredClone(sujeto),
      nombre: 'Agente directo',
      descripcion: 'Regresión 5.26.7b',
      estadoAdministrativo: 'activo',
      estadoAcceso: 'normal',
      versionAgente: '1.0.0'
    },
    impacto: {
      fotografiaCanonica,
      conteos: [
        { categoria: 'ejecuciones_trigger', cantidad: '2', precision: 'exacta' },
        {
          categoria: 'correo_aceptado_preservadas',
          cantidad: '0',
          precision: 'exacta'
        },
        { categoria: 'referencias_compartidas', cantidad: '0', precision: 'exacta' }
      ]
    },
    ordenBloqueo: ['operacion', 'reclamo', 'agente', 'dependencias']
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
