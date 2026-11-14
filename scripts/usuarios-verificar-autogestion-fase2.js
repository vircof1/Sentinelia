import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { RepositorioAutorizacionPerfilRedis } from '../paquetes/usuarios/src/RepositorioAutorizacionPerfilRedis.js';
import { ServicioAutenticacion } from '../paquetes/usuarios/src/ServicioAutenticacion.js';
import { ServicioAutorizacionPerfil } from '../paquetes/usuarios/src/ServicioAutorizacionPerfil.js';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { ControladorUsuarios } from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';

async function main() {
  await verificarContratoConRelojControlado();
  await verificarContratoControlador();
  await verificarRepositorioContraRedisReal();

  console.log(
    '[usuarios] Fase 2 de autogestión verificada: autorización temporal correcta.'
  );
}

async function verificarContratoControlador() {
  const controlador = new ControladorUsuarios({
    servicioUsuarios: {},
    servicioAutorizacionPerfil: {
      async desbloquear({ passwordActual }) {
        assert.equal(passwordActual, 'secreto');
        return {
          codigo: 'perfil_edicion_autorizada',
          mensaje: 'Autorizada.',
          datos: {
            expira_en: '2026-07-19T16:15:00.000Z'
          }
        };
      },
      async cerrarEdicion() {
        return {
          codigo: 'perfil_edicion_cerrada',
          mensaje: 'Cerrada.',
          datos: { revocada: false }
        };
      }
    }
  });
  const respuestaDesbloqueo = crearRespuestaControlada();

  await controlador.apiDesbloquearPerfil(
    crearRequisicionJson({ password_actual: 'secreto' }),
    respuestaDesbloqueo
  );
  assert.equal(respuestaDesbloqueo.estado, 200);
  assert.equal(
    respuestaDesbloqueo.payload.codigo,
    'perfil_edicion_autorizada'
  );

  const respuestaInvalida = crearRespuestaControlada();
  await controlador.apiDesbloquearPerfil(
    crearRequisicionJson({
      password_actual: 'secreto',
      atributo_extra: true
    }),
    respuestaInvalida
  );
  assert.equal(respuestaInvalida.estado, 400);
  assert.equal(respuestaInvalida.payload.codigo, 'peticion_invalida');

  const respuestaCierre = crearRespuestaControlada();
  await controlador.apiCerrarEdicionPerfil(
    crearRequisicionJson({}),
    respuestaCierre
  );
  assert.equal(respuestaCierre.payload.codigo, 'perfil_edicion_cerrada');
  assert.equal(respuestaCierre.payload.datos.revocada, false);

  const controladorConFallo = new ControladorUsuarios({
    servicioUsuarios: {},
    servicioAutorizacionPerfil: {
      async desbloquear() {
        throw new Error('Redis no disponible');
      }
    }
  });
  const respuestaInfraestructura = crearRespuestaControlada();
  const registrarErrorOriginal = console.error;

  try {
    console.error = () => {};
    await controladorConFallo.apiDesbloquearPerfil(
      crearRequisicionJson({ password_actual: 'secreto' }),
      respuestaInfraestructura
    );
  } finally {
    console.error = registrarErrorOriginal;
  }

  assert.equal(respuestaInfraestructura.estado, 500);
  assert.equal(
    respuestaInfraestructura.payload.codigo,
    'infraestructura_no_disponible'
  );
}

