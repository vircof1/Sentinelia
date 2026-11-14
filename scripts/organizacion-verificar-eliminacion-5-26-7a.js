import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ErrorPreparacionEliminacionAgregadoAgente,
  NucleoPreparacionDependenciasAgenteEnTransaccion
} from '../paquetes/agentes/src/NucleoPreparacionDependenciasAgenteEnTransaccion.js';

const OPERACION_ID = '018f7f40-3333-7333-8333-333333333333';
const CONEXION = Object.freeze({
  async commit() { throw new Error('El núcleo no gobierna el commit.'); },
  async rollback() { throw new Error('El núcleo no gobierna el rollback.'); }
});

await main();

async function main() {
  verificarConstruccionCerrada();
  await verificarPreparacionReutilizable();
  await verificarIdentidadesPorAgenteYReentrada();
  await verificarFalloFederadoSaneado();
  await verificarFronteraEstatica();
  console.log(
    '[organizacion] OK 5.26.7a: nucleo=agente_reutilizable ' +
    'entrada=agente_operacion_actores_scope conexion=prestada ' +
    'sesion=neutralizada triggers=frontera_preparada federacion=preparada ' +
    'obligaciones=deterministas identidades=operacion_agente_efecto ' +
    'delete=no auditoria=no commit=no adaptador_directo=verde'
  );
}

