import assert from 'node:assert/strict';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ErrorPersistenciaOperacionAdministrativa } from '../paquetes/agentes/src/RepositorioOperacionesAdministrativasSql.js';
import {
  CodecConfirmacionEliminacionOrganizacion
} from '../paquetes/jerarquia-organizativa/src/CodecConfirmacionEliminacionOrganizacion.js';
import {
  ErrorAceptacionEliminacionAdministrativaOrganizacion,
  ServicioAceptacionEliminacionAdministrativaOrganizacion
} from '../paquetes/jerarquia-organizativa/src/ServicioAceptacionEliminacionAdministrativaOrganizacion.js';
import {
  ServicioAutorizacionEliminacionAdministrativaOrganizacion
} from '../paquetes/jerarquia-organizativa/src/ServicioAutorizacionEliminacionAdministrativaOrganizacion.js';

await verificarAutoridadSeparadaPorReplay();
await verificarAceptacionAtomica();
await verificarReplaySinReautorizar();
await verificarReplayQueApareceBajoAutoridad();
await verificarClaveDivergente();
await verificarConflictoDeReserva();
await verificarRollbackDeNotificacion();
await verificarDestinatarioDesaparecido();
await verificarFraseAntesDeTransaccion();

console.log(
  '[organizacion] OK 5.26.5c: aceptacion=transaccion_corta ' +
  'orden=jerarquia_usuarios_operacion_reserva_notificacion replay=canonico ' +
  'divergencia=409 conflicto=409 rollback=atomico destinatario=opcional'
);

async function verificarAutoridadSeparadaPorReplay() {
  const traza = [];
  const conexion = { execute: async () => [[], []] };
  const servicio = new ServicioAutorizacionEliminacionAdministrativaOrganizacion({
    repositorioUsuarios: {
      async buscarPorIdEnTransaccion(id, opciones) {
        assert.equal(opciones.conexion, conexion);
        assert.equal(opciones.forUpdate, true);
        traza.push(`usuario:${id}`);
        return {
          id,
          activo: true,
          tenantId: null,
          empresaId: null,
          sitioId: null,
          permisos: { eliminarAgentes: true, administrarOrganizacion: true }
        };
      }
    },
    autoridadReservasJerarquicas: {
      async exigirDisponibilidadEnTransaccion(entrada) {
        traza.push('autoridad');
        assert.equal(entrada.operacionPropietariaId, '777');
        return {
          rutas: [{
            recurso: { tipoRecurso: 'sitio', recursoId: '15' },
            tenantId: '9', empresaId: '12', sitioId: '15', agenteId: null
          }]
        };
      }
    }
  });
  const raiz = await servicio.adquirirRaizEnTransaccion({
    sujeto: { tipo: 'sitio', id: '15' },
    operacionPropietariaId: '777'
  }, { conexion });
  assert.deepEqual(traza, ['autoridad']);
  const fotografia = await servicio.autorizarActoresEnTransaccion({
    actorRealId: '8', actorEfectivoId: '5', sujeto: raiz
  }, { conexion });
  assert.deepEqual(traza, ['autoridad', 'usuario:5', 'usuario:8']);
  assert.equal(fotografia.actorReal.usuarioId, '8');
  assert.equal(fotografia.actorEfectivo.usuarioId, '5');
}

async function verificarAceptacionAtomica() {
  const fixture = crearFixture();
  const resultado = await fixture.aceptar();
  assert.deepEqual(resultado, {
    codigo: 'organizacion_eliminacion_encolada',
    repetida: false,
    operacionId: fixture.token.payload.operacionId,
    estado: 'encolada'
  });
  assert.deepEqual(fixture.traza, [
    'begin', 'buscar:libre', 'autoridad', 'buscar:lock', 'autorizar',
    'crear_operacion_reserva',
    'destinatario', 'crear_notificacion', 'commit'
  ]);
  const comando = fixture.estado.operacion.comando;
  assert.equal(comando.sujeto.scope.tenantId, '91');
  assert.equal(comando.sujeto.scope.empresaId, '121');
  assert.equal(JSON.stringify(comando).includes('Sitio previo'), false);
  assert.equal(JSON.stringify(comando).includes('conteos'), false);
  assert.equal(fixture.estado.notificacion.referenciaSujeto.fotografiaFinal, null);
}

