import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { RepositorioAutorizacionPerfilRedis } from '../paquetes/usuarios/src/RepositorioAutorizacionPerfilRedis.js';
import { RepositorioOperacionesEmailPerfilRedis } from '../paquetes/usuarios/src/RepositorioOperacionesEmailPerfilRedis.js';
import { ServicioAutogestionPerfil } from '../paquetes/usuarios/src/ServicioAutogestionPerfil.js';
import { ServicioAutorizacionPerfil } from '../paquetes/usuarios/src/ServicioAutorizacionPerfil.js';
import { ServicioEstadoSensibleUsuario } from '../paquetes/usuarios/src/ServicioEstadoSensibleUsuario.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioUsuarios } from '../paquetes/usuarios/src/ServicioUsuarios.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  await verificarInvalidacionYExclusionRedisReal();
  await verificarCambioPasswordPropio();
  await verificarMutacionesAdministrativas();
  await verificarPersistenciaAdministrativaSqlReal();
  await verificarFalloRedisPosteriorAlCambioDurable();

  console.log(
    '[usuarios] Fase 8 verificada: invalidaciones externas coordinadas e idempotentes.'
  );
}

async function verificarInvalidacionYExclusionRedisReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  const conexion = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexion.conectar();
  const sufijo = crypto.randomUUID();
  const prefijoAutorizacion = `prueba:fase8:${sufijo}:autorizacion:`;
  const prefijoEmail = `prueba:fase8:${sufijo}:email:`;
  const repositorioAutorizacion = new RepositorioAutorizacionPerfilRedis({
    clienteRedis: redis,
    prefijoRedis: prefijoAutorizacion
  });
  const servicioAutorizacion = new ServicioAutorizacionPerfil({
    repositorioAutorizacionPerfil: repositorioAutorizacion,
    servicioAutenticacion: {}
  });
  const repositorioEmail = new RepositorioOperacionesEmailPerfilRedis({
    clienteRedis: redis,
    prefijoRedis: prefijoEmail,
    secretoProteccionTokens: configuracion.sesion.secreto
  });
  const servicioEstado = new ServicioEstadoSensibleUsuario({
    repositorioOperacionesEmail: repositorioEmail,
    servicioAutorizacionPerfil: servicioAutorizacion
  });
  const token = repositorioEmail.generarToken();

  try {
    await repositorioAutorizacion.guardarAutorizacion({
      idUsuarioReal: 8,
      idSesion: 'sesion-uno'
    });
    await repositorioAutorizacion.guardarAutorizacion({
      idUsuarioReal: 8,
      idSesion: 'sesion-dos'
    });
    const preparada = await repositorioEmail.prepararOperacion({
      idUsuario: 8,
      emailOrigen: 'anterior@example.test',
      emailCandidato: 'nuevo@example.test',
      huellaCredencialOrigen:
        repositorioEmail.calcularHuellaCredencial('hash-password-anterior'),
      token
    });
    assert.equal(
      await repositorioEmail.activarOperacion(preparada.operacion),
      'activada'
    );

    let cambiosDurables = 0;
    const primera = await servicioEstado.ejecutarConExclusion(8, async () => {
      cambiosDurables += 1;
      return { actualizado: true };
    });
    assert.equal(cambiosDurables, 1);
    assert.equal(primera.limpieza.completa, true);
    assert.equal(
      primera.limpieza.autorizaciones.autorizacionesRevocadas,
      2
    );
    assert.equal(primera.limpieza.pruebaEmailInvalidada, true);
    assert.equal(
      await repositorioAutorizacion.obtenerAutorizacion({
        idUsuarioReal: 8,
        idSesion: 'sesion-uno'
      }),
      null
    );
    assert.equal(
      (await repositorioEmail.diagnosticarTokenOhuella(token)).estado,
      'sustituida'
    );

    const repetida = await servicioEstado.invalidar(8);
    assert.equal(repetida.limpieza.completa, true);
    assert.equal(repetida.limpieza.pruebaEmailInvalidada, false);

    const bloqueoConcurrente = await repositorioEmail.adquirirBloqueoUsuario(8);
    assert.ok(bloqueoConcurrente);
    await assert.rejects(
      servicioEstado.ejecutarConExclusion(8, async () => {
        cambiosDurables += 1;
      }),
      /otra operación sensible en curso/
    );
    assert.equal(cambiosDurables, 1);
    await repositorioEmail.liberarBloqueoUsuario(8, bloqueoConcurrente);

    assert.equal(
      repositorioEmail.coincideHuellaCredencial(
        preparada.operacion,
        'hash-password-anterior'
      ),
      true
    );
    assert.equal(
      repositorioEmail.coincideHuellaCredencial(
        preparada.operacion,
        'hash-password-nuevo'
      ),
      false
    );
  } finally {
    await limpiarPrefijos(redis, [prefijoAutorizacion, prefijoEmail]);
    await conexion.cerrar();
  }
}

