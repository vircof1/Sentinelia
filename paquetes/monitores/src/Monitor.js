import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  crearConfiguracionMonitorLogicoBase
} from './ConfiguracionMonitorLogico.js';
import {
  resumirDependenciasMonitorLogico
} from './DependenciasMonitorLogico.js';
import {
  normalizarInterpretacionEstadoMonitorPorTipo
} from './SemanticaEstadoMonitor.js';

function parsearConfiguracion(valor) {
  if (!valor) {
    return null;
  }

  if (typeof valor === 'object') {
    return valor;
  }

  try {
    return JSON.parse(valor);
  } catch (_error) {
    return null;
  }
}

function normalizarTexto(valor, porDefecto = null) {
  if (valor == null || valor === '') {
    return porDefecto;
  }

  return String(valor).trim();
}

function normalizarEntero(valor, porDefecto) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

function normalizarBooleano(valor, porDefecto = false) {
  if (typeof valor === 'boolean') {
    return valor;
  }

  if (valor == null || valor === '') {
    return porDefecto;
  }

  return ['1', 'true', 'si', 'yes', 'on'].includes(
    String(valor).trim().toLowerCase()
  );
}

export class Monitor {
  constructor(fila) {
    this.id = fila.id;
    this.tenantId = fila.tenant_id;
    this.empresaId = fila.empresa_id;
    this.sitioId = fila.sitio_id;
    this.nombre = fila.nombre;
    this.tipo = fila.tipo;
    this.descripcion = fila.descripcion;
    this.interpretacionEstado = normalizarInterpretacionEstadoMonitorPorTipo({
      tipo: this.tipo,
      valor: fila.interpretacion_estado
    });
    this.descripcionFallo = normalizarTexto(fila.descripcion_fallo, '') || '';
    this.posibleSolucion = normalizarTexto(fila.posible_solucion, '') || '';
    this.activo = Boolean(fila.activo);
    this.intervaloEjecucionSegundos = normalizarEntero(
      fila.intervalo_ejecucion_segundos,
      60
    );
    this.desfaseInicialSegundos = normalizarEntero(
      fila.desfase_inicial_segundos,
      0
    );
    this.inferenciasIndisponibleConsecutivas = normalizarEntero(
      fila.inferencias_indisponible_consecutivas, 1
    );
    this.inferenciasDisponibleConsecutivas = normalizarEntero(
      fila.inferencias_disponible_consecutivas, 1
    );
    this.entradaComposicionBooleana = normalizarBooleano(
      fila.entrada_composicion_booleana
    );
    this.configuracion = parsearConfiguracion(fila.configuracion);
    this.tenantNombre = fila.tenant_nombre || null;
    this.empresaNombre = fila.empresa_nombre || null;
    this.sitioNombre = fila.sitio_nombre || null;
    this.fechaCreacion = fila.fecha_creacion;
    this.fechaActualizacion = fila.fecha_actualizacion;
    this.configuracion = this.normalizarConfiguracionTecnica(this.configuracion);
    this.estadoActualRuntime = this.normalizarEstadoActualRuntime(fila);
  }

  resolverNivelPertenencia() {
    return this.sitioId == null ? 'empresa' : 'sitio';
  }

  normalizarConfiguracionTecnica(configuracion) {
    return configuracion ?? {};
  }

  obtenerDestinoPrincipal() {
    return this.configuracion?.host || '-';
  }