async function verificarReplaySinReautorizar() {
  const fixture = crearFixture();
  await fixture.aceptar();
  fixture.traza.length = 0;
  const resultado = await fixture.aceptar();
  assert.equal(resultado.repetida, true);
  assert.equal(resultado.codigo, 'organizacion_eliminacion_repetida');
  assert.deepEqual(fixture.traza, [
    'begin', 'buscar:libre', 'destinatario', 'buscar_notificacion', 'commit'
  ]);
}

async function verificarReplayQueApareceBajoAutoridad() {
  const fixture = crearFixture();
  await fixture.aceptar();
  fixture.traza.length = 0;
  fixture.ocultarSiguienteLectura();
  const resultado = await fixture.aceptar();
  assert.equal(resultado.repetida, true);
  assert.deepEqual(fixture.traza, [
    'begin', 'buscar:libre', 'autoridad', 'buscar:lock',
    'destinatario', 'buscar_notificacion', 'commit'
  ]);
  assert.equal(fixture.traza.includes('autorizar'), false);
}

async function verificarClaveDivergente() {
  const fixture = crearFixture();
  await fixture.aceptar();
  fixture.estado.operacion = {
    ...fixture.estado.operacion,
    comando: {
      ...fixture.estado.operacion.comando,
      sujeto: { ...fixture.estado.operacion.comando.sujeto, id: '16' }
    }
  };
  await assert.rejects(
    fixture.aceptar,
    (error) => esError(error, 'organizacion_eliminacion_clave_divergente')
  );
}

async function verificarConflictoDeReserva() {
  const fixture = crearFixture({ conflictoReserva: true });
  await assert.rejects(
    fixture.aceptar,
    (error) => esError(error, 'organizacion_eliminacion_operacion_en_curso')
  );
  assert.equal(fixture.estado.operacion, null);
  assert.equal(fixture.estado.notificacion, null);
  assert.equal(fixture.traza.at(-1), 'rollback');
}

async function verificarRollbackDeNotificacion() {
  const fixture = crearFixture({ fallarNotificacion: true });
  await assert.rejects(fixture.aceptar, /fallo del buzón/u);
  assert.equal(fixture.estado.operacion, null);
  assert.equal(fixture.estado.notificacion, null);
  assert.equal(fixture.traza.at(-1), 'rollback');
}

async function verificarDestinatarioDesaparecido() {
  const fixture = crearFixture({ destinatarioExiste: false });
  const resultado = await fixture.aceptar();
  assert.equal(resultado.repetida, false);
  assert.ok(fixture.estado.operacion);
  assert.equal(fixture.estado.notificacion, null);
  assert.equal(fixture.traza.includes('crear_notificacion'), false);
}

async function verificarFraseAntesDeTransaccion() {
  const fixture = crearFixture();
  await assert.rejects(
    () => fixture.aceptar({ fraseConfirmacion: 'ELIMINAR sitio 0015' }),
    (error) => esError(error, 'organizacion_eliminacion_confirmacion_invalida')
  );
  assert.deepEqual(fixture.traza, []);
}