async function verificarCambioPasswordPropio() {
  const orden = [];
  const servicio = new ServicioAutogestionPerfil({
    repositorioUsuarios: {
      async actualizarPasswordPropio() {
        orden.push('sql');
        return { estado: 'actualizado', versionSesion: 4 };
      }
    },
    servicioAutorizacionPerfil: {
      async exigirAutorizacion() {
        orden.push('autorizacion');
      }
    },
    servicioAutenticacion: {
      obtenerLongitudMinimaPassword: () => 8,
      async verificarPasswordActual() {
        return {
          usuarioVigente: true,
          passwordValida: false,
          usuario: { hashPassword: 'hash-viejo', versionSesion: 3 }
        };
      },
      async crearHashPassword() {
        return 'hash-nuevo';
      }
    },
    servicioEstadoSensibleUsuario: {
      async ejecutarConExclusion(_idUsuario, operacion, opciones) {
        orden.push('bloqueo');
        const resultado = await operacion();
        assert.equal(opciones.debeInvalidar(resultado), true);
        orden.push('invalidacion');
        return {
          resultado,
          limpieza: {
            completa: true,
            autorizaciones: { autorizacionesRevocadas: 2 }
          }
        };
      }
    },
    servicioSesion: {
      async invalidarSesionesUsuario(_idUsuario, versionSesion) {
        orden.push('sesiones');
        assert.equal(versionSesion, 4);
        return { sesionesEliminadas: 3 };
      }
    }
  });

  const resultado = await servicio.cambiarPassword({
    contextoUsuarioActual: {
      idUsuario: 8,
      idUsuarioReal: 8,
      impersonacionActiva: false
    },
    idSesion: 'sesion-propia',
    passwordNuevo: 'NuevaClave456!',
    passwordConfirmacion: 'NuevaClave456!'
  });

  assert.equal(resultado.codigo, 'password_actualizado_sesion_cerrada');
  assert.deepEqual(orden, [
    'autorizacion',
    'bloqueo',
    'sql',
    'invalidacion',
    'sesiones'
  ]);
}

async function verificarMutacionesAdministrativas() {
  const eventos = [];
  const usuario = crearUsuarioAdministrativo();
  const servicio = Object.create(ServicioUsuarios.prototype);
  servicio.repositorioUsuarios = {
    async buscarPorIdParaAdministracion() {
      return usuario;
    },
    async actualizarUsuarioAdministrativo({ email }) {
      eventos.push('sql-email');
      usuario.email = email;
      usuario.emailValidado = false;
      return usuario;
    },
    async reiniciarPasswordAdministrativa({ hashPasswordNuevo }) {
      eventos.push('sql-password');
      usuario.hashPassword = hashPasswordNuevo;
      usuario.requiereCambioPassword = true;
      usuario.versionSesion += 1;
      return usuario;
    },
    async establecerActivoAdministrativo({ activo }) {
      eventos.push(activo ? 'sql-reactivar' : 'sql-desactivar');
      usuario.activo = activo;
      usuario.versionSesion += 1;
      return usuario;
    }
  };
  servicio.servicioAutenticacion = {
    validarPasswordNueva(password, confirmacion) {
      assert.equal(password, confirmacion);
    },
    async crearHashPassword() {
      return 'hash-administrativo';
    }
  };
  servicio.servicioEstadoSensibleUsuario = {
    async ejecutarConExclusion(_idUsuario, operacion) {
      eventos.push('bloqueo');
      const resultado = await operacion();
      eventos.push('invalidacion');
      return {
        resultado,
        limpieza: { completa: true, pruebaEmailInvalidada: true }
      };
    }
  };
  servicio.servicioSesion = {
    async invalidarSesionesUsuario(_idUsuario, versionSesion) {
      eventos.push('sesiones');
      return { sesionesEliminadas: 1, versionSesion };
    },
    async sincronizarVersionUsuario() {}
  };
  servicio.validadorJerarquiaUsuario = { validarEdicionBase() {} };
  servicio.assertUsuarioConJerarquiaValida = () => {};
  servicio.assertCoberturaAdministrativaCritica = async () => {};
  servicio.resolverScopeObjetivoValido = async () => ({
    nivelScope: 'portal',
    tenantId: null,
    empresaId: null,
    sitioId: null
  });
  servicio.construirPermisosObjetivoDesdeFormulario = () => ({});
  servicio.hayCambioPermisos = () => false;
  const contexto = { idUsuario: 1 };

  const cambioEmail = await servicio.actualizarUsuarioAdministrativo(
    contexto,
    8,
    {
      email: 'administrado@example.test',
      nombre_mostrar: 'Operador',
      nombre_completo: 'Operador administrado'
    }
  );
  assert.equal(cambioEmail.cambioEmail, true);
  assert.equal(cambioEmail.usuario.emailValidado, false);

  await servicio.reiniciarPasswordAdministrativo(contexto, 8, {
    password: 'Temporal456!',
    passwordConfirmacion: 'Temporal456!'
  });
  assert.equal(usuario.requiereCambioPassword, true);

  await servicio.establecerEstadoUsuarioAdministrativo(contexto, 8, false);
  assert.equal(usuario.activo, false);
  await servicio.establecerEstadoUsuarioAdministrativo(contexto, 8, true);
  assert.equal(usuario.activo, true);

  assert.deepEqual(eventos, [
    'bloqueo', 'sql-email', 'invalidacion',
    'bloqueo', 'sql-password', 'invalidacion', 'sesiones',
    'bloqueo', 'sql-desactivar', 'invalidacion', 'sesiones',
    'bloqueo', 'sql-reactivar', 'invalidacion', 'sesiones'
  ]);
}

