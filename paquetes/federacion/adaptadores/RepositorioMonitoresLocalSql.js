import { bytesAUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { FuenteEntropiaCriptograficaNode } from './FuenteEntropiaCriptograficaNode.js';
import { asegurarIdentidadesScopeOrganizativoFederacion }
  from './RepositorioEstructuraOrganizativaLocalSql.js';
import { asegurarIdentidadElementoTelemetriaFederacion }
  from './RepositorioTelemetriaLocalSql.js';
import { crearCampoPresenteFederado } from '../src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';
import {
  PERFIL_PAYLOAD_MONITORES_FEDERACION,
  VERSION_PAYLOAD_MONITORES_FEDERACION,
  validarPayloadMonitoresFederacion
} from '../src/PayloadMonitoresFederacion.js';

const TIPOS_RETIRABLES = Object.freeze([
  'referenciaTrigger', 'alerta', 'tramoHistorico', 'evento', 'estadoActual', 'definicion'
]);
const CLAVE_SENSIBLE = /password|passwd|contrasena|secret|secreto|token|api[_-]?key|credential|credencial/iu;

export class ErrorMonitoresLocalFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorMonitoresLocalFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioMonitoresLocalSql {
  constructor(clienteSql, {
    installationLocalId,
    resolverVigenciaEstado,
    generadorIdentidades = new GeneradorIdentidadesFederadas({
      fuenteEntropia: new FuenteEntropiaCriptograficaNode()
    }),
    ahora = () => new Date()
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('Los monitores locales federables requieren SQL operativo.');
    }
    if (typeof resolverVigenciaEstado !== 'function') {
      throw new Error('Los monitores federables requieren una politica explicita de vigencia.');
    }
    this.clienteSql = clienteSql;
    this.installationLocal = identidad(
      installationLocalId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationLocalId'
    );
    this.resolverVigenciaEstado = resolverVigenciaEstado;
    this.generadorIdentidades = generadorIdentidades;
    this.ahora = ahora;
  }

  async prepararCapturaEnTransaccion({
    monitorId,
    incluirCredencialPropia = false,
    puedeFederarCredencialPropia = false
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const monitor = await cargarMonitor(conexion, idPositivo(monitorId, 'monitorId'));
    if (!monitor) fallar('monitor_federable_inexistente', 'No existe el monitor local indicado.');
    return this.#crearCapturaDefinicion(conexion, monitor, 'operativaActual', {
      incluirCredencialPropia,
      puedeFederarCredencialPropia
    });
  }

  async prepararCapturasAdministracionEnTransaccion({
    monitorIds = [],
    incluirCredencialPropia = false,
    puedeFederarCredencialPropia = false
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const capturas = [];
    for (const monitorId of idsUnicos(monitorIds, 'monitorIds')) {
      capturas.push(await this.prepararCapturaEnTransaccion({
        monitorId, incluirCredencialPropia, puedeFederarCredencialPropia
      }, { conexion }));
    }
    return Object.freeze(capturas);
  }

  async prepararCapturasRuntimeEnTransaccion({
    estadoMonitorIds = [],
    eventoIds = [],
    historicoMonitorIds = [],
    alertaMonitorIds = [],
    cierresAlerta = []
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const capturas = [];
    for (const monitorId of idsUnicos(estadoMonitorIds, 'estadoMonitorIds')) {
      const monitor = await cargarMonitor(conexion, monitorId);
      if (!monitor) continue;
      const fila = await cargarUnoPorMonitor(conexion, 'estado_actual_monitores', monitorId);
      if (fila) capturas.push(await this.#crearCapturaRegistro(
        conexion, 'estadoActual', fila, monitor, 'operativaActual'
      ));
    }
    for (const eventoId of idsUnicos(eventoIds, 'eventoIds')) {
      const fila = await cargarPorId(conexion, 'eventos_monitores', eventoId);
      if (!fila) continue;
      const monitor = await exigirMonitor(conexion, fila.monitor_id);
      capturas.push(await this.#crearCapturaRegistro(
        conexion, 'evento', fila, monitor, 'reconstruccion'
      ));
    }
    for (const monitorId of idsUnicos(historicoMonitorIds, 'historicoMonitorIds')) {
      const monitor = await cargarMonitor(conexion, monitorId);
      if (!monitor) continue;
      const fila = await cargarUltimoPorMonitor(conexion, 'historico_monitores', monitorId);
      if (fila) capturas.push(await this.#crearCapturaRegistro(
        conexion, 'tramoHistorico', fila, monitor, 'reconstruccion'
      ));
    }
    for (const monitorId of idsUnicos(alertaMonitorIds, 'alertaMonitorIds')) {
      const monitor = await cargarMonitor(conexion, monitorId);
      if (!monitor) continue;
      const fila = await cargarUnoPorMonitor(conexion, 'alertas_activas_monitores', monitorId);
      if (fila) capturas.push(await this.#crearCapturaRegistro(
        conexion, 'alerta', fila, monitor, 'operativaActual'
      ));
    }
    for (const cierre of cierresAlerta) {
      capturas.push(await this.#crearCapturaCierreAlerta(conexion, cierre));
    }
    return Object.freeze(capturas);
  }

  async listarCapturasEnTransaccion({
    flujoId,
    generacionId,
    incluirCredencialPropia = false,
    puedeFederarCredencialPropia = false
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const flujo = await cargarFlujo(conexion, flujoId, generacionId);
    const monitores = await listarMonitoresScope(conexion, flujo);
    const capturas = [];
    for (const monitor of monitores) {
      capturas.push(await this.#crearCapturaDefinicion(conexion, monitor, 'reconstruccion', {
        incluirCredencialPropia, puedeFederarCredencialPropia
      }));
      const estado = await cargarUnoPorMonitor(conexion, 'estado_actual_monitores', monitor.id);
      if (estado) capturas.push(await this.#crearCapturaRegistro(conexion, 'estadoActual', estado, monitor, 'operativaActual'));
      const alerta = await cargarUnoPorMonitor(conexion, 'alertas_activas_monitores', monitor.id);
      if (alerta) capturas.push(await this.#crearCapturaRegistro(conexion, 'alerta', alerta, monitor, 'operativaActual'));
      for (const evento of await listarPorMonitor(conexion, 'eventos_monitores', monitor.id)) {
        capturas.push(await this.#crearCapturaRegistro(conexion, 'evento', evento, monitor, 'reconstruccion'));
      }
      for (const tramo of await listarPorMonitor(conexion, 'historico_monitores', monitor.id)) {
        capturas.push(await this.#crearCapturaRegistro(conexion, 'tramoHistorico', tramo, monitor, 'reconstruccion'));
      }
      for (const referencia of await listarPorMonitor(conexion, 'asignaciones_triggers_monitores', monitor.id)) {
        capturas.push(await this.#crearCapturaRegistro(conexion, 'referenciaTrigger', referencia, monitor, 'reconstruccion'));
      }
    }
    return Object.freeze(capturas);
  }

  async prepararRetiradaEnTransaccion({ monitorId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const id = idPositivo(monitorId, 'monitorId');
    const monitor = await cargarMonitor(conexion, id);
    if (!monitor) fallar('monitor_retirada_inexistente', 'El monitor debe existir mientras se prepara su retirada.');
    const instante = fechaIso(this.ahora());
    const claves = await clavesAgregado(conexion, monitor);
    const retiradas = [];
    for (const tipo of TIPOS_RETIRABLES) {
      for (const entrada of claves.get(tipo) || []) {
        const { clave, scope } = entrada;
        const elementoOrigenId = await asegurarIdentidadMonitor({
          conexion, tipo, clave, monitor, generador: this.generadorIdentidades,
          instante, scope
        });
        await conexion.execute(
          `UPDATE identidades_elementos_monitores_federacion
              SET estado='retirado',retirada_en_utc=?,actualizada_en_utc=?,
                  version_registro=version_registro+1
            WHERE tipo_elemento=? AND clave_local=?`,
          [fechaSql(instante), fechaSql(instante), tipo, clave]
        );
        retiradas.push(Object.freeze({
          tipoRegistro: tipo,
          idLocal: clave,
          monitorId: String(monitor.id),
          elementoOrigenId,
          prioridad: 'operativaActual',
          definicion: this.#definicion({
            monitor: scope, elementoOrigenId, instante, operacion: 'retirada', campos: {}
          })
        }));
      }
    }
    return Object.freeze(retiradas);
  }

  async prepararRetiradaPublicadaEnTransaccion({ monitorId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const id = idPositivo(monitorId, 'monitorId');
    const monitor = await cargarMonitor(conexion, id);
    if (!monitor) {
      fallar(
        'monitor_retirada_inexistente',
        'El monitor debe existir mientras se prepara su retirada.'
      );
    }
    const [identidades] = await conexion.execute(
      `SELECT tipo_elemento,clave_local,elemento_origen_id,
              scope_tenant_id,scope_empresa_id,scope_sitio_id
         FROM identidades_elementos_monitores_federacion
        WHERE monitor_id_local=? AND estado='vigente'
        ORDER BY tipo_elemento,clave_local FOR UPDATE`,
      [id]
    );
    if (identidades.length === 0) return Object.freeze([]);
    const instante = fechaIso(this.ahora());
    const retiradas = identidades.map((identidadLocal) => Object.freeze({
      tipoRegistro: identidadLocal.tipo_elemento,
      idLocal: String(identidadLocal.clave_local),
      monitorId: String(monitor.id),
      elementoOrigenId: identidadLocal.elemento_origen_id,
      prioridad: 'operativaActual',
      definicion: this.#definicion({
        monitor: {
          ...monitor,
          tenant_id: identidadLocal.scope_tenant_id,
          empresa_id: identidadLocal.scope_empresa_id,
          sitio_id: identidadLocal.scope_sitio_id
        },
        elementoOrigenId: identidadLocal.elemento_origen_id,
        instante,
        operacion: 'retirada',
        campos: {}
      })
    }));
    await conexion.execute(
      `UPDATE identidades_elementos_monitores_federacion
          SET estado='retirado',retirada_en_utc=?,actualizada_en_utc=?,
              version_registro=version_registro+1
        WHERE monitor_id_local=? AND estado='vigente'`,
      [fechaSql(instante), fechaSql(instante), id]
    );
    return Object.freeze(retiradas);
  }

  async #crearCapturaDefinicion(conexion, monitor, prioridad, seleccionSensible) {
    const instante = fechaIso(this.ahora());
    const elementoOrigenId = await asegurarIdentidadMonitor({
      conexion, tipo: 'definicion', clave: String(monitor.id), monitor,
      generador: this.generadorIdentidades, instante
    });
    const payload = await payloadDefinicion({
      conexion, monitor, generador: this.generadorIdentidades, instante,
      ...seleccionSensible
    });
    return this.#captura({ monitor, tipo: 'definicion', clave: String(monitor.id),
      elementoOrigenId, payload, prioridad, instante });
  }

  async #crearCapturaRegistro(conexion, tipo, fila, monitor, prioridad) {
    const instante = fechaIso(this.ahora());
    const clave = claveRegistro(tipo, fila);
    const elementoOrigenId = await asegurarIdentidadMonitor({
      conexion, tipo, clave, monitor, generador: this.generadorIdentidades, instante,
      scope: scopeFila(fila, monitor)
    });
    const monitorOrigenId = await identidadDependenciaMonitor(
      conexion, monitor.id, monitor, this.generadorIdentidades, instante
    );
    const vigenteHastaOrigenUtc = ['estadoActual', 'alerta'].includes(tipo)
      ? await resolverVigencia(this.resolverVigenciaEstado, { tipo, fila, monitor })
      : null;
    const payload = await construirPayloadRegistro({
      conexion, tipo, fila, monitor, monitorOrigenId,
      generador: this.generadorIdentidades, instante,
      vigenteHastaOrigenUtc
    });
    return this.#captura({ monitor, tipo, clave, elementoOrigenId, payload, prioridad,
      instante, scope: scopeFila(fila, monitor) });
  }

  async #crearCapturaCierreAlerta(conexion, cierre) {
    if (!cierre?.alertaAuditoriaId) {
      fallar('cierre_alerta_federable_invalido', 'El cierre exige identidad auditable de alerta.');
    }
    const monitor = await exigirMonitor(conexion, idPositivo(cierre.monitorId, 'monitorId'));
    const instante = fechaIso(this.ahora());
    const clave = String(cierre.alertaAuditoriaId).toLowerCase();
    const elementoOrigenId = await asegurarIdentidadMonitor({
      conexion, tipo: 'alerta', clave, monitor, generador: this.generadorIdentidades,
      instante, scope: monitor
    });
    const monitorOrigenId = await identidadDependenciaMonitor(
      conexion, monitor.id, monitor, this.generadorIdentidades, instante
    );
    const cerradaEnUtc = fechaIso(cierre.fechaOcurrenciaUtc);
    const vigenteHastaOrigenUtc = await resolverVigencia(
      this.resolverVigenciaEstado,
      { tipo: 'alerta', fila: cierre, monitor, estadoAlerta: 'cerrada' }
    );
    const payload = validarPayloadMonitoresFederacion({
      perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
      version: VERSION_PAYLOAD_MONITORES_FEDERACION,
      tipoRegistro: 'alerta',
      monitorOrigenId,
      alertaAuditoriaId: clave,
      versionCatalogo: cierre.versionCatalogo,
      tipoMonitor: cierre.tipoMonitor,
      estadoAlerta: 'cerrada',
      estadoDetectado: cierre.estadoDetectado,
      codigoUltimoResultado: cierre.codigoResultado,
      mensajeUltimoResultado: cierre.mensajeResultado,
      validoDesdeUtc: fechaIso(cierre.validoDesdeUtc),
      ultimaConfirmacionUtc: fechaIso(
        cierre.ultimaConfirmacionUtc || cierre.fechaOcurrenciaUtc
      ),
      ultimaEjecucionUtc: fechaIso(
        cierre.ultimaEjecucionUtc || cierre.fechaOcurrenciaUtc
      ),
      cerradaEnUtc,
      vigenteHastaOrigenUtc,
      contadorRepeticiones: Number(cierre.contadorRepeticiones || 1),
      payloadAlerta: cierre.payloadAlerta || null,
      descarteOrigen: normalizarDescarteTransicion(cierre.descarteOperativo),
      contextoHumano: contextoHistorico(cierre.payloadAlerta)
    });
    return this.#captura({
      monitor, tipo: 'alerta', clave, elementoOrigenId, payload,
      prioridad: 'operativaActual', instante
    });
  }

  #captura({ monitor, tipo, clave, elementoOrigenId, payload, prioridad, instante, scope = monitor }) {
    return Object.freeze({
      tipoRegistro: tipo,
      idLocal: clave,
      monitorId: String(monitor.id),
      elementoOrigenId,
      payload,
      prioridad,
      definicion: this.#definicion({
        monitor: scope, elementoOrigenId, instante, operacion: 'actualizacion',
        campos: {
          monitores: crearCampoPresenteFederado({
            valor: payload,
            sensibilidad: payload?.tipoRegistro === 'definicion' &&
              payload?.credencialPropia?.estado === 'presente'
              ? 'sensible'
              : 'ordinario'
          })
        }
      })
    });
  }

  #definicion({ monitor, elementoOrigenId, instante, operacion, campos }) {
    return Object.freeze({
      familia: 'monitores',
      familiaVersion: VERSION_PAYLOAD_MONITORES_FEDERACION,
      installationOrigenId: this.installationLocal,
      elementoOrigenId,
      ocurrenciaOrigenId: this.generadorIdentidades.generar(
        TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
      ),
      operacion,
      tiempoOrigenUtc: instante,
      scopeOrigenDeclarado: scopeDeclarado(monitor),
      vigenciaRestanteMs: null,
      campos,
      evidenciaIntegridad: []
    });
  }
}

