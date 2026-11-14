import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ControladorUsuarios } from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { ServicioSesion } from '../paquetes/sesiones/src/ServicioSesion.js';
import { ErrorAutogestionPerfil } from '../paquetes/usuarios/src/ErrorAutogestionPerfil.js';
import { RepositorioAutorizacionPerfilRedis } from '../paquetes/usuarios/src/RepositorioAutorizacionPerfilRedis.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioAutenticacion } from '../paquetes/usuarios/src/ServicioAutenticacion.js';
import { ServicioAutogestionPerfil } from '../paquetes/usuarios/src/ServicioAutogestionPerfil.js';
import { ServicioAutorizacionPerfil } from '../paquetes/usuarios/src/ServicioAutorizacionPerfil.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  await verificarValidacionYCasoDeUso();
  await verificarFalloSqlYConflicto();
  await verificarContratoControlador();
  await verificarPersistenciaSqlReal();
  await verificarInvalidacionRedisReal();

  console.log(
    '[usuarios] Fase 4 de autogestión verificada: contraseña y sesiones invalidadas.'
  );
}

async function verificarValidacionYCasoDeUso() {
  const hashActual = await crearHash('ClaveActual123!');
  const repositorio = new RepositorioPasswordMemoria(hashActual);
  const servicioAutenticacion = crearServicioAutenticacion(repositorio, 12);
  const llamadas = {
    exigir: 0,
    revocar: 0,
    sesiones: 0,
    sensibles: 0
  };
  const servicio = new ServicioAutogestionPerfil({
    repositorioUsuarios: repositorio,
    servicioAutenticacion,
    servicioAutorizacionPerfil: {
      async exigirAutorizacion() {
        llamadas.exigir += 1;
      },
      async revocarTodasLasAutorizaciones(idUsuario) {
        llamadas.revocar += 1;
        assert.equal(idUsuario, 7);
        return { autorizacionesRevocadas: 2 };
      }
    },
    servicioSesion: {
      async invalidarSesionesUsuario(idUsuario, versionSesion) {
        llamadas.sesiones += 1;
        assert.equal(idUsuario, 7);
        assert.equal(versionSesion, 2);
        return { sesionesEliminadas: 3, versionSesion };
      }
    },
    invalidadoresOperacionesSensibles: [async (idUsuario) => {
      assert.equal(idUsuario, 7);
      llamadas.sensibles += 1;
    }]
  });
  const contexto = crearContextoOrdinario();

  const invalidas = [
    [null, null],
    ['corta', 'corta'],
    ['NuevaClave123!', 'Distinta456!'],
    ['á'.repeat(37), 'á'.repeat(37)]
  ];

  for (const [passwordNuevo, passwordConfirmacion] of invalidas) {
    await assert.rejects(
      servicio.cambiarPassword({
        contextoUsuarioActual: contexto,
        idSesion: 'sesion-a',
        passwordNuevo,
        passwordConfirmacion
      }),
      (error) => error.codigo === 'valor_invalido'
    );
  }

  await assert.rejects(
    servicio.cambiarPassword({
      contextoUsuarioActual: contexto,
      idSesion: 'sesion-a',
      passwordNuevo: 'ClaveActual123!',
      passwordConfirmacion: 'ClaveActual123!'
    }),
    (error) => error.codigo === 'password_reutilizada'
  );
  assert.equal(repositorio.actualizaciones, 0);
  assert.equal(llamadas.sesiones, 0);
  assert.equal(llamadas.revocar, 0);

  const resultado = await servicio.cambiarPassword({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a',
    passwordNuevo: 'NuevaClave456!',
    passwordConfirmacion: 'NuevaClave456!'
  });

  assert.equal(resultado.codigo, 'password_actualizado_sesion_cerrada');
  assert.equal(resultado.datos.sesion_cerrada, true);
  assert.equal(resultado.datos.sesiones_invalidadas, 3);
  assert.equal(resultado.datos.autorizaciones_revocadas, 2);
  assert.equal(repositorio.actualizaciones, 1);
  assert.equal(llamadas.sesiones, 1);
  assert.equal(llamadas.revocar, 1);
  assert.equal(llamadas.sensibles, 1);

  const passwordAnterior = await servicioAutenticacion.verificarPasswordActual({
    idUsuario: 7,
    password: 'ClaveActual123!'
  });
  const passwordNueva = await servicioAutenticacion.verificarPasswordActual({
    idUsuario: 7,
    password: 'NuevaClave456!'
  });
  assert.equal(passwordAnterior.passwordValida, false);
  assert.equal(passwordNueva.passwordValida, true);
}