  normalizarEstadoActualRuntime(fila) {
    if (!fila || fila.estado_actual_monitor_monitor_id == null) {
      return null;
    }

    const resultadoActual = parsearConfiguracion(fila.estado_actual_monitor_resultado_actual);
    const metricaPrincipal = resultadoActual?.metricaPrincipal || null;
    const codigoResultado = normalizarTexto(resultadoActual?.codigoResultado, null);
    const mensajeResultado = normalizarTexto(resultadoActual?.mensajeResultado, null);
    const exitoTecnico = resultadoActual?.exitoTecnico == null
      ? null
      : Boolean(resultadoActual.exitoTecnico);
    const interpretacionEstado = normalizarInterpretacionEstadoMonitorPorTipo({
      tipo: this.tipo,
      valor: resultadoActual?.interpretacionEstado || this.interpretacionEstado
    });
    const interpretacionResultado = resultadoActual?.interpretacionResultado || null;
    const estadoTecnicoDetectado = normalizarTexto(
      resultadoActual?.estadoTecnicoDetectado,
      null
    );
    const codigoResultadoTecnico = normalizarTexto(
      resultadoActual?.codigoResultadoTecnico,
      null
    );
    const mensajeResultadoTecnico = normalizarTexto(
      resultadoActual?.mensajeResultadoTecnico,
      null
    );
    const fechaUltimaEjecucionUtc = normalizarMarcaUtc(
      fila.estado_actual_monitor_fecha_ultima_ejecucion_utc
    );
    const fechaUltimoCambioUtc = normalizarMarcaUtc(
      fila.estado_actual_monitor_fecha_ultimo_cambio_utc
    );
    const estado = normalizarTexto(fila.estado_actual_monitor_estado, 'desconocido')
      ?.toLowerCase();
    const ejecutadoTodavia = Boolean(fila.estado_actual_monitor_ejecutado_todavia);
    const histeresis = resultadoActual?.histeresis || null;
    const tlsAutorizado = metricaPrincipal?.tlsAutorizado ?? null;
    const certificadoDiasRestantes = Number.isInteger(
      Number(metricaPrincipal?.certificadoDiasRestantes)
    )
      ? Number(metricaPrincipal?.certificadoDiasRestantes)
      : null;
    const certificadoVigenciaMinimaDias = Number.isInteger(
      Number(metricaPrincipal?.certificadoVigenciaMinimaDias)
    )
      ? Number(metricaPrincipal?.certificadoVigenciaMinimaDias)
      : null;

    return {
      monitorId: Number(fila.estado_actual_monitor_monitor_id),
      estado,
      ejecutadoTodavia,
      histeresis,
      fechaUltimaEjecucionUtc,
      fechaUltimoCambioUtc,
      codigoResultado,
      mensajeResultado,
      exitoTecnico,
      interpretacionEstado,
      interpretacionResultado,
      estadoTecnicoDetectado,
      codigoResultadoTecnico,
      mensajeResultadoTecnico,
      detalleTls: {
        autorizado: tlsAutorizado,
        certificadoValidoHastaUtc:
          metricaPrincipal?.certificadoValidoHastaUtc ?? null,
        certificadoDiasRestantes,
        certificadoVigenciaMinimaDias
      },
      resumenHumano: this.construirResumenHumanoEstadoRuntime({
        estado,
        ejecutadoTodavia,
        histeresis,
        codigoResultado,
        mensajeResultado,
        interpretacionEstado,
        interpretacionResultado,
        estadoTecnicoDetectado,
        codigoResultadoTecnico,
        mensajeResultadoTecnico,
        tlsAutorizado,
        certificadoDiasRestantes,
        certificadoVigenciaMinimaDias,
        metricaPrincipal
      })
    };
  }

