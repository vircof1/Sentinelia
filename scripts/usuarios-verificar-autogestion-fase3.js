import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ControladorUsuarios } from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { ErrorAutogestionPerfil } from '../paquetes/usuarios/src/ErrorAutogestionPerfil.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioAutogestionPerfil } from '../paquetes/usuarios/src/ServicioAutogestionPerfil.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  await verificarServicioYValidacion();
  await verificarAutorizacionYCuentaVigente();
  await verificarContratoControlador();
  await verificarPersistenciaSqlReal();

  console.log(
    '[usuarios] Fase 3 de autogestión verificada: nombres independientes y autorizados.'
  );
}

async function verificarServicioYValidacion() {
  const repositorio = new RepositorioUsuariosMemoria();
  let autorizacionesExigidas = 0;
  const servicio = new ServicioAutogestionPerfil({
    repositorioUsuarios: repositorio,
    servicioAutorizacionPerfil: {
      async exigirAutorizacion({ contextoUsuarioActual, idSesion }) {
        autorizacionesExigidas += 1;
        assert.equal(contextoUsuarioActual.idUsuarioReal, 7);
        assert.equal(idSesion, 'sesion-a');
      }
    }
  });
  const contexto = crearContextoOrdinario();

  const visible = await servicio.actualizarNombreVisible({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a',
    nombreVisible: '  H 🧠  interior  '
  });
  assert.equal(visible.codigo, 'nombre_visible_actualizado');
  assert.equal(visible.datos.modificado, true);
  assert.equal(visible.datos.nombre_visible, 'H 🧠  interior');
  assert.equal(repositorio.nombreMostrar, 'H 🧠  interior');

  const sinCambios = await servicio.actualizarNombreVisible({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a',
    nombreVisible: 'H 🧠  interior'
  });
  assert.equal(sinCambios.codigo, 'nombre_visible_actualizado');
  assert.equal(sinCambios.datos.modificado, false);

  const completo = await servicio.actualizarNombreCompleto({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a',
    nombreCompleto: '  李 小龍  '
  });
  assert.equal(completo.codigo, 'nombre_completo_actualizado');
  assert.equal(completo.datos.nombre_completo, '李 小龍');
  assert.equal(repositorio.nombreCompleto, '李 小龍');

  const limiteUnicode = '😀'.repeat(120);
  const alLimite = await servicio.actualizarNombreVisible({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a',
    nombreVisible: limiteUnicode
  });
  assert.equal(alLimite.datos.nombre_visible, limiteUnicode);

  for (const valor of [null, 42, '', '   ', 'a'.repeat(121)]) {
    await assert.rejects(
      servicio.actualizarNombreVisible({
        contextoUsuarioActual: contexto,
        idSesion: 'sesion-a',
        nombreVisible: valor
      }),
      (error) => {
        assert.equal(error.codigo, 'valor_invalido');
        assert.equal(error.datos.errores[0].campo, 'nombre_visible');
        return true;
      }
    );
  }

  await assert.rejects(
    servicio.actualizarNombreCompleto({
      contextoUsuarioActual: contexto,
      idSesion: 'sesion-a',
      nombreCompleto: 'ñ'.repeat(161)
    }),
    (error) => {
      assert.equal(error.codigo, 'valor_invalido');
      assert.equal(error.datos.errores[0].campo, 'nombre_completo');
      return true;
    }
  );

  assert.equal(autorizacionesExigidas, 10);
}

async function verificarAutorizacionYCuentaVigente() {
  let escrituras = 0;
  const servicioExpirado = new ServicioAutogestionPerfil({
    repositorioUsuarios: {
      async actualizarNombreMostrarPropio() {
        escrituras += 1;
      }
    },
    servicioAutorizacionPerfil: {
      async exigirAutorizacion() {
        throw new ErrorAutogestionPerfil({
          codigo: 'perfil_edicion_requerida',
          mensaje: 'La autorización ha expirado.',
          estadoHttp: 403
        });
      }
    }
  });

  await assert.rejects(
    servicioExpirado.actualizarNombreVisible({
      contextoUsuarioActual: crearContextoOrdinario(),
      idSesion: 'sesion-expirada',
      nombreVisible: 'No debe persistirse'
    }),
    (error) => error.codigo === 'perfil_edicion_requerida'
  );
  assert.equal(escrituras, 0);

  const servicioCuentaInactiva = new ServicioAutogestionPerfil({
    repositorioUsuarios: {
      async actualizarNombreCompletoPropio() {
        return { usuarioActivo: false, modificado: false };
      }
    },
    servicioAutorizacionPerfil: {
      async exigirAutorizacion() {}
    }
  });

  await assert.rejects(
    servicioCuentaInactiva.actualizarNombreCompleto({
      contextoUsuarioActual: crearContextoOrdinario(),
      idSesion: 'sesion-a',
      nombreCompleto: 'Cuenta desactivada'
    }),
    (error) => {
      assert.equal(error.codigo, 'sesion_no_vigente');
      assert.equal(error.estadoHttp, 401);
      return true;
    }
  );
}