async function verificarFalloSqlYConflicto() {
  const hashActual = await crearHash('ClaveActual123!');
  let invalidaciones = 0;
  const base = {
    async buscarPorId() {
      return crearUsuarioPassword({ hashPassword: hashActual });
    }
  };

  for (const modo of ['fallo', 'conflicto']) {
    const repositorio = {
      ...base,
      async actualizarPasswordPropio() {
        if (modo === 'fallo') {
          throw new Error('SQL no disponible');
        }

        return {
          estado: 'conflicto'
        };
      }
    };
    const servicio = new ServicioAutogestionPerfil({
      repositorioUsuarios: repositorio,
      servicioAutenticacion: crearServicioAutenticacion(repositorio, 8),
      servicioAutorizacionPerfil: {
        async exigirAutorizacion() {},
        async revocarTodasLasAutorizaciones() {
          invalidaciones += 1;
        }
      },
      servicioSesion: {
        async invalidarSesionesUsuario() {
          invalidaciones += 1;
        }
      }
    });

    await assert.rejects(
      servicio.cambiarPassword({
        contextoUsuarioActual: crearContextoOrdinario(),
        idSesion: 'sesion-a',
        passwordNuevo: 'NuevaClave456!',
        passwordConfirmacion: 'NuevaClave456!'
      }),
      (error) => modo === 'fallo'
        ? error.message === 'SQL no disponible'
        : error.codigo === 'operacion_password_en_conflicto'
    );
  }

  assert.equal(invalidaciones, 0);

  const servicioExpirado = new ServicioAutogestionPerfil({
    repositorioUsuarios: {
      async actualizarPasswordPropio() {
        throw new Error('No debe ejecutarse');
      }
    },
    servicioAutenticacion: {},
    servicioSesion: {},
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
    servicioExpirado.cambiarPassword({
      contextoUsuarioActual: crearContextoOrdinario(),
      idSesion: 'sesion-expirada',
      passwordNuevo: 'NuevaClave456!',
      passwordConfirmacion: 'NuevaClave456!'
    }),
    (error) => error.codigo === 'perfil_edicion_requerida'
  );
}

async function verificarContratoControlador() {
  const controlador = new ControladorUsuarios({
    servicioUsuarios: {},
    servicioAutogestionPerfil: {
      async cambiarPassword({ passwordNuevo, passwordConfirmacion }) {
        assert.equal(passwordNuevo, 'NuevaClave456!');
        assert.equal(passwordConfirmacion, 'NuevaClave456!');
        return {
          codigo: 'password_actualizado_sesion_cerrada',
          mensaje: 'Actualizada.',
          datos: { sesion_cerrada: true }
        };
      }
    }
  });
  const respuesta = crearRespuestaControlada();

  await controlador.apiCambiarPasswordPerfil(
    crearRequisicionJson({
      password_nuevo: 'NuevaClave456!',
      password_confirmacion: 'NuevaClave456!'
    }),
    respuesta
  );
  assert.equal(respuesta.estado, 200);
  assert.equal(
    respuesta.payload.codigo,
    'password_actualizado_sesion_cerrada'
  );

  for (const cuerpo of [
    { password_nuevo: 'NuevaClave456!' },
    {
      password_nuevo: 'NuevaClave456!',
      password_confirmacion: 'NuevaClave456!',
      password_actual: 'no-admitida'
    }
  ]) {
    const invalida = crearRespuestaControlada();
    await controlador.apiCambiarPasswordPerfil(
      crearRequisicionJson(cuerpo),
      invalida
    );
    assert.equal(invalida.estado, 400);
    assert.equal(invalida.payload.codigo, 'peticion_invalida');
  }
}

async function verificarPersistenciaSqlReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioUsuarios(clienteSql);
  const servicioAutenticacion = crearServicioAutenticacion(repositorio, 8);
  const sufijo = crypto.randomUUID().replaceAll('-', '');
  const usuarioLogin = `fase4_${sufijo}`;
  const passwordActual = 'ClaveActual123!';
  const passwordNueva = 'NuevaClave456!';
  let idUsuario = null;

  try {
    const hashActual = await servicioAutenticacion.crearHashPassword(
      passwordActual
    );
    const [insercion] = await clienteSql.ejecutar(
      `
        INSERT INTO usuarios (
          usuario,
          email,
          hash_password,
          nombre_mostrar,
          nombre_completo,
          version_sesion
        ) VALUES (?, ?, ?, ?, ?, 4)
      `,
      [
        usuarioLogin,
        `${usuarioLogin}@example.test`,
        hashActual,
        'Visible intacto',
        'Completo intacto'
      ]
    );
    idUsuario = Number(insercion.insertId);
    const servicio = new ServicioAutogestionPerfil({
      repositorioUsuarios: repositorio,
      servicioAutenticacion,
      servicioAutorizacionPerfil: {
        async exigirAutorizacion() {},
        async revocarTodasLasAutorizaciones() {
          return { autorizacionesRevocadas: 0 };
        }
      },
      servicioSesion: {
        async invalidarSesionesUsuario(id, versionSesion) {
          assert.equal(id, idUsuario);
          assert.equal(versionSesion, 5);
          return { sesionesEliminadas: 1, versionSesion };
        }
      }
    });

    await servicio.cambiarPassword({
      contextoUsuarioActual: {
        idUsuario,
        idUsuarioReal: idUsuario,
        impersonacionActiva: false
      },
      idSesion: 'sesion-sql',
      passwordNuevo: passwordNueva,
      passwordConfirmacion: passwordNueva
    });

    const persistido = await repositorio.buscarPorId(idUsuario);
    assert.equal(persistido.versionSesion, 5);
    assert.equal(persistido.nombreMostrar, 'Visible intacto');
    assert.equal(persistido.nombreCompleto, 'Completo intacto');
    assert.equal(persistido.email, `${usuarioLogin}@example.test`);
    assert.equal((await servicioAutenticacion.verificarPasswordActual({
      idUsuario,
      password: passwordActual
    })).passwordValida, false);
    assert.equal((await servicioAutenticacion.verificarPasswordActual({
      idUsuario,
      password: passwordNueva
    })).passwordValida, true);

    const conflictoConcurrente =
      await repositorio.actualizarPasswordPropio({
        idUsuario,
        hashPasswordActual: persistido.hashPassword,
        hashPasswordNuevo:
          await servicioAutenticacion.crearHashPassword('OtraClave789!'),
        versionSesionActual: 4
      });
    assert.equal(conflictoConcurrente.estado, 'conflicto');
    assert.equal((await servicioAutenticacion.verificarPasswordActual({
      idUsuario,
      password: passwordNueva
    })).passwordValida, true);
  } finally {
    if (idUsuario) {
      await clienteSql.ejecutar(
        'DELETE FROM usuarios WHERE id = ? AND usuario = ?',
        [idUsuario, usuarioLogin]
      );
    }

    await clienteSql.cerrar();
  }
}

async function verificarInvalidacionRedisReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  const conexion = new ServicioConexionRedis(configuracion.redis);
  const clienteRedis = await conexion.conectar();
  const sufijo = crypto.randomUUID();
  const idUsuario = 800_000_000 + Math.floor(Math.random() * 100_000_000);
  const prefijoAutorizacion = `sentinelia:prueba:fase4:${sufijo}:`;
  const repositorioAutorizacion = new RepositorioAutorizacionPerfilRedis({
    clienteRedis,
    prefijoRedis: prefijoAutorizacion,
    cadenciaReautenticacionSegundos: 60
  });
  const servicioAutorizacion = new ServicioAutorizacionPerfil({
    repositorioAutorizacionPerfil: repositorioAutorizacion,
    servicioAutenticacion: {}
  });
  const servicioSesion = new ServicioSesion({
    clienteRedis,
    configuracionSesion: configuracion.sesion,
    configuracionRedis: configuracion.redis
  });
  const clavesSesion = [
    `${configuracion.redis.prefijoSesiones}prueba-fase4-${sufijo}-a`,
    `${configuracion.redis.prefijoSesiones}prueba-fase4-${sufijo}-b`
  ];
  const claveVersion = servicioSesion.obtenerClaveVersionUsuario(idUsuario);
  const clavesAutorizacion = ['sesion-a', 'sesion-b'].map((idSesion) =>
    repositorioAutorizacion.obtenerClaveAutorizacion({
      idUsuarioReal: idUsuario,
      idSesion
    })
  );
  const claveCadencia = repositorioAutorizacion.obtenerClaveCadencia(idUsuario);

  try {
    const sesion = JSON.stringify({
      usuarioAutenticado: {
        idUsuario,
        idUsuarioEfectivo: idUsuario,
        idUsuarioReal: idUsuario,
        versionSesion: 1,
        versionSesionEfectiva: 1,
        versionSesionReal: 1
      }
    });
    await clienteRedis.set(clavesSesion[0], sesion, { EX: 300 });
    await clienteRedis.set(clavesSesion[1], sesion, { EX: 300 });
    await servicioSesion.sincronizarVersionUsuario(idUsuario, 1);
    await repositorioAutorizacion.guardarAutorizacion({
      idUsuarioReal: idUsuario,
      idSesion: 'sesion-a'
    });
    await repositorioAutorizacion.guardarAutorizacion({
      idUsuarioReal: idUsuario,
      idSesion: 'sesion-b'
    });
    await repositorioAutorizacion.intentarRegistrarReautenticacion(idUsuario);

    const sesiones = await servicioSesion.invalidarSesionesUsuario(
      idUsuario,
      2
    );
    const autorizaciones =
      await servicioAutorizacion.revocarTodasLasAutorizaciones(idUsuario);

    assert.equal(sesiones.sesionesEliminadas, 2);
    assert.equal(await clienteRedis.get(claveVersion), '2');
    assert.equal(await clienteRedis.get(clavesSesion[0]), null);
    assert.equal(await clienteRedis.get(clavesSesion[1]), null);
    assert.equal(autorizaciones.autorizacionesRevocadas, 2);
    assert.equal(autorizaciones.estadoCadenciaEliminado, true);
    assert.equal(await clienteRedis.get(clavesAutorizacion[0]), null);
    assert.equal(await clienteRedis.get(clavesAutorizacion[1]), null);
  } finally {
    await clienteRedis.del([
      ...clavesSesion,
      ...clavesAutorizacion,
      claveCadencia,
      claveVersion
    ]);
    await conexion.cerrar();
  }
}

