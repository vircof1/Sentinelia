import assert from 'node:assert/strict';
import { ServicioProvisionamientoAgentes } from '../paquetes/agentes/src/ServicioProvisionamientoAgentes.js';
import {
  validarEventoAuditableV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

await verificarRotacionSecretoAuditableEInvalidacion();
await verificarDeshabilitacionAuditableEInvalidacion();
await verificarHabilitacionAuditableSinInvalidacion();
await verificarEstadoNoopSinRuido();

console.log('[agentes] OK: secreto=auditable_sin_secretos estado=auditable invalidacion=durable noop=sin_ruido');

async function verificarRotacionSecretoAuditableEInvalidacion() {
  const entorno = crearEntorno();
  entorno.agente = agenteFixture({
    estadoAdministrativo: 'activo',
    sesionAuditoriaId: '01980000-0000-7000-8000-0000000000ea'
  });

  const resultado = await entorno.servicio.rotarSecretoAgente(contextoPortal(), 50);

  assert.equal(resultado.credenciales.secreto, 'secreto-nuevo-solo-respuesta');
  assert.deepEqual(entorno.traza, [
    'permiso',
    'begin',
    'sql:rotar-secreto',
    'audit:agente.secreto_rotado:principal',
    'sql:invalidacion',
    'audit:agente.sesion_invalidada:resultado',
    'commit',
    'redis:invalidar:rotacion_secreto'
  ]);
  const [rotacion, invalidacion] = entorno.auditoria.eventos;
  assert.equal(rotacion.tipo, 'agente.secreto_rotado');
  assert.deepEqual(rotacion.payload, {
    operacion: 'rotacion',
    resultado: 'rotada',
    causa: 'administrador'
  });
  assert.equal(JSON.stringify(rotacion.payload).includes('secreto'), false);
  assert.equal(JSON.stringify(rotacion.payload).includes('hash'), false);
  assert.equal(invalidacion.tipo, 'agente.sesion_invalidada');
  assert.deepEqual(invalidacion.causalidad, {
    tipo: 'evento_auditoria',
    id: rotacion.eventoId
  });
  assert.equal(invalidacion.payload.causa, 'secreto_rotado');
  assert.match(entorno.invalidaciones[0].huellaIntencion, /^[0-9a-f]{64}$/);
}

async function verificarDeshabilitacionAuditableEInvalidacion() {
  const entorno = crearEntorno();
  entorno.agente = agenteFixture({
    estadoAdministrativo: 'activo',
    sesionAuditoriaId: '01980000-0000-7000-8000-0000000000eb'
  });

  await entorno.servicio.deshabilitarAgente(contextoPortal(), 50);

  assert.deepEqual(entorno.traza, [
    'permiso',
    'begin',
    'sql:estado:deshabilitado',
    'audit:agente.estado_administrativo_cambiado:principal',
    'sql:invalidacion',
    'audit:agente.sesion_invalidada:resultado',
    'commit',
    'redis:invalidar:agente_deshabilitado'
  ]);
  const [estado, invalidacion] = entorno.auditoria.eventos;
  assert.deepEqual(estado.payload, {
    estadoAntes: 'activo',
    estadoDespues: 'deshabilitado',
    motivo: 'operador'
  });
  assert.equal(invalidacion.payload.causa, 'estado_administrativo_cambiado');
}

async function verificarHabilitacionAuditableSinInvalidacion() {
  const entorno = crearEntorno();
  entorno.agente = agenteFixture({
    estadoAdministrativo: 'deshabilitado',
    sesionAuditoriaId: '01980000-0000-7000-8000-0000000000ec'
  });

  await entorno.servicio.habilitarAgente(contextoPortal(), 50);

  assert.deepEqual(entorno.traza, [
    'permiso',
    'begin',
    'sql:estado:activo',
    'audit:agente.estado_administrativo_cambiado:principal',
    'commit'
  ]);
  assert.equal(entorno.invalidaciones.length, 0);
  assert.deepEqual(entorno.auditoria.eventos[0].payload, {
    estadoAntes: 'deshabilitado',
    estadoDespues: 'activo',
    motivo: 'operador'
  });
}

async function verificarEstadoNoopSinRuido() {
  const entorno = crearEntorno();
  entorno.agente = agenteFixture({ estadoAdministrativo: 'activo' });

  await entorno.servicio.habilitarAgente(contextoPortal(), 50);

  assert.deepEqual(entorno.traza, [
    'permiso',
    'begin',
    'sql:estado:activo',
    'commit'
  ]);
  assert.equal(entorno.auditoria.eventos.length, 0);
  assert.equal(entorno.invalidaciones.length, 0);
}

function crearEntorno() {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }) {
      validarEventoAuditableV1(intencion);
      traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    },
    async registrarMovimientoEnTransaccion() {
      throw new Error('No se esperan movimientos para una operación sin cambios.');
    }
  };
  const entorno = {
    traza,
    auditoria,
    invalidaciones: [],
    agente: agenteFixture()
  };
  const repositorioAgentes = {
    async buscarPorId(idAgente) {
      assert.equal(Number(idAgente), Number(entorno.agente.id));
      return entorno.agente;
    },
    async rotarSecretoEnTransaccion({ idAgente }) {
      traza.push('sql:rotar-secreto');
      entorno.agente = agenteFixture({
        ...entorno.agente,
        id: idAgente,
        versionSecreto: Number(entorno.agente.versionSecreto) + 1
      });
      return { agente: entorno.agente, cambioEfectivo: true };
    },
    async actualizarEstadoAdministrativoEnTransaccion({ estadoAdministrativo }) {
      traza.push(`sql:estado:${estadoAdministrativo}`);
      const antes = entorno.agente.estadoAdministrativo;
      entorno.agente = agenteFixture({
        ...entorno.agente,
        estadoAdministrativo
      });
      return {
        agente: entorno.agente,
        cambioEfectivo: antes !== estadoAdministrativo,
        estadoAntes: antes,
        estadoDespues: estadoAdministrativo
      };
    }
  };
  const repositorioOperacionesSesionAgentes = {
    async crearInvalidacionEnTransaccion(datos) {
      traza.push('sql:invalidacion');
      entorno.invalidaciones.push(datos);
      return datos;
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
  entorno.servicio = new ServicioProvisionamientoAgentes({
    repositorioAgentes,
    repositorioSitios: {},
    repositorioOperacionesSesionAgentes,
    fronteraTransaccional,
    servicioAuditoria: auditoria,
    generadorCredenciales: {
      generarSecretoPersistente() {
        return 'secreto-nuevo-solo-respuesta';
      },
      async crearHashSecreto() {
        return 'hash-no-auditable';
      }
    },
    politicaPermisosAgentes: {
      assertPuedeModificar() {
        traza.push('permiso');
      },
      puedeAlcanzarAgente() {
        return true;
      }
    },
    invalidarSesionesAgente: async ({ motivo }) => {
      traza.push(`redis:invalidar:${motivo}`);
    },
    ahora: () => new Date('2026-07-25T10:00:00.000Z')
  });
  return entorno;
}

function contextoPortal() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3
  };
}

function agenteFixture(sobrescritura = {}) {
  return {
    id: 50,
    guid: '123e4567-e89b-42d3-a456-426614174000',
    nombre: 'Agente verificable',
    descripcion: 'Fixture',
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    estadoAdministrativo: 'activo',
    estadoAcceso: 'normal',
    versionSecreto: 4,
    versionScopeAgente: '8',
    versionAutorizacionAgente: '9',
    sesionAuditoriaId: null,
    ...sobrescritura
  };
}
