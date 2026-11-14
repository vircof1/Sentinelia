import {
  existeTipoMonitor,
  listarTiposMonitorSoportados,
  normalizarTipoMonitor
} from './CatalogoTiposMonitor.js';
import { RegistroValidadoresConfiguracionMonitor } from './ValidadoresConfiguracionMonitor.js';
import {
  validarInterpretacionEstadoMonitor,
  validarInterpretacionEstadoMonitorPorTipo
} from './SemanticaEstadoMonitor.js';

export class ValidadorMonitor {
  constructor() {
    this.validadoresConfiguracion = new RegistroValidadoresConfiguracionMonitor({
      normalizarHost: (valor) => this.normalizarHost(valor),
      normalizarEnteroEnRango: (...argumentos) =>
        this.normalizarEnteroEnRango(...argumentos),
      normalizarBooleanoEstricto: (...argumentos) =>
        this.normalizarBooleanoEstricto(...argumentos)
    });
  }

  validarDefinicionBase({
    tenantId,
    empresaId,
    sitioId,
    nombre,
    tipo
  }) {
    this.normalizarId(tenantId, 'El tenant del monitor es obligatorio.');
    this.normalizarId(empresaId, 'La empresa del monitor es obligatoria.');
    this.normalizarIdOpcional(sitioId);
    this.normalizarNombre(nombre);
    this.normalizarTipo(tipo);
  }

  normalizarDefinicionBase({
    tenantId,
    empresaId,
    sitioId,
    nombre,
    tipo,
    descripcion = '',
    interpretacionEstado = 'normal',
    descripcionFallo = '',
    posibleSolucion = '',
    activo = true,
    intervaloEjecucionSegundos = null,
    desfaseInicialSegundos = null,
    inferenciasIndisponibleConsecutivas = 1,
    inferenciasDisponibleConsecutivas = 1,
    entradaComposicionBooleana = false,
    configuracion = null,
    host = null,
    timeoutMs = null,
    reintentos = null,
    tamanoPaqueteBytes = null,
    ttl = null,
    puerto = null,
    usarTls = null,
    vigenciaMinimaCertDias = null,
    configuracionLogica = null,
    configuracionTelemetria = null
  }) {
    const tipoNormalizado = this.normalizarTipo(tipo);
    const configuracionBase = this.normalizarConfiguracionBase(configuracion);

    return {
      tenantId: this.normalizarId(
        tenantId,
        'El tenant del monitor es obligatorio.'
      ),
      empresaId: this.normalizarId(
        empresaId,
        'La empresa del monitor es obligatoria.'
      ),
      sitioId: this.normalizarIdOpcional(sitioId),
      nombre: this.normalizarNombre(nombre),
      tipo: tipoNormalizado,
      descripcion: this.normalizarDescripcion(descripcion),
      interpretacionEstado: validarInterpretacionEstadoMonitorPorTipo({
        tipo: tipoNormalizado,
        valor: interpretacionEstado
      }),
      descripcionFallo: this.normalizarTextoOperativo(
        descripcionFallo,
        'La descripción del fallo no puede superar 512 caracteres.'
      ),
      posibleSolucion: this.normalizarTextoOperativo(
        posibleSolucion,
        'La posible solución no puede superar 512 caracteres.'
      ),
      activo: this.normalizarBooleano(activo),
      intervaloEjecucionSegundos: this.normalizarEnteroEnRango(
        intervaloEjecucionSegundos,
        15,
        86400,
        'El intervalo de ejecución del monitor debe estar entre 15 y 86400 segundos.',
        60
      ),
      desfaseInicialSegundos: this.normalizarEnteroEnRango(
        desfaseInicialSegundos,
        0,
        3600,
        'El desfase inicial del monitor debe estar entre 0 y 3600 segundos.',
        0
      ),
      inferenciasIndisponibleConsecutivas: this.normalizarInferenciasConsecutivas(
        inferenciasIndisponibleConsecutivas, 1, 1000,
        'Las inferencias negativas consecutivas deben estar entre 1 y 1000.'
      ),
      inferenciasDisponibleConsecutivas: this.normalizarInferenciasConsecutivas(
        inferenciasDisponibleConsecutivas, 1, 1000,
        'Las inferencias positivas consecutivas deben estar entre 1 y 1000.'
      ),
      entradaComposicionBooleana: this.normalizarBooleanoEstricto(
        entradaComposicionBooleana, false,
        'La opción de entrada de composición booleana no es válida.'
      ),
      configuracion: this.normalizarConfiguracionTecnica(tipoNormalizado, {
        ...configuracionBase,
        host,
        timeoutMs,
        reintentos,
        tamanoPaqueteBytes,
        ttl,
        puerto,
        usarTls,
        vigenciaMinimaCertDias,
        configuracionLogica,
        configuracionTelemetria
      })
    };
  }