  construirResumenHumanoEstadoRuntime({
    estado,
    ejecutadoTodavia,
    histeresis,
    codigoResultado,
    mensajeResultado,
    interpretacionEstado,
    interpretacionResultado,
    estadoTecnicoDetectado,
    codigoResultadoTecnico,
    mensajeResultadoTecnico,
    tlsAutorizado,
    certificadoDiasRestantes,
    certificadoVigenciaMinimaDias
  }) {
    if (!ejecutadoTodavia) {
      return {
        tono: 'pendiente',
        etiquetaEstado: 'Pendiente',
        etiquetaTecnica: 'Sin ejecución',
        detalle: 'El runtime todavía no ha ejecutado este monitor.'
      };
    }

    if (Number(histeresis?.inferenciasConsecutivas || 0) > 0) {
      const objetivo = histeresis.estadoInferido;
      const necesarias = objetivo === 'disponible'
        ? this.inferenciasDisponibleConsecutivas
        : this.inferenciasIndisponibleConsecutivas;
      return {
        tono: estado === 'indisponible' ? 'error' : 'pendiente',
        etiquetaEstado: estado === 'desconocido'
          ? 'Desconocido'
          : estado === 'disponible' ? 'Disponible' : 'Indisponible',
        etiquetaTecnica: `Cambio pendiente ${histeresis.inferenciasConsecutivas}/${necesarias}`,
        detalle: `Última inferencia: ${objetivo}. ${mensajeResultado || ''}`.trim()
      };
    }

    if (estado === 'desconocido') {
      return {
        tono: 'pendiente',
        etiquetaEstado: 'Desconocido',
        etiquetaTecnica: codigoResultado || 'sin_resultado',
        detalle:
          mensajeResultado ||
          'La última ejecución no permitió obtener un estado concluyente.'
      };
    }

    if (codigoResultado === 'fallo_por_respuesta') {
      return {
        tono: 'error',
        etiquetaEstado: 'Indisponible',
        etiquetaTecnica: 'Falló porque respondió',
        detalle:
          interpretacionResultado?.mensajeInterpretacion ||
          mensajeResultado ||
          'Falló porque respondió.',
        interpretacion: {
          aplicada: true,
          interpretacionEstado,
          estadoTecnicoDetectado,
          codigoResultadoTecnico,
          mensajeResultadoTecnico
        }
      };
    }

    if (codigoResultado === 'ausencia_respuesta_esperada') {
      return {
        tono: 'ok',
        etiquetaEstado: 'Disponible',
        etiquetaTecnica: 'Ausencia esperada',
        detalle:
          interpretacionResultado?.mensajeInterpretacion ||
          mensajeResultado ||
          'La ausencia de respuesta cumple la condición esperada.',
        interpretacion: {
          aplicada: true,
          interpretacionEstado,
          estadoTecnicoDetectado,
          codigoResultadoTecnico,
          mensajeResultadoTecnico
        }
      };
    }

    if (codigoResultado === 'tls_vigencia_insuficiente') {
      return {
        tono: 'alerta',
        etiquetaEstado: 'Vigencia insuficiente',
        etiquetaTecnica: certificadoDiasRestantes == null
          ? 'TLS con margen insuficiente'
          : `Caduca en ${certificadoDiasRestantes} días`,
        detalle: mensajeResultado || 'El certificado no cumple la vigencia mínima exigida.'
      };
    }

    if (codigoResultado === 'tls_vigencia_indeterminada') {
      return {
        tono: 'advertencia',
        etiquetaEstado: 'Vigencia indeterminada',
        etiquetaTecnica: 'TLS sin fecha usable',
        detalle:
          mensajeResultado || 'No se pudo calcular la vigencia restante del certificado.'
      };
    }

    if (codigoResultado === 'tls_no_autorizado') {
      return {
        tono: 'error',
        etiquetaEstado: 'TLS no autorizado',
        etiquetaTecnica: 'Certificado no confiable',
        detalle:
          mensajeResultado || 'El endpoint respondió por TLS, pero no superó la validación.'
      };
    }

    if (tlsAutorizado === true && certificadoDiasRestantes != null) {
      const detalleMargen = certificadoVigenciaMinimaDias > 0
        ? ` · mínimo ${certificadoVigenciaMinimaDias} días`
        : '';

      return {
        tono: estado === 'disponible' ? 'ok' : 'advertencia',
        etiquetaEstado: estado === 'disponible' ? 'TLS válido' : 'TLS revisado',
        etiquetaTecnica: `Caduca en ${certificadoDiasRestantes} días`,
        detalle:
          `Certificado confiable${detalleMargen}.`
      };
    }

    return {
      tono: estado === 'disponible' ? 'ok' : 'error',
      etiquetaEstado: estado === 'disponible' ? 'Disponible' : 'Indisponible',
      etiquetaTecnica: codigoResultado || 'sin_resultado',
      detalle: mensajeResultado || 'Sin detalle operativo adicional.'
    };
  }