async function payloadDefinicion({
  conexion, monitor, generador, instante,
  incluirCredencialPropia, puedeFederarCredencialPropia
}) {
  const configuracion = jsonOpcional(monitor.configuracion) || {};
  const { publico, sensible, tieneSensible } = separarSensible(configuracion);
  if (incluirCredencialPropia && !puedeFederarCredencialPropia) {
    fallar('credencial_monitor_no_autorizada', 'La selección sensible exige permiso actual suficiente.');
  }
  const credencialPropia = !tieneSensible
    ? { estado: 'omitida', causa: 'noExiste' }
    : !incluirCredencialPropia
      ? { estado: 'omitida', causa: 'noSeleccionada' }
      : { estado: 'presente', formato: 'rutas-json-extraidas-v1', contenido: sensible };
  const referenciasOperativas = await referenciasOperativasMonitor({
    conexion, monitor, configuracion, generador, instante
  });
  return validarPayloadMonitoresFederacion({
    perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
    version: VERSION_PAYLOAD_MONITORES_FEDERACION,
    tipoRegistro: 'definicion',
    nombre: monitor.nombre,
    tipo: monitor.tipo,
    descripcion: monitor.descripcion,
    activo: Boolean(monitor.activo),
    intervaloEjecucionSegundos: Number(monitor.intervalo_ejecucion_segundos),
    desfaseInicialSegundos: Number(monitor.desfase_inicial_segundos),
    interpretacionEstado: monitor.interpretacion_estado,
    configuracionOperativa: limpiarIdentidadesLocales(publico),
    contextoHumano: contextoMonitor(monitor),
    scopeOrganizativo: await asegurarIdentidadesScopeOrganizativoFederacion({
      conexion,
      tenantId: monitor.tenant_id,
      empresaId: monitor.empresa_id,
      sitioId: monitor.sitio_id,
      generadorIdentidades: generador,
      instante
    }),
    credencialPropia,
    referenciasOperativas
  });
}

