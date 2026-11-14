import {
  proyectarCapacidadesConfiguracionFederacion
} from '../../../../paquetes/federacion/src/ConfiguracionFederacion.js';

const CLAVES_ORIGEN_PUBLICO = Object.freeze([
  'portal.origen_publico',
  'federacion.origen_publico'
]);
const CLAVE_PROXIES_CONFIABLES = 'federacion.proxies_confiables';
const CLAVES_RED_PUBLICA = Object.freeze([
  ...CLAVES_ORIGEN_PUBLICO,
  CLAVE_PROXIES_CONFIABLES
]);

export class ServicioPresentacionRedPublicaFederacion {
  constructor({ servicioConfiguracionPortal, resolutorRedPublicaFederacion } = {}) {
    if (
      typeof servicioConfiguracionPortal?.asegurarActualizada !== 'function' ||
      typeof servicioConfiguracionPortal?.listarConfiguraciones !== 'function' ||
      typeof resolutorRedPublicaFederacion?.asegurarActualizado !== 'function' ||
      typeof resolutorRedPublicaFederacion?.construirResumen !== 'function' ||
      typeof resolutorRedPublicaFederacion?.validarProxiesConfiables !== 'function'
    ) {
      throw new Error('La presentación de red federada requiere configuración y resolutor vivos.');
    }
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.resolutorRedPublicaFederacion = resolutorRedPublicaFederacion;
  }

  async construir(configuraciones = null) {
    const portal = await this.servicioConfiguracionPortal.asegurarActualizada();
    await this.resolutorRedPublicaFederacion.asegurarActualizado();
    const configuracion = portal.obtenerConfiguracionFederacion();
    const capacidades = proyectarCapacidadesConfiguracionFederacion(configuracion);
    const resumen = this.resolutorRedPublicaFederacion.construirResumen();
    const entradas = configuraciones ||
      await this.servicioConfiguracionPortal.listarConfiguraciones();
    const advertencias = construirAdvertencias(configuracion, resumen);
    return congelar({
      estado: resolverEstado({
        capacidades,
        advertencias
      }),
      etiquetaEstado: resolverEtiquetaEstado({
        capacidades,
        advertencias
      }),
      activada: capacidades.activacionGlobal,
      preparada: capacidades.recepcionPreparada,
      emisionDisponible: capacidades.emisionDisponible,
      recepcionPreparada: capacidades.recepcionPreparada,
      capacidades: presentarCapacidades(capacidades),
      origenPublico: resumen.origenPublico,
      proxiesConfiables: [...resumen.proxiesConfiables],
      totalProxiesConfiables: resumen.totalProxiesConfiables,
      advertencias,
      versionConfiguracion: resumen.versionConfiguracion,
      variablesEntorno: {
        origenPublico: 'PORTAL_ORIGEN_PUBLICO',
        proxiesConfiables: 'PORTAL_PROXIES_REVERSOS_CONFIABLES'
      },
      claves: entradas.filter((entrada) =>
        CLAVES_RED_PUBLICA.includes(entrada.clave))
    });
  }

  validarCambio({ clave, valor } = {}) {
    if (clave !== CLAVE_PROXIES_CONFIABLES) return;
    this.resolutorRedPublicaFederacion.validarProxiesConfiables(
      parsearListaProxies(valor)
    );
  }

  validarRestablecimiento(clave) {
    if (clave !== CLAVE_PROXIES_CONFIABLES) return;
    const definicion = this.servicioConfiguracionPortal.obtenerDefinicion(clave);
    this.validarCambio({ clave, valor: definicion.valorPorDefecto });
  }
}

function construirAdvertencias(configuracion, resumen) {
  const advertencias = resumen.advertencias.map((mensaje) => ({
    codigo: 'proxy_excesivamente_amplio',
    gravedad: 'advertencia',
    mensaje
  }));
  if (!configuracion.origenPublico) {
    advertencias.push({
      codigo: 'origen_publico_ausente',
      gravedad: 'pendiente',
      mensaje: 'Define el origen público HTTPS para habilitar la recepción federada.'
    });
  }
  if (resumen.totalProxiesConfiables === 0) {
    advertencias.push({
      codigo: 'proxies_confiables_ausentes',
      gravedad: 'pendiente',
      mensaje: 'Declara al menos un reverse proxy confiable para recibir federación.'
    });
  }
  return advertencias;
}

function resolverEstado({ capacidades, advertencias }) {
  if (!capacidades.activacionGlobal) return 'desactivada';
  if (!capacidades.recepcionPreparada) return 'solo-emision';
  if (advertencias.length > 0) return 'advertencia';
  return 'activa';
}

function resolverEtiquetaEstado({ capacidades, advertencias }) {
  if (!capacidades.activacionGlobal) return 'Federación desactivada';
  if (!capacidades.recepcionPreparada) {
    return 'Emisión disponible · recepción no preparada';
  }
  if (advertencias.length > 0) return 'Requiere revisión';
  return 'Emisión y recepción disponibles';
}

function presentarCapacidades(capacidades) {
  return {
    activacion: {
      disponible: capacidades.activacionGlobal,
      estado: capacidades.activacionGlobal ? 'activa' : 'inactiva',
      etiqueta: capacidades.activacionGlobal ? 'Activa' : 'Desactivada',
      bloqueos: capacidades.activacionGlobal
        ? []
        : ['federacionDesactivada']
    },
    emision: {
      disponible: capacidades.emisionDisponible,
      estado: capacidades.emisionDisponible ? 'disponible' : 'bloqueada',
      etiqueta: capacidades.emisionDisponible ? 'Disponible' : 'No disponible',
      bloqueos: [...capacidades.bloqueos.emision]
    },
    recepcion: {
      disponible: capacidades.recepcionPreparada,
      estado: capacidades.recepcionPreparada ? 'preparada' : 'noPreparada',
      etiqueta: capacidades.recepcionPreparada ? 'Preparada' : 'No preparada',
      bloqueos: [...capacidades.bloqueos.recepcion]
    }
  };
}

function parsearListaProxies(valor) {
  return String(valor ?? '')
    .split(/[\n,]+/gu)
    .map((entrada) => entrada.trim())
    .filter(Boolean);
}

function congelar(valor) {
  if (Array.isArray(valor)) {
    valor.forEach(congelar);
    return Object.freeze(valor);
  }
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelar);
    return Object.freeze(valor);
  }
  return valor;
}
