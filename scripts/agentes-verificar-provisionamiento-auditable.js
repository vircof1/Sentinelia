import assert from 'node:assert/strict';
import { ServicioProvisionamientoAgentes } from '../paquetes/agentes/src/ServicioProvisionamientoAgentes.js';
import {
  validarEventoAuditableV1,
  validarParMovimientoAuditoriaV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

async function main() {
  await verificarAltaSinSecretoEnEvidencia();
  await verificarMetadatosAuditables();
  await verificarMovimientoScopeVersionEInvalidacion();

  console.log(
    '[agentes] OK: provisionamiento=auditable metadatos=diff scope=movimiento versionScope=incrementa sesion=invalidacion secrets=omitidos'
  );
}

async function verificarAltaSinSecretoEnEvidencia() {
  const entorno = crearEntorno();
  const resultado = await entorno.servicio.provisionarAgente(contextoPortal(), {
    sitioId: 30,
    nombre: 'Agente de sala',
    descripcion: 'Sensor principal'
  });

  assert.equal(resultado.credenciales.secreto, 'secreto-solo-respuesta');
  assert.deepEqual(entorno.traza, [
    'permiso', 'begin', 'autoridad:alta', 'sql:crear',
    'audit:agente.provisionado:principal', 'commit'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'agente.provisionado');
  assert.equal(JSON.stringify(evento.payload).includes('secreto'), false);
  assert.equal(JSON.stringify(evento.payload).includes('hash'), false);
  assert.equal(evento.payload.despues.nombre, 'Agente de sala');
}

async function verificarMetadatosAuditables() {
  const entorno = crearEntorno();
  entorno.agente = agenteFixture({
    id: 77,
    nombre: 'Agente anterior',
    descripcion: 'Vieja'
  });
  await entorno.servicio.editarMetadatosAgente(contextoPortal(), 77, {
    nombre: 'Agente nuevo',
    descripcion: 'Nueva'
  });
  assert.deepEqual(entorno.traza, ['permiso', 'begin', 'sql:metadatos', 'audit:agente.metadatos_cambiados:principal', 'commit']);
  const evento = entorno.auditoria.eventos[0];
  assert.deepEqual(evento.payload.camposCambiados, ['descripcion', 'nombre']);
  assert.equal(evento.payload.antes.nombre, 'Agente anterior');
  assert.equal(evento.payload.despues.nombre, 'Agente nuevo');
}

async function verificarMovimientoScopeVersionEInvalidacion() {
  const entorno = crearEntorno();
  entorno.agente = agenteFixture({
    id: 88,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    versionScopeAgente: '4',
    sesionAuditoriaId: '01980000-0000-7000-8000-0000000000ab'
  });
  entorno.sitio = { id: 6, tenantId: 4, empresaId: 5 };

  const resultado = await entorno.servicio.moverAgenteASitio(contextoPortal(), 88, 6);

  assert.equal(resultado.agente.versionScopeAgente, '5');
  assert.deepEqual(entorno.traza, [
    'permiso',
    'begin',
    'autoridad:movimiento',
    'sql:scope',
    'audit-mov:scope.entidad_salida/scope.entidad_entrada',
    'sql:invalidacion-tecnica',
    'audit:agente.sesion_invalidada:resultado',
    'commit',
    'redis:invalidar:scope_cambiado'
  ]);
  const [salida, entrada, invalidacion] = entorno.auditoria.eventos;
  assert.equal(salida.tipo, 'scope.entidad_salida');
  assert.equal(entrada.tipo, 'scope.entidad_entrada');
  assert.equal(invalidacion.tipo, 'agente.sesion_invalidada');
  assert.deepEqual(invalidacion.causalidad, {
    tipo: 'evento_auditoria',
    id: salida.eventoId
  });
  assert.equal(entorno.operacionesInvalidacion[0].agenteId, 88);
  assert.equal(entorno.operacionesInvalidacion[0].sesionAuditoriaId, '01980000-0000-7000-8000-0000000000ab');
  assert.match(entorno.operacionesInvalidacion[0].huellaIntencion, /^[0-9a-f]{64}$/);
}

function crearEntorno() {
  const traza = [];
  const auditoria = new AuditoriaFake(traza);
  const entorno = {
    traza,
    auditoria,
    operacionesInvalidacion: [],
    sitio: { id: 30, tenantId: 10, empresaId: 20 },
    agente: agenteFixture({ id: 50 })
  };
  const repositorioAgentes = {
    async crearEnTransaccion(datos) {
      traza.push('sql:crear');
      entorno.agente = agenteFixture({
        id: 50,
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        tenantId: datos.tenantId,
        empresaId: datos.empresaId,
        sitioId: datos.sitioId,
        versionSecreto: 1
      });
      return entorno.agente;
    },
    async actualizarMetadatosEnTransaccion(datos) {
      traza.push('sql:metadatos');
      entorno.agente = agenteFixture({
        ...entorno.agente,
        nombre: datos.nombre,
        descripcion: datos.descripcion
      });
      return entorno.agente;
    },
    async actualizarPertenenciaEnTransaccion(datos) {
      traza.push('sql:scope');
      entorno.agente = agenteFixture({
        ...entorno.agente,
        tenantId: datos.tenantId,
        empresaId: datos.empresaId,
        sitioId: datos.sitioId,
        versionScopeAgente: String(BigInt(entorno.agente.versionScopeAgente) + 1n)
      });
      return entorno.agente;
    },
    async buscarPorId() {
      return entorno.agente;
    }
  };
  const servicio = new ServicioProvisionamientoAgentes({
    repositorioAgentes,
    repositorioSitios: {
      async buscarPorId() {
        return entorno.sitio;
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
    generadorCredenciales: {
      async generarParCredenciales() {
        return {
          guid: '11111111-1111-4111-8111-111111111111',
          secreto: 'secreto-solo-respuesta',
          secretoHash: 'hash-persistente-suficientemente-largo'
        };
      }
    },
    invalidarSesionesAgente: async ({ motivo }) => {
      traza.push(`redis:invalidar:${motivo}`);
    },
    fronteraTransaccional: {
      async ejecutar(operacion) {
        traza.push('begin');
        try {
          const resultado = await operacion({});
          traza.push('commit');
          return resultado;
        } catch (error) {
          traza.push('rollback');
          throw error;
        }
      }
    },
    servicioAuditoria: auditoria,
    servicioAutoridadMutacionesEstructurales: {
      async serializarAltaEnTransaccion({ scopePadre }) {
        traza.push('autoridad:alta');
        assert.deepEqual(scopePadre, {
          tenantId: String(entorno.sitio.tenantId),
          empresaId: String(entorno.sitio.empresaId),
          sitioId: String(entorno.sitio.id)
        });
      }
    },
    servicioAutoridadMovimientoAgente: {
      async autorizarEnTransaccion({ agenteId, scopeOrigen, scopeDestino }) {
        traza.push('autoridad:movimiento');
        assert.equal(agenteId, entorno.agente.id);
        assert.deepEqual(scopeOrigen, {
          tenantId: String(entorno.agente.tenantId),
          empresaId: String(entorno.agente.empresaId),
          sitioId: String(entorno.agente.sitioId)
        });
        assert.deepEqual(scopeDestino, {
          tenantId: String(entorno.sitio.tenantId),
          empresaId: String(entorno.sitio.empresaId),
          sitioId: String(entorno.sitio.id)
        });
      }
    },
    repositorioOperacionesSesionAgentes: {
      async crearInvalidacionEnTransaccion(datos) {
        traza.push('sql:invalidacion-tecnica');
        entorno.operacionesInvalidacion.push(datos);
        return { operacionId: datos.operacionId };
      }
    },
    ahora: () => new Date('2026-01-01T00:00:00.000Z')
  });
  entorno.servicio = servicio;
  return entorno;
}

class AuditoriaFake {
  constructor(traza) {
    this.traza = traza;
    this.eventos = [];
  }

  async registrarEnTransaccion({ intencion }) {
    this.traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
    validarEventoAuditableV1({
      tipo: intencion.tipo,
      actor: intencion.actorReal.tipo,
      origen: intencion.origen,
      sujeto: intencion.sujeto,
      flujo: intencion.flujo,
      productor: intencion.productor,
      rolEvento: intencion.rolEvento,
      payload: intencion.payload
    });
    const evento = Object.freeze({ ...intencion, estado: 'incorporado' });
    this.eventos.push(evento);
    return { estado: 'incorporado', evento, genesis: [], esNoOp: false };
  }

  async registrarMovimientoEnTransaccion({ salida, entrada }) {
    this.traza.push(`audit-mov:${salida.tipo}/${entrada.tipo}`);
    for (const intencion of [salida, entrada]) {
      validarEventoAuditableV1({
        tipo: intencion.tipo,
        actor: intencion.actorReal.tipo,
        origen: intencion.origen,
        sujeto: intencion.sujeto,
        flujo: intencion.flujo,
        productor: intencion.productor,
        rolEvento: intencion.rolEvento,
        payload: intencion.payload
      });
    }
    validarParMovimientoAuditoriaV1(salida, entrada);
    const eventos = [
      Object.freeze({ ...salida, estado: 'incorporado' }),
      Object.freeze({ ...entrada, estado: 'incorporado' })
    ];
    this.eventos.push(...eventos);
    return {
      estado: 'incorporado',
      salida: eventos[0],
      entrada: eventos[1],
      genesis: [],
      esNoOp: false
    };
  }
}

function contextoPortal() {
  return {
    idUsuario: 1,
    idUsuarioReal: 1,
    impersonacionActiva: false,
    permisos: { modificarAgentes: true },
    nivelScope: 'portal'
  };
}

function agenteFixture({
  id,
  nombre = 'Agente',
  descripcion = 'Descripcion',
  tenantId = 10,
  empresaId = 20,
  sitioId = 30,
  versionSecreto = 1,
  versionScopeAgente = '1',
  versionAutorizacionAgente = '1',
  estadoAdministrativo = 'activo',
  estadoAcceso = 'normal',
  sesionAuditoriaId = null
}) {
  return {
    id,
    nombre,
    descripcion,
    tenantId,
    empresaId,
    sitioId,
    versionSecreto,
    versionScopeAgente,
    versionAutorizacionAgente,
    estadoAdministrativo,
    estadoAcceso,
    sesionAuditoriaId
  };
}

main().catch((error) => {
  console.error('[agentes] Falló la verificación de provisionamiento auditable.');
  console.error(error);
  process.exit(1);
});