async function construirPayloadRegistro({
  conexion, tipo, fila, monitor, monitorOrigenId, generador, instante,
  vigenteHastaOrigenUtc
}) {
  let contenido;
  if (tipo === 'estadoActual') {
    contenido = {
      monitorOrigenId, versionCatalogo: fila.version_catalogo, estado: fila.estado,
      ejecutadoTodavia: Boolean(fila.ejecutado_todavia),
      fechaUltimaEjecucionUtc: fechaIsoOpcional(fila.fecha_ultima_ejecucion_utc),
      fechaUltimoCambioUtc: fechaIsoOpcional(fila.fecha_ultimo_cambio_utc),
      motivoInicial: fila.motivo_inicial,
      resultadoActual: jsonOpcional(fila.resultado_actual),
      contextoHumano: contextoMonitor(monitor), vigenteHastaOrigenUtc
    };
  } else if (tipo === 'evento') {
    contenido = {
      monitorOrigenId, versionCatalogo: fila.version_catalogo, tipoMonitor: fila.tipo_monitor,
      estadoDetectado: fila.estado_detectado, codigoResultado: fila.codigo_resultado,
      mensajeResultado: fila.mensaje_resultado, exito: Boolean(fila.exito),
      duracionTotalMs: Number(fila.duracion_total_ms), ejecutadoEnUtc: fechaIso(fila.ejecutado_en_utc),
      payloadEvento: jsonOpcional(fila.payload_evento), contextoHumano: contextoHistorico(fila.payload_evento)
    };
  } else if (tipo === 'tramoHistorico') {
    contenido = {
      monitorOrigenId, versionCatalogo: fila.version_catalogo, tipoMonitor: fila.tipo_monitor,
      estadoTramo: fila.estado_tramo, codigoUltimoResultado: fila.codigo_ultimo_resultado,
      mensajeUltimoResultado: fila.mensaje_ultimo_resultado,
      validoDesdeUtc: fechaIso(fila.valido_desde_utc), validoHastaUtc: fechaIso(fila.valido_hasta_utc),
      contadorRepeticiones: Number(fila.contador_repeticiones),
      ultimoEventoOrigenId: fila.ultimo_evento_id === null ? null : await identidadDependenciaRegistro({
        conexion, tipo: 'evento', clave: String(fila.ultimo_evento_id), monitor,
        generador, instante, scope: scopeFila(fila, monitor)
      }),
      payloadTramo: jsonOpcional(fila.payload_tramo), contextoHumano: contextoHistorico(fila.payload_tramo)
    };
  } else if (tipo === 'alerta') {
    contenido = {
      monitorOrigenId, alertaAuditoriaId: bytesAUuidV7Auditoria(fila.alerta_auditoria_id),
      versionCatalogo: fila.version_catalogo, tipoMonitor: fila.tipo_monitor,
      estadoAlerta: fila.estado_alerta, estadoDetectado: fila.estado_detectado,
      codigoUltimoResultado: fila.codigo_ultimo_resultado,
      mensajeUltimoResultado: fila.mensaje_ultimo_resultado,
      validoDesdeUtc: fechaIso(fila.valido_desde_utc),
      ultimaConfirmacionUtc: fechaIso(fila.ultima_confirmacion_utc),
      ultimaEjecucionUtc: fechaIso(fila.ultima_ejecucion_utc), cerradaEnUtc: null,
      vigenteHastaOrigenUtc, contadorRepeticiones: Number(fila.contador_repeticiones),
      payloadAlerta: jsonOpcional(fila.payload_alerta),
      descarteOrigen: descarteOrigen(fila), contextoHumano: contextoHistorico(fila.payload_alerta)
    };
  } else {
    contenido = {
      monitorOrigenId,
      triggerOrigenId: await asegurarIdentidadTrigger({ conexion, fila, monitor, generador, instante }),
      visibilidad: 'opaca', activo: Boolean(fila.activo),
      ordenEjecucion: Number(fila.orden_ejecucion),
      eventosDisparo: jsonOpcional(fila.eventos_disparo) || [],
      configuracionOverride: jsonOpcional(fila.configuracion_override)
    };
  }
  return validarPayloadMonitoresFederacion({
    perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
    version: VERSION_PAYLOAD_MONITORES_FEDERACION,
    tipoRegistro: tipo,
    ...contenido
  });
}