  normalizarTipo(valor) {
    const normalizado = normalizarTipoMonitor(valor);

    if (!existeTipoMonitor(normalizado)) {
      throw new Error(
        `El tipo de monitor debe ser uno de: ${listarTiposMonitorSoportados().join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarNombre(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length < 3 || normalizado.length > 160) {
      throw new Error('El nombre del monitor debe tener entre 3 y 160 caracteres.');
    }

    return normalizado;
  }

  normalizarDescripcion(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length > 255) {
      throw new Error('La descripción del monitor no puede superar 255 caracteres.');
    }

    return normalizado || null;
  }

  normalizarInterpretacionEstado(valor) {
    return validarInterpretacionEstadoMonitor(valor);
  }

  normalizarTextoOperativo(valor, mensaje) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length > 512) {
      throw new Error(mensaje);
    }

    return normalizado;
  }

  normalizarConfiguracionBase(valor) {
    if (valor == null || valor === '') {
      return {};
    }

    if (typeof valor === 'object') {
      return valor;
    }

    try {
      return JSON.parse(String(valor));
    } catch (_error) {
      throw new Error('La configuración base del monitor debe ser JSON válido.');
    }
  }

  normalizarConfiguracionTecnica(tipo, datos) {
    return this.validadoresConfiguracion.normalizar(tipo, datos);
  }

  normalizarBooleano(valor) {
    if (typeof valor === 'boolean') {
      return valor;
    }

    return ['1', 'true', 'si', 'yes', 'on'].includes(
      String(valor || '').toLowerCase()
    );
  }

  normalizarBooleanoEstricto(valor, porDefecto, mensaje) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return porDefecto;
    }

    if (typeof valor === 'boolean') {
      return valor;
    }

    const normalizado = String(valor).trim().toLowerCase();

    if (['1', 'true', 'si', 'yes', 'on'].includes(normalizado)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalizado)) {
      return false;
    }

    throw new Error(mensaje);
  }

  normalizarHost(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length < 1 || normalizado.length > 255) {
      throw new Error('El destino del monitor debe tener entre 1 y 255 caracteres.');
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(normalizado)) {
      throw new Error('El destino del monitor solo puede contener letras, números, ".", "-", "_" y ":".');
    }

    return normalizado;
  }

  normalizarEnteroEnRango(valor, minimo, maximo, mensaje, porDefecto = null) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      if (porDefecto != null) {
        return porDefecto;
      }

      throw new Error(mensaje);
    }

    const convertido = Number.parseInt(String(valor), 10);

    if (
      !Number.isInteger(convertido) ||
      convertido < minimo ||
      convertido > maximo
    ) {
      throw new Error(mensaje);
    }

    return convertido;
  }

  normalizarInferenciasConsecutivas(valor, minimo, maximo, mensaje) {
    const texto = String(valor ?? '').trim();
    if (!/^\d+$/.test(texto)) throw new Error(mensaje);
    const numero = Number(texto);
    if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
      throw new Error(mensaje);
    }
    return numero;
  }

  normalizarId(valor, mensaje) {
    const convertido = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      throw new Error(mensaje);
    }

    return convertido;
  }

  normalizarIdOpcional(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return null;
    }

    const convertido = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      throw new Error('El sitio del monitor debe ser un identificador positivo.');
    }

    return convertido;
  }
}
