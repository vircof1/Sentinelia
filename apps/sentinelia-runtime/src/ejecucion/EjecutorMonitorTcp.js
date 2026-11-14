import net from 'node:net';
import tls from 'node:tls';

function calcularDuracionMs(inicioIso, finIso) {
  if (!inicioIso || !finIso) {
    return 0;
  }

  const inicioMs = Date.parse(inicioIso);
  const finMs = Date.parse(finIso);

  if (Number.isNaN(inicioMs) || Number.isNaN(finMs)) {
    return 0;
  }

  return Math.max(0, finMs - inicioMs);
}

function crearErrorNormalizado({ codigo = null, mensaje = '', extra = null } = {}) {
  return {
    codigo: codigo == null ? null : String(codigo),
    mensaje: String(mensaje || 'Error desconocido de conexión TCP/TLS.'),
    extra
  };
}

function esErrorValidacionTls(error) {
  const codigo = String(error?.code || '').trim().toUpperCase();

  return [
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ].includes(codigo);
}

function parsearFechaCertificadoUtc(valor) {
  if (!valor) {
    return null;
  }

  const fechaMs = Date.parse(String(valor));

  if (Number.isNaN(fechaMs)) {
    return null;
  }

  return new Date(fechaMs).toISOString();
}

function calcularMsRestantesHasta(fechaIso, referenciaIso) {
  if (!fechaIso) {
    return null;
  }

  const fechaMs = Date.parse(String(fechaIso));
  const referenciaMs = Date.parse(String(referenciaIso || new Date().toISOString()));

  if (Number.isNaN(fechaMs) || Number.isNaN(referenciaMs)) {
    return null;
  }

  return fechaMs - referenciaMs;
}

function calcularDiasRestantes(msRestantes) {
  if (msRestantes == null) {
    return null;
  }

  return Math.floor(msRestantes / 86400000);
}

export class EjecutorMonitorTcp {
  tipoMonitor = 'tcp';

  async ejecutar(monitor, { programacion = null } = {}) {
    const reintentos = Number.parseInt(String(monitor.configuracion?.reintentos ?? 0), 10);
    const intentosMaximos = 1 + Math.max(0, Number.isNaN(reintentos) ? 0 : reintentos);
    const intentos = [];
    const ejecutadoEnUtc = new Date().toISOString();
    let intentoExitoso = null;

    for (let numeroIntento = 1; numeroIntento <= intentosMaximos; numeroIntento += 1) {
      const intento = await this.ejecutarIntento(monitor, numeroIntento);
      intentos.push(intento);

      if (intento.exito) {
        intentoExitoso = intento;
        break;
      }
    }

    const finalizadoEnUtc = new Date().toISOString();
    const resultadoFinal = intentoExitoso || intentos.at(-1) || null;
    const resultadoMetricas = resultadoFinal || intentoExitoso || null;

    return {
      monitorId: monitor.id,
      nombre: monitor.nombre,
      tipo: monitor.tipo,
      ejecutadoEnUtc,
      finalizadoEnUtc,
      duracionTotalMs: calcularDuracionMs(ejecutadoEnUtc, finalizadoEnUtc),
      programacion: programacion
        ? {
            proximoIntentoEvaluadoEn: programacion.proximoIntentoEn,
            retrasoSegundos: programacion.retrasoSegundos,
            motivoProgramacion: programacion.motivoProgramacion
          }
        : null,
      protocolo: {
        nombre: 'tcp',
        host: monitor.configuracion.host,
        puerto: monitor.configuracion.puerto,
        usarTls: Boolean(monitor.configuracion.usarTls),
        vigenciaMinimaCertDias: Number(
          monitor.configuracion.vigenciaMinimaCertDias || 0
        ),
        timeoutMs: monitor.configuracion.timeoutMs,
        reintentosConfigurados: Math.max(0, intentosMaximos - 1)
      },
      intentosRealizados: intentos.length,
      intentoExitoso: intentoExitoso?.numeroIntento || null,
      exito: Boolean(intentoExitoso),
      estadoDetectado: intentoExitoso ? 'disponible' : 'indisponible',
      codigoResultado: resultadoFinal?.codigoResultado || 'sin_resultado',
      mensajeResultado:
        resultadoFinal?.mensajeResultado || 'No se obtuvo resultado técnico.',
      detalleError: intentoExitoso ? null : resultadoFinal?.detalleError || null,
      metricaPrincipal: {
        hostRemoto: resultadoMetricas?.detalle?.remoteAddress ?? null,
        puertoRemoto: resultadoMetricas?.detalle?.remotePort ?? null,
        tlsAutorizado: resultadoMetricas?.detalle?.tls?.autorizado ?? null,
        certificadoValidoHastaUtc:
          resultadoMetricas?.detalle?.tls?.certificado?.validoHastaUtc ?? null,
        certificadoDiasRestantes:
          resultadoMetricas?.detalle?.tls?.certificado?.diasRestantes ?? null,
        certificadoVigenciaMinimaDias:
          resultadoMetricas?.detalle?.tls?.certificado?.vigenciaMinimaCertDias ?? null
      },
      intentos
    };
  }

