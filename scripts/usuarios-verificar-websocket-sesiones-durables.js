import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RegistroWebSocketsSesionesWebDurables } from '../paquetes/sesiones/src/RegistroWebSocketsSesionesWebDurables.js';
import { DifusorWebSocketPortal } from '../apps/sentinelia-web/src/realtime/DifusorWebSocketPortal.js';

async function main() {
  const sesion = sesionDurableFixture();
  const repositorio = new RepositorioSesionesFixture(sesion);
  const registroA = new RegistroWebSocketsSesionesWebDurables({
    repositorioSesiones: repositorio,
    instanciaId: 'web-a',
    intervaloRevalidacionMs: 1_000
  });
  const registroB = new RegistroWebSocketsSesionesWebDurables({
    repositorioSesiones: repositorio,
    instanciaId: 'web-b',
    intervaloRevalidacionMs: 1_000
  });

  await verificarDifusorRegistraSesionDurable({ sesion, registroA });
  await verificarInvalidacionLocal({ sesion, registroA });
  await verificarRevalidacionReparaSenalPerdida({ sesion, repositorio, registroB });

  console.log(
    '[usuarios] OK 5.21.8c: websocket=sesion_durable ' +
    'invalidacion=redis revalidacion=sql ids=sin_filtrar'
  );
}

async function verificarDifusorRegistraSesionDurable({ sesion, registroA }) {
  const socket = new SocketFixture();
  const requisicion = {
    url: '/ws/panel-dashboard',
    headers: {
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='
    },
    session: {
      usuarioAutenticado: {
        idUsuario: Number(sesion.usuarioEfectivoId),
        idUsuarioReal: Number(sesion.usuarioRealId),
        idUsuarioEfectivo: Number(sesion.usuarioEfectivoId),
        versionSesionReal: sesion.versionSesionReal,
        versionSesionEfectiva: sesion.versionSesionEfectiva
      }
    }
  };
  const difusor = new DifusorWebSocketPortal({
    sessionMiddleware: (_req, _res, next) => next(),
    servicioSesion: {
      async validarVersionSesion(req) {
        req.sesionWebAuditoria = sesion;
        return true;
      }
    },
    servicioContextoUsuario: {
      async cargarDesdeSesion() {
        return { idUsuario: Number(sesion.usuarioEfectivoId) };
      }
    },
    servicioAutorizacion: {
      puedeVerMonitores() {
        return true;
      }
    },
    registroSesionesWeb: registroA
  });

  assert.equal(await difusor.atenderUpgrade(requisicion, socket), true);
  assert.equal(registroA.total, 1);
  const trafico = socket.escrituras.map((buffer) => buffer.toString('utf8')).join('\n');
  assert.match(trafico, /101 Switching Protocols/);
  assert.doesNotMatch(trafico, /sesionAuditoriaId/);
  assert.doesNotMatch(trafico, new RegExp(sesion.sesionAuditoriaId));
  socket.emit('close');
  assert.equal(registroA.total, 0);
}

async function verificarInvalidacionLocal({ sesion, registroA }) {
  const socket = new SocketFixture();
  registroA.registrar({ socket, sesion });
  assert.equal(registroA.total, 1);
  assert.equal(registroA.procesarInvalidacion([sesion.sesionAuditoriaId]), 1);
  assert.equal(socket.cerrado, true);
  assert.equal(registroA.total, 0);
}

async function verificarRevalidacionReparaSenalPerdida({ sesion, repositorio, registroB }) {
  const socket = new SocketFixture();
  registroB.registrar({ socket, sesion });
  assert.equal(registroB.total, 1);
  repositorio.estado = 'invalidada';
  const resultado = await registroB.revalidar();
  assert.equal(resultado.cerradas, 1);
  assert.equal(resultado.restantes, 0);
  assert.equal(socket.cerrado, true);
}

class RepositorioSesionesFixture {
  constructor(sesion) {
    this.sesion = sesion;
    this.estado = 'abierta';
  }

  async buscarVigentePorId(sesionAuditoriaId) {
    if (
      this.estado !== 'abierta' ||
      sesionAuditoriaId !== this.sesion.sesionAuditoriaId
    ) {
      return null;
    }
    return Object.freeze({ ...this.sesion });
  }
}

class SocketFixture extends EventEmitter {
  constructor() {
    super();
    this.escrituras = [];
    this.cerrado = false;
    this.destroyed = false;
  }

  write(payload) {
    this.escrituras.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)));
  }

  end() {
    this.cerrado = true;
  }

  destroy() {
    this.cerrado = true;
    this.destroyed = true;
  }
}

function sesionDurableFixture() {
  return Object.freeze({
    sesionAuditoriaId: generarUuidV7Auditoria(),
    usuarioRealId: '101',
    usuarioEfectivoId: '101',
    versionSesionReal: 7,
    versionSesionEfectiva: 7,
    scopeApertura: Object.freeze({
      tenantId: null,
      empresaId: null,
      sitioId: null
    }),
    scopeEfectivoActual: Object.freeze({
      tenantId: null,
      empresaId: null,
      sitioId: null
    }),
    estado: 'abierta',
    expiraEnUtc: new Date(Date.now() + 60_000).toISOString()
  });
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación 5.21.8c');
  console.error(error);
  process.exitCode = 1;
});