class RepositorioPasswordMemoria {
  constructor(hashPassword) {
    this.usuario = crearUsuarioPassword({ hashPassword });
    this.actualizaciones = 0;
  }

  async buscarPorId() {
    return this.usuario;
  }

  async actualizarPasswordPropio({
    idUsuario,
    hashPasswordActual,
    hashPasswordNuevo,
    versionSesionActual
  }) {
    assert.equal(idUsuario, 7);

    if (
      this.usuario.hashPassword !== hashPasswordActual ||
      this.usuario.versionSesion !== versionSesionActual
    ) {
      return { estado: 'conflicto' };
    }

    this.actualizaciones += 1;
    this.usuario = crearUsuarioPassword({
      hashPassword: hashPasswordNuevo,
      versionSesion: this.usuario.versionSesion + 1
    });
    return {
      estado: 'actualizado',
      versionSesion: this.usuario.versionSesion
    };
  }
}

function crearServicioAutenticacion(repositorioUsuarios, longitudMinima) {
  return new ServicioAutenticacion({
    repositorioUsuarios,
    servicioConfiguracionPortal: {
      obtenerConfiguracionActual() {
        return {
          obtenerConfiguracionUsuarios() {
            return { passwordLongitudMinima: longitudMinima };
          }
        };
      }
    }
  });
}

function crearUsuarioPassword({ hashPassword, versionSesion = 1 }) {
  return {
    id: 7,
    activo: true,
    hashPassword,
    versionSesion
  };
}

async function crearHash(password) {
  return new ServicioAutenticacion({
    repositorioUsuarios: {}
  }).crearHashPassword(password);
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
  console.error('[usuarios] Falló la verificación de la fase 4 de autogestión.');
  console.error(error);
  process.exit(1);
});
