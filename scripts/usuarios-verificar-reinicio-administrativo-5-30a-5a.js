import assert from 'node:assert/strict';

import { ServicioReinicioPasswordAdministrativo }
  from '../paquetes/usuarios/src/ServicioReinicioPasswordAdministrativo.js';
import { ControladorUsuarios }
  from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';

await verificarCanalesYAdvertencia();
await verificarResultadoReducido();
await verificarFalloEvaluacion();
await verificarScopeYObjetivoPropio();
await verificarIntegracionControlador();
console.log(
  '[usuarios] OK 5.30a.5a: edicion=proyeccion_segura ' +
  'canal=correo|manual|no_evaluable ultimo=redactado ' +
  'email_no_validado=advertencia scope=obligatorio objetivo_propio=sin_accion'
);

async function verificarCanalesYAdvertencia() {
  const correo = crearEntorno({ puedeDespachar: true, emailValidado: false });
  const proyeccionCorreo = await correo.servicio.construirProyeccionEdicion({
    contextoUsuarioActual: contexto(), usuarioId: '7'
  });
  assert.deepEqual(proyeccionCorreo.canal, { via: 'correo', evaluable: true });
  assert.equal(proyeccionCorreo.admiteAccion, true);
  assert.deepEqual(proyeccionCorreo.advertencias, ['email_no_validado']);
  assert.equal(proyeccionCorreo.objetivo.emailValidado, false);

  const manual = crearEntorno({ puedeDespachar: false });
  const proyeccionManual = await manual.servicio.construirProyeccionEdicion({
    contextoUsuarioActual: contexto(), usuarioId: '7'
  });
  assert.deepEqual(proyeccionManual.canal, { via: 'manual', evaluable: true });
}

async function verificarResultadoReducido() {
  const entorno = crearEntorno({
    ultimo: {
      perfil: 'privado', version: 99, reinicioId: 'no-exponer',
      usuarioId: '7', via: 'correo', estado: 'detalle_retenido',
      aplicadoEnUtc: '2026-09-08T20:30:00.000Z',
      password: 'SECRETO', hashPassword: 'HASH', cuerpoTexto: 'CUERPO',
      destinatarioEmail: 'privado@example.test', errorUltimo: 'ERROR SMTP'
    }
  });
  const proyeccion = await entorno.servicio.construirProyeccionEdicion({
    contextoUsuarioActual: contexto(), usuarioId: '7'
  });
  assert.deepEqual(proyeccion.ultimoResultado, {
    via: 'correo', estado: 'detalle_retenido',
    aplicadoEnUtc: '2026-09-08T20:30:00.000Z'
  });
  assert.doesNotMatch(JSON.stringify(proyeccion),
    /SECRETO|HASH|CUERPO|privado@example|ERROR SMTP|no-exponer/u);
}

async function verificarFalloEvaluacion() {
  const entorno = crearEntorno({ falloEvaluacion: true });
  const proyeccion = await entorno.servicio.construirProyeccionEdicion({
    contextoUsuarioActual: contexto(), usuarioId: '7'
  });
  assert.deepEqual(proyeccion.canal, {
    via: 'no_evaluable', evaluable: false
  });
  assert.equal(proyeccion.admiteAccion, false);
  assert.doesNotMatch(JSON.stringify(proyeccion), /credenciales SMTP fixture/u);
}

async function verificarScopeYObjetivoPropio() {
  const ausente = crearEntorno({ objetivo: null });
  await assert.rejects(
    ausente.servicio.construirProyeccionEdicion({
      contextoUsuarioActual: contexto(), usuarioId: '404'
    }),
    /alcance visible/u
  );
  assert.equal(ausente.operaciones.consultasUltimo, 0);

  const propio = crearEntorno({ objetivo: usuario({ id: '1' }) });
  const proyeccion = await propio.servicio.construirProyeccionEdicion({
    contextoUsuarioActual: contexto(), usuarioId: '1'
  });
  assert.equal(proyeccion.admiteAccion, false);

  const inactivo = crearEntorno({ objetivo: usuario({ activo: false }) });
  assert.equal((await inactivo.servicio.construirProyeccionEdicion({
    contextoUsuarioActual: contexto(), usuarioId: '7'
  })).admiteAccion, false);
}