function crearFixture({
  conflictoReserva = false,
  fallarNotificacion = false,
  destinatarioExiste = true
} = {}) {
  const traza = [];
  const estado = { operacion: null, notificacion: null };
  let ocultarLecturas = 0;
  const codec = new CodecConfirmacionEliminacionOrganizacion({
    secreto: 'secreto-organizacion-5-26-5c-con-32-bytes',
    ahora: () => new Date('2026-08-30T14:00:00.000Z')
  });
  const token = codec.emitir({
    actorRealId: '5',
    actorEfectivoId: '8',
    sujeto: sujetoToken(),
    ...identidades()
  }, { csrfToken: 'csrf-5-26-5c' });
  const fronteraTransaccional = {
    async ejecutar(trabajo) {
      traza.push('begin');
      const anterior = { ...estado };
      try {
        const resultado = await trabajo({ execute: async () => [[], []] });
        traza.push('commit');
        return resultado;
      } catch (error) {
        Object.assign(estado, anterior);
        traza.push('rollback');
        throw error;
      }
    }
  };
  const servicioAutorizacion = {
    async adquirirRaizEnTransaccion({ operacionPropietariaId }) {
      assert.equal(operacionPropietariaId, token.payload.operacionId);
      traza.push('autoridad');
      return aceptacion().sujeto;
    },
    async autorizarActoresEnTransaccion() {
      traza.push('autorizar');
      return aceptacion().fotografiaAutorizacion;
    }
  };
  const repositorioOperaciones = {
    async buscarPorClave(_clave, { bloquear }) {
      traza.push(`buscar:${bloquear ? 'lock' : 'libre'}`);
      if (!bloquear && ocultarLecturas > 0) {
        ocultarLecturas -= 1;
        return null;
      }
      return estado.operacion;
    },
    async crearORecuperar({ comando }) {
      traza.push('crear_operacion_reserva');
      if (conflictoReserva) {
        throw new ErrorPersistenciaOperacionAdministrativa(
          'operacion_administrativa_recurso_reclamado',
          'recurso ocupado'
        );
      }
      estado.operacion = { estado: 'encolada', comando };
      return { creada: true, operacion: estado.operacion };
    }
  };
  const repositorioNotificaciones = {
    async existeDestinatario() {
      traza.push('destinatario');
      return destinatarioExiste;
    },
    async crearORecuperar({ notificacion }) {
      traza.push('crear_notificacion');
      if (fallarNotificacion) throw new Error('fallo del buzón');
      estado.notificacion = notificacion;
      return { creada: true, notificacion };
    },
    async buscarPorOperacionYTipo() {
      traza.push('buscar_notificacion');
      return estado.notificacion;
    }
  };
  const servicio = new ServicioAceptacionEliminacionAdministrativaOrganizacion({
    servicioAutorizacion,
    fronteraTransaccional,
    codecConfirmacion: codec,
    repositorioOperaciones,
    repositorioNotificaciones,
    generarUuid: generarUuidV7Auditoria
  });
  const aceptar = ({ fraseConfirmacion = 'ELIMINAR sitio 15' } = {}) =>
    servicio.aceptar({
      actorRealId: '5',
      actorEfectivoId: '8',
      sujeto: { tipo: 'sitio', id: '15' },
      tokenConfirmacion: token.token,
      fraseConfirmacion,
      csrfToken: 'csrf-5-26-5c'
    });
  return {
    aceptar,
    estado,
    token,
    traza,
    ocultarSiguienteLectura() { ocultarLecturas += 1; }
  };
}

function sujetoToken() {
  return {
    tipo: 'sitio',
    id: '15',
    scope: { nivel: 'sitio', tenantId: '9', empresaId: '12', sitioId: '15' }
  };
}

function aceptacion() {
  const actorReal = actor('5');
  const actorEfectivo = actor('8');
  return Object.freeze({
    sujeto: Object.freeze({
      tipo: 'sitio',
      id: '15',
      scope: Object.freeze({
        nivel: 'sitio', tenantId: '91', empresaId: '121', sitioId: '15'
      })
    }),
    fotografiaAutorizacion: Object.freeze({
      perfil: 'sentinelia-eliminacion-organizacion-autorizacion-v1',
      version: 1,
      decision: 'autorizada',
      aceptadaEnUtc: '2026-08-30T14:00:01.000Z',
      actorReal,
      actorEfectivo,
      destinatarioUsuarioId: '5'
    })
  });
}

function actor(usuarioId) {
  return Object.freeze({
    usuarioId,
    estado: 'activo',
    decision: 'autorizada',
    scope: Object.freeze({
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    })
  });
}

function identidades() {
  return {
    operacionId: generarUuidV7Auditoria(),
    claveOperacion: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    eventoId: generarUuidV7Auditoria()
  };
}

function esError(error, codigo) {
  return error instanceof ErrorAceptacionEliminacionAdministrativaOrganizacion &&
    error.codigo === codigo;
}