async function verificarFronteraEstatica() {
  const fuente = await readFile(new URL(
    '../paquetes/agentes/src/NucleoPreparacionDependenciasAgenteEnTransaccion.js',
    import.meta.url
  ), 'utf8');
  assert.doesNotMatch(fuente, /eliminarRaizEnTransaccion/u);
  assert.doesNotMatch(fuente, /registrarEnTransaccion/u);
  assert.doesNotMatch(fuente, /\.commit\s*\(/u);
  assert.doesNotMatch(fuente, /\.rollback\s*\(/u);
}

function verificarConstruccionCerrada() {
  assert.throws(
    () => new NucleoPreparacionDependenciasAgenteEnTransaccion(),
    /cargarContextoSesionBloqueadaEnTransaccion/u
  );
}

async function verificarPreparacionReutilizable() {
  const entorno = crearEntorno();
  const resultado = await entorno.nucleo.prepararEnTransaccion(
    entrada({ agenteId: '41' }),
    { conexion: CONEXION }
  );

  assert.deepEqual(entorno.traza.map(({ paso }) => paso), [
    'contexto_sesion',
    'federacion',
    'neutralizacion_sesion',
    'obligaciones',
    'ejecuciones_trigger'
  ]);
  assert.ok(entorno.traza.every(({ conexion }) => conexion === CONEXION));
  const neutralizacion = entorno.traza.find(
    ({ paso }) => paso === 'neutralizacion_sesion'
  ).entrada;
  assert.equal(neutralizacion.causaOperacionId, OPERACION_ID);
  assert.equal(neutralizacion.agenteId, '41');
  assert.deepEqual(neutralizacion.actor, { tipo: 'usuario', id: '7' });
  assert.deepEqual(neutralizacion.actorEfectivo, { tipo: 'usuario', id: '8' });
  assert.deepEqual(neutralizacion.scope, {
    tenantId: '1', empresaId: '2', sitioId: '3'
  });
  const lote = entorno.traza.find(({ paso }) => paso === 'obligaciones').entrada;
  assert.equal(lote.obligaciones.length, 5);
  assert.equal(lote.obligaciones.every(
    ({ operacionId }) => operacionId === OPERACION_ID
  ), true);
  assert.equal(new Set(lote.obligaciones.map(({ obligacionId }) => obligacionId)).size, 5);
  assert.equal(resultado.ejecucionesTriggers.eliminadas, '3');
  assert.equal(resultado.postcondicionesEsperadas.obligacionesPostcommit, '5');
  assert.equal(Object.isFrozen(resultado), true);
}

async function verificarIdentidadesPorAgenteYReentrada() {
  const primero = crearEntorno();
  const repetido = crearEntorno();
  const segundoAgente = crearEntorno();
  const sinDestinatario = crearEntorno();
  const a = await primero.nucleo.prepararEnTransaccion(
    entrada({ agenteId: '41' }),
    { conexion: CONEXION }
  );
  const b = await repetido.nucleo.prepararEnTransaccion(
    entrada({ agenteId: '41' }),
    { conexion: CONEXION }
  );
  const c = await segundoAgente.nucleo.prepararEnTransaccion(
    entrada({ agenteId: '42' }),
    { conexion: CONEXION }
  );
  const d = await sinDestinatario.nucleo.prepararEnTransaccion(
    entrada({ agenteId: '41', destinatarioUsuarioId: null }),
    { conexion: CONEXION }
  );

  assert.deepEqual(ids(a), ids(b), 'la reentrada debe conservar identidades');
  assert.notDeepEqual(
    ids(a),
    ids(c),
    'dos agentes bajo la misma operación causal no pueden colisionar'
  );
  assert.equal(d.obligacionesPostcommit.length, 4);
  assert.equal(d.obligacionesPostcommit.some(
    ({ tipo }) => tipo === 'publicar_invalidacion_portal'
  ), false);
}

async function verificarFalloFederadoSaneado() {
  const entorno = crearEntorno({ falloFederado: true });
  await assert.rejects(
    entorno.nucleo.prepararEnTransaccion(
      entrada({ agenteId: '41' }),
      { conexion: CONEXION }
    ),
    (error) => error instanceof ErrorPreparacionEliminacionAgregadoAgente &&
      error.codigo === 'agente_eliminacion_identidad_federada_incompleta' &&
      error.permanente === true
  );
}

function crearEntorno({ falloFederado = false } = {}) {
  const traza = [];
  const registrar = (paso, entrada, opciones) => {
    traza.push({ paso, entrada, conexion: opciones.conexion });
  };
  const repositorioDependencias = {
    async cargarContextoSesionBloqueadaEnTransaccion(entrada, opciones) {
      registrar('contexto_sesion', entrada, opciones);
      return { sesionAuditoriaIdBytes: null };
    },
    async eliminarEjecucionesTriggersEnTransaccion(entrada, opciones) {
      registrar('ejecuciones_trigger', entrada, opciones);
      return {
        eliminadas: String(entrada.cantidadEsperada),
        correoAceptadoPreservadas:
          String(entrada.cantidadCorreoAceptadoEsperada),
        idsCorreoAceptadoPreservadas: []
      };
    }
  };
  const servicioRetiradaFederada = {
    async prepararEnTransaccion(entrada, opciones) {
      registrar('federacion', entrada, opciones);
      if (falloFederado) {
        throw Object.assign(new Error('detalle interno'), {
          codigo: 'identidad_federada_incompleta'
        });
      }
      return { identidadesRetiradas: 1, tombstones: 1 };
    }
  };
  const repositorioOperacionesSesion = {
    async neutralizarPorEliminacionEnTransaccion(entrada, opciones) {
      registrar('neutralizacion_sesion', entrada, opciones);
      return {
        operacion: { operacionId: entrada.operacionId },
        retiradasPendientes: [],
        operacionesReemplazadas: '1'
      };
    }
  };
  const repositorioObligacionesPostcommit = {
    async crearORecuperarVariasEnTransaccion(entrada, opciones) {
      registrar('obligaciones', entrada, opciones);
      return entrada.obligaciones;
    }
  };
  return {
    traza,
    nucleo: new NucleoPreparacionDependenciasAgenteEnTransaccion({
      repositorioDependencias,
      servicioRetiradaFederada,
      repositorioOperacionesSesion,
      repositorioObligacionesPostcommit,
      crearObligacionPostcommit: (obligacion) => Object.freeze({ ...obligacion }),
      ahora: () => new Date('2026-08-30T14:00:00.000Z')
    })
  };
}

function entrada({ agenteId, destinatarioUsuarioId = '7' }) {
  return {
    agenteActual: {
      tipo: 'agente',
      id: agenteId,
      guid: `00000000-0000-4000-8000-${agenteId.padStart(12, '0')}`
    },
    operacionCausal: {
      operacionId: OPERACION_ID,
      tipo: 'eliminar_organizacion',
      version: 1
    },
    actores: {
      real: { usuarioId: '7' },
      efectivo: { usuarioId: '8' },
      destinatarioUsuarioId
    },
    scope: {
      nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '3'
    },
    dependencias: {
      conteosFinales: [
        { categoria: 'ejecuciones_trigger', cantidad: '3' },
        { categoria: 'correo_aceptado_preservadas', cantidad: '0' }
      ],
      conjuntosEstructurales: {
        reglas: [],
        monitores: ['11'],
        asignacionesTrigger: [],
        triggersCompartidos: [],
        perfilesServidor: ['2'],
        dependenciasFederadas: []
      }
    }
  };
}

function ids(resultado) {
  return {
    operacionSesion: resultado.neutralizacionSesion.operacion.operacionId,
    obligaciones: resultado.obligacionesPostcommit.map(
      ({ obligacionId }) => obligacionId
    )
  };
}