  serializarResumenTecnico() {
    return {
      titulo: 'Configuracion base',
      destino: this.obtenerDestinoPrincipal(),
      metricas: [
        {
          etiqueta: 'Destino',
          valor: this.obtenerDestinoPrincipal(),
          destacada: true
        },
        {
          etiqueta: 'Timeout',
          valor: `${this.configuracion?.timeoutMs ?? '-'} ms`
        },
        {
          etiqueta: 'Reintentos',
          valor: String(this.configuracion?.reintentos ?? '-')
        }
      ],
      lineas: [
        `Destino: ${this.obtenerDestinoPrincipal()}`,
        `Timeout: ${this.configuracion?.timeoutMs ?? '-'} ms`,
        `Reintentos: ${this.configuracion?.reintentos ?? '-'}`
      ]
    };
  }

  serializarResumen() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      tenantNombre: this.tenantNombre,
      empresaNombre: this.empresaNombre,
      sitioNombre: this.sitioNombre,
      nombre: this.nombre,
      tipo: this.tipo,
      descripcion: this.descripcion,
      interpretacionEstado: this.interpretacionEstado,
      descripcionFallo: this.descripcionFallo,
      posibleSolucion: this.posibleSolucion,
      activo: this.activo,
      intervaloEjecucionSegundos: this.intervaloEjecucionSegundos,
      desfaseInicialSegundos: this.desfaseInicialSegundos,
      inferenciasIndisponibleConsecutivas: this.inferenciasIndisponibleConsecutivas,
      inferenciasDisponibleConsecutivas: this.inferenciasDisponibleConsecutivas,
      entradaComposicionBooleana: this.entradaComposicionBooleana,
      configuracion: this.configuracion,
      resumenTecnico: this.serializarResumenTecnico(),
      estadoRuntime: this.serializarEstadoActualRuntimeVisible(),
      nivelPertenencia: this.resolverNivelPertenencia(),
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion)
    };
  }

  serializarEstadoActualRuntimeVisible() {
    if (!this.estadoActualRuntime) {
      return null;
    }

    return {
      monitorId: this.estadoActualRuntime.monitorId,
      estado: this.estadoActualRuntime.estado,
      ejecutadoTodavia: this.estadoActualRuntime.ejecutadoTodavia,
      histeresis: this.estadoActualRuntime.histeresis,
      fechaUltimaEjecucionUtc: this.estadoActualRuntime.fechaUltimaEjecucionUtc,
      fechaUltimoCambioUtc: this.estadoActualRuntime.fechaUltimoCambioUtc,
      codigoResultado: this.estadoActualRuntime.codigoResultado,
      mensajeResultado: this.estadoActualRuntime.mensajeResultado,
      exitoTecnico: this.estadoActualRuntime.exitoTecnico,
      interpretacionEstado: this.estadoActualRuntime.interpretacionEstado,
      interpretacionResultado: this.estadoActualRuntime.interpretacionResultado,
      estadoTecnicoDetectado: this.estadoActualRuntime.estadoTecnicoDetectado,
      codigoResultadoTecnico: this.estadoActualRuntime.codigoResultadoTecnico,
      mensajeResultadoTecnico: this.estadoActualRuntime.mensajeResultadoTecnico,
      detalleTls: this.estadoActualRuntime.detalleTls,
      resumenHumano: this.estadoActualRuntime.resumenHumano
    };
  }

  serializarDefinicionRuntime() {
    return {
      id: this.id,
      nombre: this.nombre,
      tipo: this.tipo,
      interpretacionEstado: this.interpretacionEstado,
      descripcionFallo: this.descripcionFallo,
      posibleSolucion: this.posibleSolucion,
      activo: this.activo,
      inferenciasIndisponibleConsecutivas: this.inferenciasIndisponibleConsecutivas,
      inferenciasDisponibleConsecutivas: this.inferenciasDisponibleConsecutivas,
      entradaComposicionBooleana: this.entradaComposicionBooleana,
      version:
        normalizarMarcaUtc(this.fechaActualizacion || this.fechaCreacion) || '',
      scope: {
        tenantId: this.tenantId,
        empresaId: this.empresaId,
        sitioId: this.sitioId,
        nivelPertenencia: this.resolverNivelPertenencia()
      },
      programacion: {
        intervaloEjecucionSegundos: this.intervaloEjecucionSegundos,
        desfaseInicialSegundos: this.desfaseInicialSegundos
      },
      configuracion: this.configuracion
    };
  }
}