async function referenciasOperativasMonitor({ conexion, monitor, configuracion, generador, instante }) {
  const referencias = [];
  for (const dependencia of Array.isArray(configuracion.dependencias) ? configuracion.dependencias : []) {
    if (dependencia?.fuente !== 'monitor' || !dependencia.monitorId) continue;
    const dependiente = await cargarMonitor(conexion, dependencia.monitorId);
    if (!dependiente) fallar('dependencia_monitor_federable_ausente', 'El monitor perdió una dependencia lógica.');
    referencias.push({
      familia: 'monitores',
      elementoOrigenId: await identidadDependenciaMonitor(
        conexion, dependiente.id, dependiente, generador, instante
      ),
      rol: 'entradaLogica', visibilidad: 'opaca',
      metadatos: { variable: dependencia.variable, etiqueta: dependencia.etiqueta ?? null }
    });
  }
  const [vinculos] = await conexion.execute(
    'SELECT * FROM vinculos_monitores_telemetria WHERE monitor_id=? LIMIT 1 FOR UPDATE',
    [String(monitor.id)]
  );
  if (vinculos[0]) {
    const vinculo = vinculos[0];
    const elementoOrigenId = vinculo.tipo_fuente === 'senal_federada'
      ? await cargarIdentidadTelemetriaFederada(conexion, vinculo.proyeccion_federada_id)
      : await asegurarIdentidadTelemetriaLocal({
          conexion,
          vinculo,
          generador,
          instante
        });
    referencias.push({
      familia: 'telemetria', elementoOrigenId, rol: 'entradaTelemetria', visibilidad: 'opaca',
      metadatos: { tipoFuente: vinculo.tipo_fuente }
    });
  }
  return referencias;
}

