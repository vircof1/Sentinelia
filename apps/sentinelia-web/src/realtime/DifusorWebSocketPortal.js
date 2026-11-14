import crypto from 'node:crypto';

function crearClaveAceptacion(secWebSocketKey) {
  return crypto
    .createHash('sha1')
    .update(`${secWebSocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function crearRespuestaSimulada() {
  return {
    headersSent: false,
    locals: {},
    getHeader() {
      return undefined;
    },
    setHeader() {},
    writeHead() {},
    end() {},
    on() {},
    once() {},
    emit() {}
  };
}

function resolverInstanteUtcMs(valor) {
  const instante = Date.parse(String(valor || ''));
  return Number.isFinite(instante) ? instante : null;
}

function resolverProximoVencimientoDescarteTemporal(dashboard) {
  const ahora = Date.now();
  const candidatos = [];

  for (const alerta of dashboard?.alertasDescartadas || []) {
    const descarte = alerta?.descarteOperativo || {};
    const vencimientoMs = resolverInstanteUtcMs(descarte.descartadaHastaUtc);

    if (descarte.vigente && vencimientoMs && vencimientoMs > ahora) {
      candidatos.push({
        monitorId: Number(alerta.monitorId || 0) || null,
        vencimientoUtc: descarte.descartadaHastaUtc,
        vencimientoMs
      });
    }
  }

  candidatos.sort((a, b) => a.vencimientoMs - b.vencimientoMs);
  return candidatos[0] || null;
}

export class DifusorWebSocketPortal {
  constructor({
    sessionMiddleware,
    servicioSesion,
    servicioContextoUsuario,
    servicioAutorizacion,
    registroSesionesWeb = null,
    path = '/ws/panel-dashboard'
  }) {
    this.sessionMiddleware = sessionMiddleware;
    this.servicioSesion = servicioSesion;
    this.servicioContextoUsuario = servicioContextoUsuario;
    this.servicioAutorizacion = servicioAutorizacion;
    this.registroSesionesWeb = registroSesionesWeb;
    this.path = path;
    this.clientes = new Set();
    this.temporizadorVencimientoDescarte = null;
    this.vencimientoDescarteProgramadoMs = null;
    this.monitorIdVencimientoDescarte = null;
    this.temporizadorVencimientoDescarteRemoto = null;
    this.vencimientoDescarteRemotoProgramadoMs = null;
  }

  async atenderUpgrade(requisicion, socket, head = Buffer.alloc(0)) {
    try {
      const url = new URL(requisicion.url || '/', 'http://localhost');

      if (url.pathname !== this.path) {
        this.responderError(socket, 404, 'Not Found');
        return false;
      }

      await this.aplicarSesion(requisicion);

      if (!requisicion.session?.usuarioAutenticado) {
        this.responderError(socket, 401, 'Unauthorized');
        return false;
      }

      const versionValida =
        await this.servicioSesion.validarVersionSesion(requisicion);

      if (!versionValida) {
        this.responderError(socket, 401, 'Unauthorized');
        return false;
      }

      const contextoUsuarioActual =
        await this.servicioContextoUsuario.cargarDesdeSesion(requisicion);

      if (!contextoUsuarioActual || (!this.servicioAutorizacion.puedeVerMonitores(
        contextoUsuarioActual
      ) && !this.servicioAutorizacion.puedeVerAvisosPlataforma(
        contextoUsuarioActual
      ) && !this.servicioAutorizacion.puedeVerAlertasRemotas(
        contextoUsuarioActual
      ) && !this.servicioAutorizacion.puedeUsarBuzonPersonal?.(
        contextoUsuarioActual
      ))) {
        this.responderError(socket, 403, 'Forbidden');
        return false;
      }

      if (this.registroSesionesWeb && !requisicion.sesionWebAuditoria) {
        this.responderError(socket, 401, 'Unauthorized');
        return false;
      }

      const claveCliente = String(
        requisicion.headers['sec-websocket-key'] || ''
      ).trim();

      if (!claveCliente) {
        this.responderError(socket, 400, 'Bad Request');
        return false;
      }

      const claveAceptacion = crearClaveAceptacion(claveCliente);
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${claveAceptacion}`,
          '\r\n'
        ].join('\r\n')
      );

      const cliente = {
        socket,
        buffer: Buffer.alloc(0),
        conectadoEnUtc: new Date().toISOString(),
        usuario: requisicion.session.usuarioAutenticado,
        contextoUsuarioActual,
        sesionWebAuditoria: requisicion.sesionWebAuditoria ?? null,
        retirarRegistroSesionWeb: null
      };

      if (this.registroSesionesWeb && cliente.sesionWebAuditoria) {
        cliente.retirarRegistroSesionWeb =
          this.registroSesionesWeb.registrar({
            socket,
            sesion: cliente.sesionWebAuditoria
          });
      }

      this.clientes.add(cliente);
      socket.on('data', (datos) => this.procesarDatosCliente(cliente, datos));
      socket.on('close', () => this.eliminarCliente(cliente));
      socket.on('end', () => this.eliminarCliente(cliente));
      socket.on('error', () => this.eliminarCliente(cliente));

      if (head.length > 0) {
        this.procesarDatosCliente(cliente, head);
      }

      this.enviarEventoDashboard(cliente, {
        tipo: 'portal_socket_conectado',
        conectadoEnUtc: cliente.conectadoEnUtc
      });

      return true;
    } catch (error) {
      console.error('[sentinelia-web] Error al aceptar WebSocket de dashboard');
      console.error(error);
      this.cerrarSilencioso(socket);
      return false;
    }
  }

  emitirDashboardActualizado(payload = {}) {
    const evento = {
      tipo: 'dashboard_actualizado',
      firmaDashboard: String(payload.firmaDashboard || '').trim() || null,
      versionOperativa: Number(payload.versionOperativa || 0) || null,
      versionCatalogoMonitores:
        Number(payload.versionCatalogoMonitores || 0) || null,
      monitorId: Number(payload.monitorId || 0) || null,
      sincronizadoEn: payload.sincronizadoEn || new Date().toISOString(),
      motivoPublicacion: payload.motivoPublicacion || 'actualizacion_operativa'
    };

    for (const cliente of this.clientes) {
      if (this.servicioAutorizacion.puedeVerMonitores(cliente.contextoUsuarioActual)) {
        this.enviarEventoDashboard(cliente, evento);
      }
    }
  }

  emitirAvisosPlataformaActualizados() {
    const evento = {
      tipo: 'avisos_plataforma_actualizados',
      sincronizadoEn: new Date().toISOString()
    };
    for (const cliente of this.clientes) {
      if (this.servicioAutorizacion.puedeVerAvisosPlataforma(
        cliente.contextoUsuarioActual
      )) {
        this.enviarEventoDashboard(cliente, evento);
      }
    }
  }

  emitirAlertasRemotasActualizadas() {
    const evento = { tipo: 'alertas_remotas_actualizadas', sincronizadoEn: new Date().toISOString() };
    for (const cliente of this.clientes) {
      if (this.servicioAutorizacion.puedeVerAlertasRemotas(cliente.contextoUsuarioActual)) {
        this.enviarEventoDashboard(cliente, evento);
      }
    }
  }

  emitirBuzonUsuarioActualizado({ destinatarioUsuarioId, firmaBuzon } = {}) {
    const destinatario = String(destinatarioUsuarioId ?? '');
    const firma = String(firmaBuzon || '');
    if (!/^[1-9][0-9]*$/u.test(destinatario) || !/^[0-9a-f]{64}$/u.test(firma)) {
      throw new Error('La invalidación WebSocket del buzón no es válida.');
    }
    const evento = {
      tipo: 'buzon_usuario_actualizado',
      firmaBuzon: firma,
      sincronizadoEn: new Date().toISOString()
    };
    let entregados = 0;
    for (const cliente of this.clientes) {
      const usuarioReal = String(
        cliente.usuario?.idUsuarioReal ?? cliente.usuario?.idUsuario ?? ''
      );
      if (
        usuarioReal === destinatario &&
        this.servicioAutorizacion.puedeUsarBuzonPersonal?.(
          cliente.contextoUsuarioActual
        )
      ) {
        this.enviarEventoDashboard(cliente, evento);
        entregados += 1;
      }
    }
    return entregados;
  }

  programarVencimientoAlertaRemota(vencimientoUtc) {
    const ms = resolverInstanteUtcMs(vencimientoUtc);
    if (!ms || ms <= Date.now()) return false;
    if (this.vencimientoDescarteRemotoProgramadoMs &&
        this.vencimientoDescarteRemotoProgramadoMs <= ms) return false;
    if (this.temporizadorVencimientoDescarteRemoto) {
      clearTimeout(this.temporizadorVencimientoDescarteRemoto);
    }
    this.vencimientoDescarteRemotoProgramadoMs = ms;
    this.temporizadorVencimientoDescarteRemoto = setTimeout(() => {
      this.temporizadorVencimientoDescarteRemoto = null;
      this.vencimientoDescarteRemotoProgramadoMs = null;
      this.emitirAlertasRemotasActualizadas();
    }, Math.min(Math.max(ms - Date.now() + 1000, 1000), 2147483647));
    this.temporizadorVencimientoDescarteRemoto.unref?.();
    return true;
  }

  programarVencimientoDescarteAlertaRemota(vencimientoUtc) {
    return this.programarVencimientoAlertaRemota(vencimientoUtc);
  }

  sincronizarVencimientoDescarteTemporalDesdeDashboard(dashboard) {
    const proximoVencimiento =
      resolverProximoVencimientoDescarteTemporal(dashboard);

    if (!proximoVencimiento) {
      return false;
    }

    return this.programarVencimientoDescarteTemporal(
      proximoVencimiento.vencimientoUtc,
      { monitorId: proximoVencimiento.monitorId }
    );
  }

  programarVencimientoDescarteTemporal(vencimientoUtc, { monitorId = null } = {}) {
    const vencimientoMs = resolverInstanteUtcMs(vencimientoUtc);

    if (!vencimientoMs || vencimientoMs <= Date.now()) {
      return false;
    }

    if (
      this.vencimientoDescarteProgramadoMs &&
      this.vencimientoDescarteProgramadoMs <= vencimientoMs
    ) {
      return false;
    }

    if (this.temporizadorVencimientoDescarte) {
      clearTimeout(this.temporizadorVencimientoDescarte);
    }

    const retrasoMs = Math.min(
      Math.max(vencimientoMs - Date.now() + 1000, 1000),
      2147483647
    );

    this.vencimientoDescarteProgramadoMs = vencimientoMs;
    this.monitorIdVencimientoDescarte = Number(monitorId || 0) || null;
    this.temporizadorVencimientoDescarte = setTimeout(() => {
      const monitorIdProgramado = this.monitorIdVencimientoDescarte;

      this.temporizadorVencimientoDescarte = null;
      this.vencimientoDescarteProgramadoMs = null;
      this.monitorIdVencimientoDescarte = null;
      this.emitirDashboardActualizado({
        motivoPublicacion: 'vencimiento_descarte_alerta_activa',
        monitorId: monitorIdProgramado,
        sincronizadoEn: new Date().toISOString()
      });
    }, retrasoMs);

    this.temporizadorVencimientoDescarte.unref?.();
    return true;
  }

  async aplicarSesion(requisicion) {
    return new Promise((resolve, reject) => {
      this.sessionMiddleware(requisicion, crearRespuestaSimulada(), (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  procesarDatosCliente(cliente, datos) {
    if (!cliente?.socket || !Buffer.isBuffer(datos) || datos.length === 0) {
      return;
    }

    cliente.buffer = Buffer.concat([cliente.buffer, datos]);

    while (cliente.buffer.length >= 2) {
      const primerByte = cliente.buffer[0];
      const segundoByte = cliente.buffer[1];
      const opcode = primerByte & 0x0f;
      const enmascarado = (segundoByte & 0x80) === 0x80;
      let longitudPayload = segundoByte & 0x7f;
      let offset = 2;

      if (longitudPayload === 126) {
        if (cliente.buffer.length < offset + 2) {
          return;
        }

        longitudPayload = cliente.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (longitudPayload === 127) {
        this.cerrarSilencioso(cliente.socket);
        return;
      }

      const longitudMascara = enmascarado ? 4 : 0;
      const longitudTotal = offset + longitudMascara + longitudPayload;

      if (cliente.buffer.length < longitudTotal) {
        return;
      }

      const mascara = enmascarado
        ? cliente.buffer.subarray(offset, offset + 4)
        : null;
      const payloadInicio = offset + longitudMascara;
      const payload = cliente.buffer.subarray(
        payloadInicio,
        payloadInicio + longitudPayload
      );

      cliente.buffer = cliente.buffer.subarray(longitudTotal);

      let payloadNormalizado = payload;

      if (mascara) {
        payloadNormalizado = Buffer.alloc(payload.length);

        for (let indice = 0; indice < payload.length; indice += 1) {
          payloadNormalizado[indice] = payload[indice] ^ mascara[indice % 4];
        }
      }

      if (opcode === 0x8) {
        this.cerrarSilencioso(cliente.socket);
        return;
      }

      if (opcode === 0x9) {
        this.enviarFrame(cliente.socket, payloadNormalizado, 0x0a);
      }
    }
  }

  enviarEventoDashboard(cliente, evento) {
    if (!cliente?.socket || cliente.socket.destroyed) {
      this.eliminarCliente(cliente);
      return;
    }

    const payload = Buffer.from(JSON.stringify(evento), 'utf8');
    this.enviarFrame(cliente.socket, payload, 0x01);
  }

  enviarFrame(socket, payload, opcode) {
    if (!socket || socket.destroyed) {
      return;
    }

    const longitud = payload.length;
    let cabecera = null;

    if (longitud < 126) {
      cabecera = Buffer.from([0x80 | opcode, longitud]);
    } else {
      cabecera = Buffer.alloc(4);
      cabecera[0] = 0x80 | opcode;
      cabecera[1] = 126;
      cabecera.writeUInt16BE(longitud, 2);
    }

    socket.write(Buffer.concat([cabecera, payload]));
  }

  eliminarCliente(cliente) {
    if (cliente) {
      try {
        cliente.retirarRegistroSesionWeb?.();
      } catch {}
      this.clientes.delete(cliente);
    }
  }

  responderError(socket, codigo, texto) {
    if (!socket.destroyed) {
      socket.write(`HTTP/1.1 ${codigo} ${texto}\r\nConnection: close\r\n\r\n`);
    }

    this.cerrarSilencioso(socket);
  }

  cerrarSilencioso(socket) {
    if (!socket || socket.destroyed) {
      return;
    }

    socket.end();
    socket.destroy();
  }
}