export class MonitorPing extends Monitor {
  normalizarConfiguracionTecnica(configuracion) {
    const base = super.normalizarConfiguracionTecnica(configuracion);

    return {
      host: String(base.host || '').trim(),
      timeoutMs: normalizarEntero(base.timeoutMs, 1200),
      reintentos: normalizarEntero(base.reintentos, 1),
      tamanoPaqueteBytes: normalizarEntero(base.tamanoPaqueteBytes, 56),
      ttl: normalizarEntero(base.ttl, 64)
    };
  }

  serializarResumenTecnico() {
    return {
      titulo: 'ICMP',
      destino: this.obtenerDestinoPrincipal(),
      metricas: [
        {
          etiqueta: 'Destino ICMP',
          valor: this.obtenerDestinoPrincipal(),
          destacada: true
        },
        {
          etiqueta: 'Payload',
          valor: `${this.configuracion.tamanoPaqueteBytes} bytes`,
          destacada: true
        },
        {
          etiqueta: 'TTL',
          valor: String(this.configuracion.ttl),
          destacada: true
        },
        {
          etiqueta: 'Timeout',
          valor: `${this.configuracion.timeoutMs} ms`
        },
        {
          etiqueta: 'Reintentos',
          valor: String(this.configuracion.reintentos)
        }
      ],
      lineas: [
        `Destino ICMP: ${this.obtenerDestinoPrincipal()}`,
        `Timeout: ${this.configuracion.timeoutMs} ms`,
        `Reintentos: ${this.configuracion.reintentos}`,
        `Payload: ${this.configuracion.tamanoPaqueteBytes} bytes`,
        `TTL: ${this.configuracion.ttl}`
      ]
    };
  }
}

export class MonitorTcp extends Monitor {
  normalizarConfiguracionTecnica(configuracion) {
    const base = super.normalizarConfiguracionTecnica(configuracion);
    const usarTls = normalizarBooleano(base.usarTls, false);
    const vigenciaMinimaCertDias = normalizarEntero(base.vigenciaMinimaCertDias, 0);

    return {
      host: String(base.host || '').trim(),
      puerto: normalizarEntero(base.puerto, 443),
      timeoutMs: normalizarEntero(base.timeoutMs, 1500),
      reintentos: normalizarEntero(base.reintentos, 1),
      usarTls,
      vigenciaMinimaCertDias: usarTls
        ? Math.min(3650, Math.max(0, vigenciaMinimaCertDias))
        : 0
    };
  }