async function verificarContratoConRelojControlado() {
  const reloj = new RelojControlado(Date.UTC(2026, 6, 19, 16, 0, 0));
  const redis = new RedisControlado(reloj);
  const repositorio = new RepositorioAutorizacionPerfilRedis({
    clienteRedis: redis,
    prefijoRedis: 'prueba:perfil:',
    ttlAutorizacionSegundos: 900,
    cadenciaReautenticacionSegundos: 2,
    obtenerAhoraMs: () => reloj.ahoraMs
  });
  const hashPassword = await new ServicioAutenticacion({
    repositorioUsuarios: {}
  }).crearHashPassword('ClaveCorrecta123!');
  let consultasUsuario = 0;
  const servicioAutenticacion = new ServicioAutenticacion({
    repositorioUsuarios: {
      async buscarPorId(idUsuario) {
        consultasUsuario += 1;
        if (Number(idUsuario) !== 7) {
          return null;
        }

        return {
          activo: true,
          hashPassword
        };
      }
    }
  });
  const servicio = new ServicioAutorizacionPerfil({
    repositorioAutorizacionPerfil: repositorio,
    servicioAutenticacion
  });
  const contexto = crearContextoOrdinario();

  const desbloqueo = await servicio.desbloquear({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a',
    passwordActual: 'ClaveCorrecta123!'
  });

  assert.equal(desbloqueo.codigo, 'perfil_edicion_autorizada');
  assert.equal(
    desbloqueo.datos.expira_en,
    new Date(reloj.ahoraMs + 900_000).toISOString()
  );
  assert.equal(consultasUsuario, 1);

  const estadoInicial = await servicio.obtenerEstado({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a'
  });
  assert.equal(estadoInicial.autorizada, true);

  await assert.rejects(
    servicio.desbloquear({
      contextoUsuarioActual: contexto,
      idSesion: 'sesion-a',
      passwordActual: 'ClaveCorrecta123!'
    }),
    (error) => {
      assert.equal(error.codigo, 'reauth_limitada');
      assert.equal(error.estadoHttp, 429);
      return true;
    }
  );
  assert.equal(consultasUsuario, 1);

  reloj.avanzar(100_000);
  const estadoPosterior = await servicio.obtenerEstado({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a'
  });
  assert.equal(estadoPosterior.expiraEn, estadoInicial.expiraEn);

  await assert.rejects(
    servicio.desbloquear({
      contextoUsuarioActual: contexto,
      idSesion: 'sesion-a',
      passwordActual: 'incorrecta'
    }),
    (error) => error.codigo === 'password_actual_incorrecta'
  );

  const estadoTrasFallo = await servicio.obtenerEstado({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a'
  });
  assert.equal(estadoTrasFallo.expiraEn, estadoInicial.expiraEn);

  reloj.avanzar(2_000);
  const renovada = await servicio.desbloquear({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a',
    passwordActual: 'ClaveCorrecta123!'
  });
  assert.notEqual(renovada.datos.expira_en, estadoInicial.expiraEn);

  const otraSesion = await servicio.obtenerEstado({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-b'
  });
  assert.equal(otraSesion.autorizada, false);

  await assert.rejects(
    servicio.exigirAutorizacion({
      contextoUsuarioActual: contexto,
      idSesion: 'sesion-b'
    }),
    (error) => error.codigo === 'perfil_edicion_requerida'
  );

  await assert.rejects(
    servicio.desbloquear({
      contextoUsuarioActual: {
        ...contexto,
        idUsuario: 8,
        impersonacionActiva: true
      },
      idSesion: 'sesion-impersonada',
      passwordActual: 'ClaveCorrecta123!'
    }),
    (error) => {
      assert.equal(error.codigo, 'impersonacion_no_permitida');
      assert.equal(error.estadoHttp, 403);
      return true;
    }
  );

  const cierre = await servicio.cerrarEdicion({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a'
  });
  assert.equal(cierre.datos.revocada, true);

  const cierreRepetido = await servicio.cerrarEdicion({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-a'
  });
  assert.equal(cierreRepetido.datos.revocada, false);

  await repositorio.guardarAutorizacion({
    idUsuarioReal: contexto.idUsuarioReal,
    idSesion: 'sesion-expirable'
  });
  reloj.avanzar(900_001);
  const estadoExpirado = await servicio.obtenerEstado({
    contextoUsuarioActual: contexto,
    idSesion: 'sesion-expirable'
  });
  assert.equal(estadoExpirado.autorizada, false);
  assert.equal(estadoExpirado.expiraEn, null);
}

async function verificarRepositorioContraRedisReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  const conexion = new ServicioConexionRedis(configuracion.redis);
  const clienteRedis = await conexion.conectar();
  const prefijo = `sentinelia:prueba:perfil:${crypto.randomUUID()}:`;
  const repositorio = new RepositorioAutorizacionPerfilRedis({
    clienteRedis,
    prefijoRedis: prefijo,
    ttlAutorizacionSegundos: 30,
    cadenciaReautenticacionSegundos: 2
  });
  const claveAutorizacion = repositorio.obtenerClaveAutorizacion({
    idUsuarioReal: 700001,
    idSesion: 'sesion-integracion-a'
  });
  const claveCadencia = repositorio.obtenerClaveCadencia(700001);

  try {
    await repositorio.guardarAutorizacion({
      idUsuarioReal: 700001,
      idSesion: 'sesion-integracion-a'
    });

    assert.ok(await repositorio.obtenerAutorizacion({
      idUsuarioReal: 700001,
      idSesion: 'sesion-integracion-a'
    }));
    assert.equal(await repositorio.obtenerAutorizacion({
      idUsuarioReal: 700001,
      idSesion: 'sesion-integracion-b'
    }), null);

    const ttl = await clienteRedis.ttl(claveAutorizacion);
    assert.ok(ttl > 0 && ttl <= 30);

    const primerIntento =
      await repositorio.intentarRegistrarReautenticacion(700001);
    const segundoIntento =
      await repositorio.intentarRegistrarReautenticacion(700001);
    assert.equal(primerIntento.permitido, true);
    assert.equal(segundoIntento.permitido, false);

    assert.equal(await repositorio.revocarAutorizacion({
      idUsuarioReal: 700001,
      idSesion: 'sesion-integracion-a'
    }), true);
    assert.equal(await repositorio.obtenerAutorizacion({
      idUsuarioReal: 700001,
      idSesion: 'sesion-integracion-a'
    }), null);
  } finally {
    await clienteRedis.del([claveAutorizacion, claveCadencia]);
    await conexion.cerrar();
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

class RelojControlado {
  constructor(ahoraMs) {
    this.ahoraMs = ahoraMs;
  }

  avanzar(milisegundos) {
    this.ahoraMs += milisegundos;
  }
}

class RedisControlado {
  constructor(reloj) {
    this.reloj = reloj;
    this.valores = new Map();
  }

  async set(clave, valor, opciones = {}) {
    this.eliminarSiExpirada(clave);

    if (opciones.NX && this.valores.has(clave)) {
      return null;
    }

    this.valores.set(clave, {
      valor: String(valor),
      expiraEnMs: opciones.EX
        ? this.reloj.ahoraMs + Number(opciones.EX) * 1000
        : null
    });
    return 'OK';
  }

  async get(clave) {
    this.eliminarSiExpirada(clave);
    return this.valores.get(clave)?.valor ?? null;
  }

  async del(claveOClaves) {
    const claves = Array.isArray(claveOClaves) ? claveOClaves : [claveOClaves];
    let eliminadas = 0;

    for (const clave of claves) {
      eliminadas += this.valores.delete(clave) ? 1 : 0;
    }

    return eliminadas;
  }

  async ttl(clave) {
    this.eliminarSiExpirada(clave);
    const entrada = this.valores.get(clave);

    if (!entrada) {
      return -2;
    }

    if (entrada.expiraEnMs == null) {
      return -1;
    }

    return Math.max(
      0,
      Math.ceil((entrada.expiraEnMs - this.reloj.ahoraMs) / 1000)
    );
  }

  eliminarSiExpirada(clave) {
    const entrada = this.valores.get(clave);

    if (entrada?.expiraEnMs != null && entrada.expiraEnMs <= this.reloj.ahoraMs) {
      this.valores.delete(clave);
    }
  }
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación de la fase 2 de autogestión.');
  console.error(error);
  process.exit(1);
});