async function cargarFlujo(conexion, flujoId, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT f.scope_nivel,f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id
       FROM flujos_federacion f JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
      WHERE f.flujo_id=? AND f.direccion='emision' AND f.familia='monitores'
        AND g.estado NOT IN ('cancelada','sustituida') LIMIT 1 FOR UPDATE`,
    [generacionId, flujoId]
  );
  if (!filas[0]) fallar('flujo_fotografia_monitores_invalido', 'La fotografía exige una generación emisora vigente.');
  return filas[0];
}

async function listarMonitoresScope(conexion, flujo) {
  const filtros = {
    portal: ['', []],
    tenant: ['WHERE tenant_id=?', [flujo.scope_tenant_id]],
    empresa: ['WHERE tenant_id=? AND empresa_id=?', [flujo.scope_tenant_id, flujo.scope_empresa_id]],
    sitio: ['WHERE tenant_id=? AND empresa_id=? AND sitio_id=?', [
      flujo.scope_tenant_id, flujo.scope_empresa_id, flujo.scope_sitio_id
    ]]
  };
  const [where, parametros] = filtros[flujo.scope_nivel];
  const [filas] = await conexion.execute(`SELECT * FROM monitores ${where} ORDER BY id FOR UPDATE`, parametros);
  return filas;
}

async function cargarMonitor(conexion, id) {
  const [filas] = await conexion.execute('SELECT * FROM monitores WHERE id=? LIMIT 1 FOR UPDATE', [String(id)]);
  return filas[0] || null;
}

async function exigirMonitor(conexion, id) {
  const monitor = await cargarMonitor(conexion, id);
  if (!monitor) fallar('monitor_runtime_federable_ausente', 'El resultado runtime perdió su monitor local.');
  return monitor;
}

async function cargarPorId(conexion, tabla, id) {
  if (tabla !== 'eventos_monitores') fallar('tabla_monitor_invalida', 'La tabla no admite captura por id.');
  const [filas] = await conexion.execute(`SELECT * FROM ${tabla} WHERE id=? LIMIT 1 FOR UPDATE`, [String(id)]);
  return filas[0] || null;
}

async function cargarUltimoPorMonitor(conexion, tabla, monitorId) {
  if (tabla !== 'historico_monitores') fallar('tabla_monitor_invalida', 'La tabla no admite captura de último tramo.');
  const [filas] = await conexion.execute(
    `SELECT * FROM ${tabla} WHERE monitor_id=? ORDER BY valido_hasta_utc DESC,id DESC LIMIT 1 FOR UPDATE`,
    [String(monitorId)]
  );
  return filas[0] || null;
}

async function cargarUnoPorMonitor(conexion, tabla, monitorId) {
  const permitidas = new Set(['estado_actual_monitores', 'alertas_activas_monitores']);
  if (!permitidas.has(tabla)) fallar('tabla_monitor_invalida', 'La tabla no pertenece al agregado capturable.');
  const [filas] = await conexion.execute(`SELECT * FROM ${tabla} WHERE monitor_id=? LIMIT 1 FOR UPDATE`, [String(monitorId)]);
  return filas[0] || null;
}

async function listarPorMonitor(conexion, tabla, monitorId) {
  const permitidas = new Set(['eventos_monitores', 'historico_monitores', 'asignaciones_triggers_monitores']);
  if (!permitidas.has(tabla)) fallar('tabla_monitor_invalida', 'La tabla no pertenece al agregado capturable.');
  const [filas] = await conexion.execute(`SELECT * FROM ${tabla} WHERE monitor_id=? ORDER BY id FOR UPDATE`, [String(monitorId)]);
  return filas;
}

async function clavesAgregado(conexion, monitor) {
  const resultado = new Map([['definicion', [{ clave: String(monitor.id), scope: monitor }]]]);
  const estado = await cargarUnoPorMonitor(conexion, 'estado_actual_monitores', monitor.id);
  resultado.set('estadoActual', estado ? [{ clave: String(monitor.id), scope: monitor }] : []);
  const alerta = await cargarUnoPorMonitor(conexion, 'alertas_activas_monitores', monitor.id);
  resultado.set('alerta', alerta ? [{
    clave: bytesAUuidV7Auditoria(alerta.alerta_auditoria_id),
    scope: scopeFila(alerta, monitor)
  }] : []);
  for (const [tipo, tabla] of [
    ['evento', 'eventos_monitores'], ['tramoHistorico', 'historico_monitores'],
    ['referenciaTrigger', 'asignaciones_triggers_monitores']
  ]) {
    resultado.set(tipo, (await listarPorMonitor(conexion, tabla, monitor.id)).map((fila) => ({
      clave: String(fila.id), scope: scopeFila(fila, monitor)
    })));
  }
  return resultado;
}

async function asegurarIdentidadMonitor({ conexion, tipo, clave, monitor, generador, instante, scope = monitor }) {
  const [filas] = await conexion.execute(
    `SELECT elemento_origen_id,estado,scope_tenant_id,scope_empresa_id,scope_sitio_id
       FROM identidades_elementos_monitores_federacion
      WHERE tipo_elemento=? AND clave_local=? FOR UPDATE`, [tipo, String(clave)]
  );
  if (filas[0]) {
    if (filas[0].estado !== 'vigente') fallar('identidad_monitor_retirada', 'Una identidad retirada no puede resucitar.');
    if (!scopeIgual(filas[0], scope)) {
      await conexion.execute(
        `UPDATE identidades_elementos_monitores_federacion SET
           scope_tenant_id=?,scope_empresa_id=?,scope_sitio_id=?,actualizada_en_utc=?,
           version_registro=version_registro+1 WHERE tipo_elemento=? AND clave_local=?`,
        [scope.tenant_id, scope.empresa_id, scope.sitio_id, fechaSql(instante), tipo, String(clave)]
      );
    }
    return filas[0].elemento_origen_id;
  }
  const elementoOrigenId = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN));
  await conexion.execute(
    `INSERT INTO identidades_elementos_monitores_federacion (
       tipo_elemento,clave_local,monitor_id_local,elemento_origen_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,?,?,'vigente',?,?,NULL,1)`,
    [tipo, String(clave), monitor.id, elementoOrigenId, scope.tenant_id,
      scope.empresa_id, scope.sitio_id, fechaSql(instante), fechaSql(instante)]
  );
  return elementoOrigenId;
}

function identidadDependenciaMonitor(conexion, id, monitor, generador, instante) {
  return asegurarIdentidadMonitor({ conexion, tipo: 'definicion', clave: String(id), monitor, generador, instante });
}

function identidadDependenciaRegistro({ conexion, tipo, clave, monitor, generador, instante, scope }) {
  return asegurarIdentidadMonitor({ conexion, tipo, clave, monitor, generador, instante, scope });
}

async function asegurarIdentidadTrigger({ conexion, fila, monitor, generador, instante }) {
  const [existentes] = await conexion.execute(
    'SELECT elemento_origen_id,estado FROM identidades_triggers_referenciados_federacion WHERE trigger_id_local=? FOR UPDATE',
    [String(fila.trigger_id)]
  );
  if (existentes[0]) {
    if (existentes[0].estado !== 'vigente') fallar('identidad_trigger_retirada', 'Una identidad de trigger retirada no puede resucitar.');
    await conexion.execute(
      `UPDATE identidades_triggers_referenciados_federacion SET
         scope_tenant_id=?,scope_empresa_id=?,scope_sitio_id=?,actualizada_en_utc=?,
         version_registro=version_registro+1 WHERE trigger_id_local=?`,
      [monitor.tenant_id, monitor.empresa_id, monitor.sitio_id, fechaSql(instante), fila.trigger_id]
    );
    return existentes[0].elemento_origen_id;
  }
  const elementoOrigenId = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN));
  await conexion.execute(
    `INSERT INTO identidades_triggers_referenciados_federacion (
       trigger_id_local,elemento_origen_id,scope_tenant_id,scope_empresa_id,scope_sitio_id,
       estado,creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,'vigente',?,?,NULL,1)`,
    [fila.trigger_id, elementoOrigenId, monitor.tenant_id, monitor.empresa_id,
      monitor.sitio_id, fechaSql(instante), fechaSql(instante)]
  );
  return elementoOrigenId;
}

async function asegurarIdentidadTelemetriaLocal({
  conexion,
  vinculo,
  generador,
  instante
}) {
  const tipo = vinculo.tipo_fuente === 'senal_directa'
    ? 'senal'
    : 'reglaDerivacion';
  const id = vinculo.tipo_fuente === 'senal_directa'
    ? vinculo.senal_id
    : vinculo.regla_id;
  const [agentes] = await conexion.execute(
    'SELECT * FROM agentes_sentinelia WHERE id=? LIMIT 1 FOR UPDATE',
    [String(vinculo.agente_id)]
  );
  if (!agentes[0]) {
    fallar(
      'agente_telemetria_referenciado_ausente',
      'La entrada de telemetría perdió su agente local.'
    );
  }
  return asegurarIdentidadElementoTelemetriaFederacion({
    conexion,
    tipo,
    id,
    agente: agentes[0],
    generador,
    instante
  });
}

async function cargarIdentidadTelemetriaFederada(conexion, proyeccionId) {
  const [filas] = await conexion.execute(
    `SELECT elemento_origen_id FROM proyecciones_federacion
      WHERE proyeccion_id=? AND familia='telemetria' LIMIT 1 FOR UPDATE`,
    [String(proyeccionId)]
  );
  if (!filas[0]) {
    fallar(
      'telemetria_federada_referenciada_ausente',
      'La entrada de telemetría federada perdió su proyección de origen.'
    );
  }
  return filas[0].elemento_origen_id;
}

async function resolverVigencia(resolver, contexto) {
  const valor = await resolver(contexto);
  const texto = valor instanceof Date ? valor.toISOString() : String(valor || '');
  return fechaIso(texto);
}

function separarSensible(valor) {
  const sensible = {};
  const publico = recorrer(valor, '');
  return { publico, sensible, tieneSensible: Object.keys(sensible).length > 0 };

  function recorrer(contenido, ruta) {
    if (Array.isArray(contenido)) {
      return contenido.map((entrada, indice) => recorrer(entrada, `${ruta}/${indice}`));
    }
    if (!objeto(contenido)) return contenido;
    const salida = {};
    for (const [clave, entrada] of Object.entries(contenido)) {
      const rutaEntrada = `${ruta}/${escaparPunteroJson(clave)}`;
      if (CLAVE_SENSIBLE.test(clave)) sensible[rutaEntrada] = entrada;
      else salida[clave] = recorrer(entrada, rutaEntrada);
    }
    return salida;
  }
}

function escaparPunteroJson(valor) {
  return valor.replaceAll('~', '~0').replaceAll('/', '~1');
}

function limpiarIdentidadesLocales(valor) {
  if (Array.isArray(valor)) return valor.map(limpiarIdentidadesLocales);
  if (!objeto(valor)) return valor;
  return Object.fromEntries(Object.entries(valor)
    .filter(([clave]) => !/^(monitor|agente|senal|regla|trigger)(Id|_id)$/iu.test(clave))
    .map(([clave, contenido]) => [clave, limpiarIdentidadesLocales(contenido)]));
}

function contextoMonitor(monitor) {
  return { descripcionFallo: monitor.descripcion_fallo || '', posibleSolucion: monitor.posible_solucion || '' };
}

function contextoHistorico(payload) {
  const valor = jsonOpcional(payload) || {};
  const contexto = valor.contextoHumano || valor.contexto_humano || valor;
  return {
    descripcionFallo: String(contexto.descripcionFallo ?? contexto.descripcion_fallo ?? ''),
    posibleSolucion: String(contexto.posibleSolucion ?? contexto.posible_solucion ?? '')
  };
}

function descarteOrigen(fila) {
  const descartada = Boolean(fila.descartada_dashboard);
  return {
    descartada, motivo: descartada ? String(fila.motivo_descarte || '') : '',
    descartadaEnUtc: descartada ? fechaIso(fila.descartada_en_utc) : null,
    descartadaHastaUtc: descartada ? fechaIsoOpcional(fila.descartada_hasta_utc) : null,
    actorReferencia: { estado: 'omitida' }
  };
}

function normalizarDescarteTransicion(valor) {
  const descartada = Boolean(valor?.descartada);
  return {
    descartada,
    motivo: descartada ? String(valor?.motivo || '') : '',
    descartadaEnUtc: descartada ? fechaIso(valor?.descartadaEnUtc) : null,
    descartadaHastaUtc: descartada
      ? fechaIsoOpcional(valor?.descartadaHastaUtc ?? null)
      : null,
    actorReferencia: { estado: 'omitida' }
  };
}

function claveRegistro(tipo, fila) {
  if (tipo === 'estadoActual') return String(fila.monitor_id);
  if (tipo === 'alerta') return bytesAUuidV7Auditoria(fila.alerta_auditoria_id);
  return String(fila.id);
}

function scopeFila(fila, monitor) {
  return fila.tenant_id === undefined ? monitor : {
    tenant_id: fila.tenant_id, empresa_id: fila.empresa_id, sitio_id: fila.sitio_id
  };
}

function scopeDeclarado(scope) {
  if (scope.sitio_id !== null) return { nivel: 'sitio', tenantId: String(scope.tenant_id), empresaId: String(scope.empresa_id), sitioId: String(scope.sitio_id) };
  return { nivel: 'empresa', tenantId: String(scope.tenant_id), empresaId: String(scope.empresa_id), sitioId: null };
}

function scopeIgual(fila, scope) {
  return String(fila.scope_tenant_id) === String(scope.tenant_id) &&
    String(fila.scope_empresa_id) === String(scope.empresa_id) &&
    String(fila.scope_sitio_id ?? '') === String(scope.sitio_id ?? '');
}

async function exigirTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function') fallar('conexion_monitores_ausente', 'Se requiere conexión compartida.');
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) fallar('transaccion_monitores_ausente', 'Se requiere transacción activa.');
}

function idsUnicos(valores, campo) {
  if (!Array.isArray(valores)) fallar('lista_ids_monitores_invalida', `${campo} debe ser una lista.`);
  return [...new Set(valores.map((valor) => idPositivo(valor, campo)))];
}
function idPositivo(valor, campo) {
  const texto = String(valor || '');
  if (!/^[1-9]\d*$/u.test(texto)) fallar('id_monitor_invalido', `${campo} debe ser positivo.`);
  return texto;
}
function identidad(valor, tipo, campo) {
  try { return String(crearIdentidadFederada({ tipo, valor: String(valor || '') })); }
  catch { fallar('identidad_monitor_local_invalida', `${campo} no es válido.`); }
}
function fechaIso(valor) {
  const texto = String(valor);
  const fecha = valor instanceof Date ? valor : new Date(texto.includes('T') ? texto : `${texto.replace(' ', 'T')}Z`);
  if (Number.isNaN(fecha.getTime())) fallar('fecha_monitor_local_invalida', 'La fecha no es válida.');
  return fecha.toISOString();
}
function fechaIsoOpcional(valor) { return valor === null ? null : fechaIso(valor); }
function fechaSql(valor) { return valor.slice(0, 23).replace('T', ' ').replace('Z', ''); }
function jsonOpcional(valor) { return valor === null ? null : typeof valor === 'string' ? JSON.parse(valor) : valor; }
function objeto(valor) { return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor); }
function fallar(codigo, mensaje) { throw new ErrorMonitoresLocalFederacion(codigo, mensaje); }