  serializarResumenTecnico() {
    const metricas = [
      {
        etiqueta: 'Destino TCP',
        valor: `${this.obtenerDestinoPrincipal()}:${this.configuracion.puerto}`,
        destacada: true
      },
      {
        etiqueta: 'Puerto',
        valor: String(this.configuracion.puerto),
        destacada: true
      },
      {
        etiqueta: 'TLS válido',
        valor: this.configuracion.usarTls ? 'sí' : 'no',
        destacada: true
      },
      {
        etiqueta: 'Timeout',
        valor: `${this.configuracion.timeoutMs} ms`
      },
      {
        etiqueta: 'Reintentos',
        valor: String(this.configuracion.reintentos)
      }
    ];
    const lineas = [
      `Destino TCP: ${this.obtenerDestinoPrincipal()}:${this.configuracion.puerto}`,
      `Timeout: ${this.configuracion.timeoutMs} ms`,
      `Reintentos: ${this.configuracion.reintentos}`,
      `TLS válido: ${this.configuracion.usarTls ? 'sí' : 'no'}`
    ];

    if (this.configuracion.usarTls) {
      metricas.push({
        etiqueta: 'Vigencia mínima',
        valor: `${this.configuracion.vigenciaMinimaCertDias} días`
      });
      lineas.push(
        `Vigencia mínima certificado: ${this.configuracion.vigenciaMinimaCertDias} días`
      );
    }

    return {
      titulo: 'TCP',
      destino: this.obtenerDestinoPrincipal(),
      metricas,
      lineas
    };
  }
}

export class MonitorBooleano extends Monitor {
  normalizarConfiguracionTecnica(configuracion) {
    return crearConfiguracionMonitorLogicoBase(configuracion);
  }

  obtenerDestinoPrincipal() {
    return this.configuracion.expresion || 'Expresión pendiente';
  }

  serializarResumenTecnico() {
    const resumenDependencias = resumirDependenciasMonitorLogico(
      this.configuracion.dependencias
    );
    const retardo = Number(this.configuracion.retardoSenalSegundos || 0);
    const metricas = [
      {
        etiqueta: 'Expresión',
        valor: this.configuracion.expresion || 'Pendiente',
        destacada: true
      },
      {
        etiqueta: 'Entradas',
        valor: String(resumenDependencias.total),
        destacada: true
      },
      {
        etiqueta: 'Salida inicial',
        valor: this.configuracion.estadoInicial || 'disponible',
        destacada: true
      },
      {
        etiqueta: 'Retardo',
        valor: retardo > 0 ? `${retardo} s` : 'sin retardo'
      }
    ];
    const dependencias = normalizarDependenciasResumenTecnico(
      this.configuracion.dependencias
    );

    return {
      titulo: 'Monitor lógico',
      destino: this.obtenerDestinoPrincipal(),
      metricas,
      lineas: [
        `Expresión: ${this.configuracion.expresion || 'Pendiente'}`,
        `Dependencias: ${resumenDependencias.variables.join(', ') || 'ninguna'}`,
        `Salida inicial: ${this.configuracion.estadoInicial}`,
        `Retardo señal: ${retardo > 0 ? `${retardo} s` : 'sin retardo'}`
      ],
      logica: {
        expresion: this.configuracion.expresion || '',
        dependencias,
        resumenDependencias,
        mensajeFallo: this.configuracion.mensajeFallo || '',
        estadoInicial: this.configuracion.estadoInicial || 'disponible',
        retardoSenalSegundos: retardo,
        politicaEntradasIncompletas:
          this.configuracion.politicaEntradasIncompletas || 'conservar_salida',
        tieneLayoutVisual: Boolean(this.configuracion.layoutVisual)
      }
    };
  }
}

function normalizarDependenciasResumenTecnico(dependencias = []) {
  if (!Array.isArray(dependencias)) {
    return [];
  }

  return dependencias.map((dependencia) => ({
    variable: dependencia.variable || dependencia.nombre || '-',
    fuente: dependencia.fuente || 'monitor',
    monitorId: dependencia.monitorId ?? null,
    etiqueta: dependencia.etiqueta || dependencia.nombreHumano || null
  }));
}

export function crearMonitorDesdeFila(fila) {
  const tipo = String(fila?.tipo || '').trim().toLowerCase();

  if (tipo === 'ping') {
    return new MonitorPing(fila);
  }

  if (tipo === 'tcp') {
    return new MonitorTcp(fila);
  }

  if (tipo === 'booleano') {
    return new MonitorBooleano(fila);
  }

  return new Monitor(fila);
}