async function verificarIntegracionControlador() {
  const contextoUsuarioActual = contexto();
  const proyeccion = Object.freeze({
    canal: Object.freeze({ via: 'correo', evaluable: true }),
    admiteAccion: true,
    objetivo: Object.freeze({ activo: true, emailValidado: true }),
    advertencias: Object.freeze([]),
    ultimoResultado: null
  });
  const controlador = new ControladorUsuarios({
    servicioUsuarios: {
      async construirVistaFormulario(contextoRecibido, { idUsuario }) {
        assert.equal(contextoRecibido, contextoUsuarioActual);
        assert.equal(idUsuario, 7);
        return { usuario: { id: 7 }, administrarUsuarios: true };
      }
    },
    servicioReinicioPasswordAdministrativo: {
      async construirProyeccionEdicion({
        contextoUsuarioActual: contextoRecibido,
        usuarioId
      }) {
        assert.equal(contextoRecibido, contextoUsuarioActual);
        assert.equal(usuarioId, 7);
        return proyeccion;
      }
    }
  });
  let renderizado = null;
  let error = null;
  await controlador.mostrarEditarUsuario({
    params: { id: '7' },
    contextoUsuarioActual,
    session: { usuarioAutenticado: { id: 1 } }
  }, {
    render(vista, datos) { renderizado = { vista, datos }; }
  }, (recibido) => { error = recibido; });
  assert.equal(error, null);
  assert.equal(renderizado.vista, 'portal/usuario-formulario');
  assert.equal(renderizado.datos.reinicioPasswordAdministrativo, proyeccion);
}

function crearEntorno({
  puedeDespachar = true,
  falloEvaluacion = false,
  emailValidado = true,
  objetivo = usuario({ emailValidado }),
  ultimo = null
} = {}) {
  const operaciones = {
    consultasUltimo: 0,
    async reservarEnTransaccion() {},
    async confirmarEnTransaccion() {},
    async buscarPorId() { return null; },
    async buscarPorIdEnTransaccion() { return null; },
    async buscarUltimoProyectadoPorUsuario() {
      this.consultasUltimo += 1;
      return ultimo;
    }
  };
  const usuarios = {
    async buscarPorIdParaAdministracion() { return objetivo; },
    async buscarPorIdParaAdministracionEnTransaccion() { return objetivo; },
    async reiniciarPasswordAdministrativaEnTransaccion() {}
  };
  return {
    operaciones,
    servicio: new ServicioReinicioPasswordAdministrativo({
      repositorioUsuarios: usuarios,
      repositorioOperaciones: operaciones,
      repositorioSesionesWeb: {
        async invalidarVigentesPorUsuariosEnTransaccion() { return []; }
      },
      servicioSesion: { async invalidarSesionesUsuario() {} },
      evaluadorAutoridadCorreoSql: {
        async evaluarEnTransaccion() {
          if (falloEvaluacion) throw new Error('credenciales SMTP fixture');
          return { puedeDespachar };
        }
      },
      servicioAutenticacion: {
        obtenerLongitudMinimaPassword() { return 24; },
        validarPasswordNueva() {},
        async crearHashPassword() { return 'hash'; }
      },
      servicioEstadoSensibleUsuario: {
        async ejecutarConExclusion() {}
      },
      servicioAuditoria: { async registrarEnTransaccion() {} },
      fronteraTransaccional: {
        async ejecutar(trabajo) { return trabajo({ execute() {} }); }
      }
    })
  };
}

function usuario({
  id = '7', activo = true, emailValidado = true
} = {}) {
  return {
    id, activo, emailValidado, versionSesion: 3,
    generacionRecuperacion: '2', email: 'objetivo@example.test',
    obtenerNombreVisible() { return 'Objetivo'; }
  };
}

function contexto() {
  return {
    idUsuario: '1', idUsuarioReal: '1', impersonacionActiva: false,
    nivelScope: 'portal', tenantId: null, empresaId: null, sitioId: null
  };
}
