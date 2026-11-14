import assert from 'node:assert/strict';
import { ServicioAutenticacionAgentes } from '../paquetes/agentes/src/ServicioAutenticacionAgentes.js';
import {
  validarEventoAuditableV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

await verificarFalloPrevioAlUmbralNoAudita();
await verificarEntradaEfectivaCuarentena();
await verificarSalidaEfectivaCuarentena();
await verificarNoopNoAudita();

console.log('[agentes] OK: cuarentena=auditable transiciones=efectivas fallos=sin_ruido salida=noop_seguro');

async function verificarFalloPrevioAlUmbralNoAudita() {
  const entorno = crearEntorno({
    resultadoFallo: {
      agente: agente({ estadoAcceso: 'normal', contadorLoginFallidos: 1 }),
      cuarentenaActivada: false,
      estadoAntes: 'normal',
      estadoDespues: 'normal'
    }
  });

  await entorno.servicio.registrarLoginFallido({
    credenciales: agente({ estadoAcceso: 'normal', contadorLoginFallidos: 0 }),
    idAgente: 42,
    loginFallosMaximos: 2,
    cuarentenaSegundos: 60
  });

  assert.deepEqual(entorno.traza, ['begin', 'sql:fallo', 'commit']);
  assert.equal(entorno.auditoria.eventos.length, 0);
}

async function verificarEntradaEfectivaCuarentena() {
  const entorno = crearEntorno({
    resultadoFallo: {
      agente: agente({ estadoAcceso: 'cuarentena', contadorLoginFallidos: 2 }),
      cuarentenaActivada: true,
      estadoAntes: 'normal',
      estadoDespues: 'cuarentena'
    }
  });

  await entorno.servicio.registrarLoginFallido({
    credenciales: agente({ estadoAcceso: 'normal', contadorLoginFallidos: 1 }),
    idAgente: 42,
    loginFallosMaximos: 2,
    cuarentenaSegundos: 60
  });

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:fallo',
    'audit:agente.cuarentena_activada',
    'commit'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'agente.cuarentena_activada');
  assert.deepEqual(evento.actorReal, { tipo: 'sistema', id: 'sentinelia' });
  assert.equal(evento.origen, 'api_agentes');
  assert.deepEqual(evento.payload, {
    estadoAntes: 'normal',
    estadoDespues: 'cuarentena',
    motivo: 'umbral_fallos_login'
  });
}

async function verificarSalidaEfectivaCuarentena() {
  const entorno = crearEntorno({
    resultadoLiberacion: {
      liberada: true,
      agente: agente({ estadoAcceso: 'normal', contadorLoginFallidos: 0 }),
      estadoAntes: 'cuarentena',
      estadoDespues: 'normal'
    }
  });

  await entorno.servicio.liberarCuarentenaExpiradaSiProcede(
    agente({ estadoAcceso: 'cuarentena', contadorLoginFallidos: 2 })
  );

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:liberar',
    'audit:agente.cuarentena_desactivada',
    'commit'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'agente.cuarentena_desactivada');
  assert.deepEqual(evento.payload, {
    estadoAntes: 'cuarentena',
    estadoDespues: 'normal',
    motivo: 'plazo_cuarentena_cumplido'
  });
}

async function verificarNoopNoAudita() {
  const entorno = crearEntorno({
    resultadoLiberacion: {
      liberada: false,
      agente: null,
      estadoAntes: 'normal',
      estadoDespues: 'normal'
    }
  });

  const liberada = await entorno.servicio.liberarCuarentenaExpiradaSiProcede(
    agente({ estadoAcceso: 'normal', contadorLoginFallidos: 0 })
  );

  assert.equal(liberada, false);
  assert.deepEqual(entorno.traza, ['begin', 'sql:liberar', 'commit']);
  assert.equal(entorno.auditoria.eventos.length, 0);
}

function crearEntorno({ resultadoFallo = null, resultadoLiberacion = null } = {}) {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }) {
      validarEventoAuditableV1(intencion);
      traza.push(`audit:${intencion.tipo}`);
      this.eventos.push(intencion);
      return intencion;
    }
  };
  const repositorioAgentes = {
    async registrarLoginFallidoEnTransaccion() {
      traza.push('sql:fallo');
      return resultadoFallo;
    },
    async liberarCuarentenaExpiradaEnTransaccion() {
      traza.push('sql:liberar');
      return resultadoLiberacion;
    }
  };
  const fronteraTransaccional = {
    async ejecutar(trabajo) {
      traza.push('begin');
      const resultado = await trabajo({ id: 'conexion-fake' });
      traza.push('commit');
      return resultado;
    }
  };

  return {
    traza,
    auditoria,
    servicio: new ServicioAutenticacionAgentes({
      repositorioAgentes,
      repositorioSesionesAgentesRedis: {},
      compararSecreto: async () => false,
      fronteraTransaccional,
      servicioAuditoria: auditoria,
      ahora: () => new Date('2026-07-25T10:00:00.000Z')
    })
  };
}

function agente(sobrescritura = {}) {
  return {
    id: 42,
    guid: '123e4567-e89b-42d3-a456-426614174000',
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    estadoAdministrativo: 'activo',
    estadoAcceso: 'normal',
    cuarentenaHastaUtc: null,
    contadorLoginFallidos: 0,
    ...sobrescritura
  };
}