async function verificarContratoControlador() {
  const controlador = new ControladorUsuarios({
    servicioUsuarios: {},
    servicioAutogestionPerfil: {
      async actualizarNombreVisible({ nombreVisible }) {
        return {
          codigo: 'nombre_visible_actualizado',
          mensaje: 'Actualizado.',
          datos: { modificado: true, nombre_visible: nombreVisible.trim() }
        };
      },
      async actualizarNombreCompleto({ nombreCompleto }) {
        return {
          codigo: 'nombre_completo_actualizado',
          mensaje: 'Actualizado.',
          datos: { modificado: true, nombre_completo: nombreCompleto.trim() }
        };
      }
    }
  });
  const respuestaVisible = crearRespuestaControlada();

  await controlador.apiActualizarNombreVisiblePerfil(
    crearRequisicionJson({ nombre_visible: 'Operador' }),
    respuestaVisible
  );
  assert.equal(respuestaVisible.estado, 200);
  assert.equal(respuestaVisible.payload.codigo, 'nombre_visible_actualizado');

  for (const cuerpo of [
    { nombre_visible: 'Operador', nombre_completo: 'Operador de red' },
    { nombre_visible: 'Operador', atributo_extra: true },
    {}
  ]) {
    const respuestaInvalida = crearRespuestaControlada();
    await controlador.apiActualizarNombreVisiblePerfil(
      crearRequisicionJson(cuerpo),
      respuestaInvalida
    );
    assert.equal(respuestaInvalida.estado, 400);
    assert.equal(respuestaInvalida.payload.codigo, 'peticion_invalida');
  }

  const respuestaCompleto = crearRespuestaControlada();
  await controlador.apiActualizarNombreCompletoPerfil(
    crearRequisicionJson({ nombre_completo: 'Operador de red' }),
    respuestaCompleto
  );
  assert.equal(
    respuestaCompleto.payload.codigo,
    'nombre_completo_actualizado'
  );
}

async function verificarPersistenciaSqlReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioUsuarios(clienteSql);
  const sufijo = crypto.randomUUID().replaceAll('-', '');
  const usuario = `fase3_${sufijo}`;
  let idUsuario = null;

  try {
    const [insercion] = await clienteSql.ejecutar(
      `
        INSERT INTO usuarios (
          usuario,
          email,
          hash_password,
          nombre_mostrar,
          nombre_completo
        ) VALUES (?, ?, ?, ?, ?)
      `,
      [
        usuario,
        `${usuario}@example.test`,
        'hash-no-utilizable-en-prueba',
        'Inicial',
        'Nombre inicial'
      ]
    );
    idUsuario = Number(insercion.insertId);

    const primerCambio = await repositorio.actualizarNombreMostrarPropio({
      idUsuario,
      nombreMostrar: 'Nombre visible propio'
    });
    assert.deepEqual(primerCambio, {
      usuarioActivo: true,
      modificado: true
    });

    await clienteSql.ejecutar(
      `
        UPDATE usuarios
        SET nombre_completo = ?, email = ?
        WHERE id = ?
      `,
      [
        'Nombre administrativo concurrente',
        `${usuario}.administrado@example.test`,
        idUsuario
      ]
    );

    await repositorio.actualizarNombreMostrarPropio({
      idUsuario,
      nombreMostrar: 'Segundo nombre propio'
    });
    const persistido = await repositorio.buscarPorId(idUsuario);
    assert.equal(persistido.nombreMostrar, 'Segundo nombre propio');
    assert.equal(
      persistido.nombreCompleto,
      'Nombre administrativo concurrente'
    );
    assert.equal(
      persistido.email,
      `${usuario}.administrado@example.test`
    );

    const repetido = await repositorio.actualizarNombreMostrarPropio({
      idUsuario,
      nombreMostrar: 'Segundo nombre propio'
    });
    assert.deepEqual(repetido, {
      usuarioActivo: true,
      modificado: false
    });

    await clienteSql.ejecutar(
      'UPDATE usuarios SET activo = 0 WHERE id = ?',
      [idUsuario]
    );
    const inactivo = await repositorio.actualizarNombreCompletoPropio({
      idUsuario,
      nombreCompleto: 'No debe escribirse'
    });
    assert.deepEqual(inactivo, {
      usuarioActivo: false,
      modificado: false
    });
  } finally {
    if (idUsuario) {
      await clienteSql.ejecutar(
        'DELETE FROM usuarios WHERE id = ? AND usuario = ?',
        [idUsuario, usuario]
      );
    }

    await clienteSql.cerrar();
  }
}

class RepositorioUsuariosMemoria {
  constructor() {
    this.nombreMostrar = 'Inicial';
    this.nombreCompleto = 'Nombre inicial';
  }

  async actualizarNombreMostrarPropio({ idUsuario, nombreMostrar }) {
    assert.equal(idUsuario, 7);
    const modificado = this.nombreMostrar !== nombreMostrar;
    this.nombreMostrar = nombreMostrar;
    return { usuarioActivo: true, modificado };
  }

  async actualizarNombreCompletoPropio({ idUsuario, nombreCompleto }) {
    assert.equal(idUsuario, 7);
    const modificado = this.nombreCompleto !== nombreCompleto;
    this.nombreCompleto = nombreCompleto;
    return { usuarioActivo: true, modificado };
  }
}

function crearContextoOrdinario() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    impersonacionActiva: false
  };
}

function crearRequisicionJson(body) {
  return {
    body,
    sessionID: 'sesion-controlador',
    contextoUsuarioActual: crearContextoOrdinario(),
    is(tipo) {
      return tipo === 'application/json';
    }
  };
}

function crearRespuestaControlada() {
  return {
    estado: 200,
    payload: null,
    status(estado) {
      this.estado = estado;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación de la fase 3 de autogestión.');
  console.error(error);
  process.exit(1);
});