async function verificarFalloRedisPosteriorAlCambioDurable() {
  let cambiosDurables = 0;
  const servicio = new ServicioEstadoSensibleUsuario({
    repositorioOperacionesEmail: {
      async adquirirBloqueoUsuario() {
        return 'bloqueo';
      },
      async liberarBloqueoUsuario() {},
      async invalidarOperacionUsuario() {
        throw new Error('Redis email no disponible');
      }
    },
    servicioAutorizacionPerfil: {
      async revocarTodasLasAutorizaciones() {
        throw new Error('Redis autorización no disponible');
      }
    }
  });

  const ejecucion = await servicio.ejecutarConExclusion(8, async () => {
    cambiosDurables += 1;
    return { actualizado: true };
  });
  assert.equal(cambiosDurables, 1);
  assert.equal(ejecucion.limpieza.completa, false);
  assert.equal(ejecucion.limpieza.errores.length, 2);

  const servicioUsuarios = Object.create(ServicioUsuarios.prototype);
  assert.throws(
    () => servicioUsuarios.exigirLimpiezaSensibleCompleta(ejecucion, {
      operacion: 'completar la mutación de prueba'
    }),
    /no pudo invalidarse todo el estado sensible/
  );
}

async function verificarPersistenciaAdministrativaSqlReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioUsuarios(clienteSql);
  const sufijo = crypto.randomUUID().replaceAll('-', '');
  let idUsuario = null;

  try {
    const [insercion] = await clienteSql.ejecutar(
      `
        INSERT INTO usuarios (
          usuario,
          email,
          hash_password,
          requiere_cambio_password,
          version_sesion
        ) VALUES (?, ?, ?, 0, 2)
      `,
      [
        `fase8_${sufijo}`,
        `fase8_${sufijo}@example.test`,
        'hash-anterior'
      ]
    );
    idUsuario = Number(insercion.insertId);

    const reiniciado = await repositorio.reiniciarPasswordAdministrativa({
      idUsuario,
      hashPasswordNuevo: 'hash-administrativo'
    });
    assert.equal(reiniciado.hashPassword, 'hash-administrativo');
    assert.equal(reiniciado.requiereCambioPassword, true);
    assert.equal(reiniciado.versionSesion, 3);

    const desactivado = await repositorio.establecerActivoAdministrativo({
      idUsuario,
      activo: false
    });
    assert.equal(desactivado.activo, false);
    assert.equal(desactivado.versionSesion, 4);

    const reactivado = await repositorio.establecerActivoAdministrativo({
      idUsuario,
      activo: true
    });
    assert.equal(reactivado.activo, true);
    assert.equal(reactivado.versionSesion, 5);

    const repetido = await repositorio.establecerActivoAdministrativo({
      idUsuario,
      activo: true
    });
    assert.equal(repetido.versionSesion, 5);
  } finally {
    if (idUsuario) {
      await clienteSql.ejecutar('DELETE FROM usuarios WHERE id = ?', [idUsuario]);
    }
    await clienteSql.cerrar();
  }
}

function crearUsuarioAdministrativo() {
  return {
    id: 8,
    usuario: 'operador',
    activo: true,
    email: 'anterior@example.test',
    emailValidado: true,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    versionSesion: 1,
    permisos: { serializar: () => ({}) }
  };
}

async function limpiarPrefijos(redis, prefijos) {
  const claves = [];
  for (const prefijo of prefijos) {
    for await (const clave of redis.scanIterator({
      MATCH: `${prefijo}*`,
      COUNT: 100
    })) {
      claves.push(clave);
    }
  }
  if (claves.length > 0) await redis.del(claves);
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación de la fase 8.');
  console.error(error);
  process.exit(1);
});