  ejecutarIntento(monitor, numeroIntento) {
    const inicioUtc = new Date().toISOString();
    const usarTls = Boolean(monitor.configuracion.usarTls);
    const vigenciaMinimaCertDias = Number.parseInt(
      String(monitor.configuracion?.vigenciaMinimaCertDias ?? 0),
      10
    );
    const timeoutMs = Number.parseInt(
      String(monitor.configuracion?.timeoutMs ?? 1000),
      10
    );

    return new Promise((resolve) => {
      let finalizado = false;
      const detalle = {
        remoteAddress: null,
        remotePort: null,
        tls: usarTls
          ? {
              autorizado: null,
              errorAutorizacion: null,
              protocolo: null,
              alpnProtocol: null,
              certificado: {
                validoDesdeUtc: null,
                validoHastaUtc: null,
                diasRestantes: null,
                vigenciaMinimaCertDias: Math.max(
                  0,
                  Number.isNaN(vigenciaMinimaCertDias) ? 0 : vigenciaMinimaCertDias
                ),
                subjectCommonName: null,
                issuerCommonName: null
              }
            }
          : null
      };

      const cerrar = ({
        exito,
        codigoResultado,
        mensajeResultado,
        detalleError = null
      }) => {
        if (finalizado) {
          return;
        }

        finalizado = true;
        socket.removeAllListeners();
        socket.destroy();
        const finUtc = new Date().toISOString();

        resolve({
          numeroIntento,
          inicioUtc,
          finUtc,
          duracionMs: calcularDuracionMs(inicioUtc, finUtc),
          exito,
          codigoResultado,
          mensajeResultado,
          detalleError,
          detalle
        });
      };

      const opcionesBase = {
        host: String(monitor.configuracion.host),
        port: Number.parseInt(String(monitor.configuracion.puerto), 10)
      };

      const socket = usarTls
        ? tls.connect({
            ...opcionesBase,
            servername: opcionesBase.host
          })
        : net.createConnection(opcionesBase);

      socket.setTimeout(timeoutMs);

      socket.on(usarTls ? 'secureConnect' : 'connect', () => {
        detalle.remoteAddress = socket.remoteAddress || null;
        detalle.remotePort = socket.remotePort || null;

        if (usarTls && detalle.tls) {
          const certificadoPeer = typeof socket.getPeerCertificate === 'function'
            ? socket.getPeerCertificate()
            : null;

          detalle.tls.autorizado = socket.authorized;
          detalle.tls.errorAutorizacion = socket.authorizationError || null;
          detalle.tls.protocolo = typeof socket.getProtocol === 'function'
            ? socket.getProtocol()
            : null;
          detalle.tls.alpnProtocol = socket.alpnProtocol || null;
          detalle.tls.certificado = {
            ...detalle.tls.certificado,
            validoDesdeUtc: parsearFechaCertificadoUtc(certificadoPeer?.valid_from),
            validoHastaUtc: parsearFechaCertificadoUtc(certificadoPeer?.valid_to),
            subjectCommonName: certificadoPeer?.subject?.CN || null,
            issuerCommonName: certificadoPeer?.issuer?.CN || null
          };

          if (detalle.tls.certificado.validoHastaUtc) {
            const msRestantes = calcularMsRestantesHasta(
              detalle.tls.certificado.validoHastaUtc,
              inicioUtc
            );
            detalle.tls.certificado.diasRestantes = calcularDiasRestantes(msRestantes);
          }

          if (!socket.authorized) {
            cerrar({
              exito: false,
              codigoResultado: 'tls_no_autorizado',
              mensajeResultado:
                'La conexión TLS se estableció, pero el certificado no es confiable.',
              detalleError: crearErrorNormalizado({
                codigo: socket.authorizationError || 'TLS_UNAUTHORIZED',
                mensaje:
                  'El endpoint respondió por TLS, pero no superó la validación de confianza.',
                extra: {
                  protocolo: detalle.tls.protocolo,
                  alpnProtocol: detalle.tls.alpnProtocol
                }
              })
            });
            return;
          }

          if (detalle.tls.certificado.vigenciaMinimaCertDias > 0) {
            if (!detalle.tls.certificado.validoHastaUtc) {
              cerrar({
                exito: false,
                codigoResultado: 'tls_vigencia_indeterminada',
                mensajeResultado:
                  'No se pudo determinar la fecha de expiración del certificado TLS.',
                detalleError: crearErrorNormalizado({
                  codigo: 'TLS_CERT_EXPIRY_UNKNOWN',
                  mensaje:
                    'El endpoint respondió con TLS válido, pero no se pudo calcular su vigencia restante.'
                })
              });
              return;
            }

            const msRestantes = calcularMsRestantesHasta(
              detalle.tls.certificado.validoHastaUtc,
              inicioUtc
            );

            if (
              msRestantes == null
            ) {
              cerrar({
                exito: false,
                codigoResultado: 'tls_vigencia_indeterminada',
                mensajeResultado:
                  'No se pudo calcular la vigencia restante del certificado TLS.',
                detalleError: crearErrorNormalizado({
                  codigo: 'TLS_CERT_EXPIRY_PARSE_ERROR',
                  mensaje:
                    'El certificado TLS expone fecha de expiración, pero no pudo normalizarse correctamente.',
                  extra: {
                    validoHastaUtc: detalle.tls.certificado.validoHastaUtc
                  }
                })
              });
              return;
            }

            if (
              msRestantes < (
                detalle.tls.certificado.vigenciaMinimaCertDias * 86400000
              )
            ) {
              cerrar({
                exito: false,
                codigoResultado: 'tls_vigencia_insuficiente',
                mensajeResultado:
                  `El certificado TLS expira antes del margen mínimo exigido (${detalle.tls.certificado.vigenciaMinimaCertDias} días).`,
                detalleError: crearErrorNormalizado({
                  codigo: 'TLS_CERT_MIN_VALIDITY',
                  mensaje:
                    'El certificado TLS es confiable, pero su vigencia restante es insuficiente.',
                  extra: {
                    validoHastaUtc: detalle.tls.certificado.validoHastaUtc,
                    diasRestantes: detalle.tls.certificado.diasRestantes,
                    vigenciaMinimaCertDias:
                      detalle.tls.certificado.vigenciaMinimaCertDias
                  }
                })
              });
              return;
            }
          }
        }

        cerrar({
          exito: true,
          codigoResultado: usarTls ? 'conexion_tls_ok' : 'conexion_tcp_ok',
          mensajeResultado: usarTls
            ? 'Conexión TLS válida y confiable.'
            : 'Conexión TCP establecida.'
        });
      });

      socket.on('timeout', () => {
        cerrar({
          exito: false,
          codigoResultado: usarTls ? 'timeout_tls' : 'timeout_tcp',
          mensajeResultado: usarTls
            ? 'Timeout durante la conexión TLS.'
            : 'Timeout durante la conexión TCP.',
          detalleError: crearErrorNormalizado({
            codigo: 'TIMEOUT',
            mensaje: 'El socket agotó el tiempo máximo configurado.'
          })
        });
      });

      socket.on('error', (error) => {
        const errorValidacionTls = usarTls && esErrorValidacionTls(error);

        cerrar({
          exito: false,
          codigoResultado: usarTls
            ? (errorValidacionTls ? 'tls_no_autorizado' : 'fallo_tls')
            : 'fallo_tcp',
          mensajeResultado: usarTls
            ? (
                errorValidacionTls
                  ? 'La conexión TLS fue rechazada por confianza del certificado.'
                  : 'No se pudo establecer la conexión TLS.'
              )
            : 'No se pudo establecer la conexión TCP.',
          detalleError: crearErrorNormalizado({
            codigo: error?.code || 'ERROR',
            mensaje: error?.message || 'Fallo de conexión TCP/TLS.'
          })
        });
      });
    });
  }
}
