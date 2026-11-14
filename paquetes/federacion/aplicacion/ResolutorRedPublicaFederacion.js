import proxyaddr from 'proxy-addr';

const CABECERAS_REENVIADAS = Object.freeze([
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto'
]);

export class ResolutorRedPublicaFederacion {
  constructor({ servicioConfiguracionPortal } = {}) {
    exigirMetodo(
      servicioConfiguracionPortal,
      'asegurarActualizada',
      'servicioConfiguracionPortal'
    );
    exigirMetodo(
      servicioConfiguracionPortal,
      'obtenerVersionActual',
      'servicioConfiguracionPortal'
    );
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.fotografia = null;
    this.confiarProxyCompilado = () => false;
    this.actualizacionEnCurso = null;
  }

  async inicializar() {
    await this.#actualizarFotografia();
    return this.construirResumen();
  }

  async asegurarActualizado() {
    if (this.actualizacionEnCurso) return this.actualizacionEnCurso;
    this.actualizacionEnCurso = this.#actualizarFotografia();
    try {
      return await this.actualizacionEnCurso;
    } finally {
      this.actualizacionEnCurso = null;
    }
  }

  configurarAplicacionExpress(aplicacion) {
    if (!aplicacion?.set || !aplicacion?.use) {
      throw new Error('La aplicación Express es obligatoria para aplicar la confianza de red.');
    }
    this.#exigirInicializado();
    aplicacion.set(
      'trust proxy',
      (direccion, indice) => this.esProxyConfiable(direccion, indice)
    );
    aplicacion.use(this.crearMiddlewareHttp());
  }

  crearMiddlewareHttp() {
    return async (requisicion, _respuesta, next) => {
      try {
        await this.asegurarActualizado();
        requisicion.redPublicaFederacion =
          this.construirContextoPeticion(requisicion);
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  async prepararUpgrade(requisicion) {
    await this.asegurarActualizado();
    requisicion.redPublicaFederacion =
      this.construirContextoPeticion(requisicion);
    return requisicion.redPublicaFederacion;
  }

  esProxyConfiable(direccion, indice = 0) {
    this.#exigirInicializado();
    if (typeof direccion !== 'string' || !direccion.trim()) return false;
    try {
      return Boolean(this.confiarProxyCompilado(direccion, indice));
    } catch {
      return false;
    }
  }

  obtenerOrigenPublico() {
    this.#exigirInicializado();
    return this.fotografia.origenPublico;
  }

  construirContextoPeticion(requisicion) {
    this.#exigirInicializado();
    const direccionSalto = normalizarTexto(requisicion?.socket?.remoteAddress);
    const saltoConfiable = this.esProxyConfiable(direccionSalto, 0);
    const cadena = resolverCadenaDirecciones(
      requisicion,
      direccionSalto
    );
    const forwardedPresente = requisicion?.headers?.forwarded !== undefined;
    const cadenaProxiesConfiable = saltoConfiable && cadena.valida &&
      verificarCadenaProxiesConfiable(
        cadena.direcciones,
        this.confiarProxyCompilado
      );
    const cabecerasPresentes = CABECERAS_REENVIADAS.some((nombre) =>
      requisicion?.headers?.[nombre] !== undefined
    );
    const direccionCliente = cadenaProxiesConfiable
      ? cadena.direcciones.at(-1) || direccionSalto
      : resolverPrimerSaltoNoConfiable(
          cadena.direcciones,
          this.confiarProxyCompilado,
          direccionSalto
        );
    const protocoloConexion = requisicion?.socket?.encrypted ? 'https' : 'http';
    const protocoloReenviado = cadenaProxiesConfiable && !forwardedPresente
      ? normalizarProtocoloReenviado(requisicion?.headers?.['x-forwarded-proto'])
      : null;

    return congelar({
      origenPublico: this.fotografia.origenPublico,
      direccionSalto,
      direccionCliente,
      saltoConfiable,
      cadenaProxiesConfiable,
      protocoloExterior: protocoloReenviado || protocoloConexion,
      cabecerasReenviadasPresentes: cabecerasPresentes,
      cabecerasReenviadasAceptadas:
        cadenaProxiesConfiable && protocoloReenviado !== null,
      hostReenviadoDiagnostico: cadenaProxiesConfiable
        ? sanearHostDiagnostico(requisicion?.headers?.['x-forwarded-host'])
        : null,
      versionConfiguracion: this.fotografia.versionConfiguracion
    });
  }

  construirResumen() {
    this.#exigirInicializado();
    return congelar({
      origenPublico: this.fotografia.origenPublico,
      totalProxiesConfiables: this.fotografia.proxiesConfiables.length,
      proxiesConfiables: [...this.fotografia.proxiesConfiables],
      advertencias: [...this.fotografia.advertencias],
      versionConfiguracion: this.fotografia.versionConfiguracion
    });
  }

  validarProxiesConfiables(proxiesConfiables) {
    const politica = compilarProxiesConfiables(proxiesConfiables);
    return congelar({
      totalProxiesConfiables: politica.proxiesConfiables.length,
      proxiesConfiables: [...politica.proxiesConfiables],
      advertencias: [...politica.advertencias]
    });
  }

  async #actualizarFotografia() {
    const portal = await this.servicioConfiguracionPortal.asegurarActualizada();
    const versionConfiguracion = Number(
      this.servicioConfiguracionPortal.obtenerVersionActual()
    );
    if (
      this.fotografia &&
      this.fotografia.versionConfiguracion === versionConfiguracion
    ) {
      return this.fotografia;
    }
    const configuracion = portal.obtenerConfiguracionFederacion();
    const politica = compilarProxiesConfiables(configuracion.proxiesConfiables);
    const fotografia = congelar({
      origenPublico: configuracion.origenPublico,
      proxiesConfiables: politica.proxiesConfiables,
      advertencias: politica.advertencias,
      versionConfiguracion
    });
    this.confiarProxyCompilado = politica.confiarProxyCompilado;
    this.fotografia = fotografia;
    return fotografia;
  }

  #exigirInicializado() {
    if (!this.fotografia) {
      throw new Error('El resolutor de red pública federada aún no está inicializado.');
    }
  }
}

function compilarProxiesConfiables(proxiesConfiables) {
  if (!Array.isArray(proxiesConfiables)) {
    throw new Error('Los proxies confiables deben formar una lista aplicable.');
  }
  const proxies = [...proxiesConfiables];
  const proxiesAplicables = proxies.flatMap(expandirRangoUniversal);
  let confiarProxyCompilado;
  try {
    confiarProxyCompilado = proxyaddr.compile(proxiesAplicables);
  } catch (error) {
    throw new Error(
      `La lista de proxies confiables contiene una dirección o rango no aplicable: ${error.message}`
    );
  }
  return {
    proxiesConfiables: proxies,
    confiarProxyCompilado,
    advertencias: detectarRangosExcesivamenteAmplios(proxies)
  };
}

function expandirRangoUniversal(proxy) {
  if (proxy === '0.0.0.0/0') {
    return ['0.0.0.0/1', '128.0.0.0/1'];
  }
  if (proxy === '::/0') {
    return ['::/1', '8000::/1'];
  }
  return [proxy];
}

function resolverCadenaDirecciones(requisicion, direccionSalto) {
  if (!requisicion?.socket) {
    return { direcciones: direccionSalto ? [direccionSalto] : [], valida: false };
  }
  try {
    return { direcciones: proxyaddr.all(requisicion), valida: true };
  } catch {
    return { direcciones: direccionSalto ? [direccionSalto] : [], valida: false };
  }
}

function verificarCadenaProxiesConfiable(direcciones, confiarProxy) {
  if (!Array.isArray(direcciones) || direcciones.length === 0) return false;
  if (direcciones.some((direccion) => !esDireccionAplicable(direccion))) return false;
  const ultimoProxy = Math.max(1, direcciones.length - 1);
  for (let indice = 0; indice < ultimoProxy; indice += 1) {
    try {
      if (!confiarProxy(direcciones[indice], indice)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function esDireccionAplicable(direccion) {
  try {
    proxyaddr.compile([direccion]);
    return true;
  } catch {
    return false;
  }
}

function resolverPrimerSaltoNoConfiable(direcciones, confiarProxy, direccionSalto) {
  if (!Array.isArray(direcciones) || direcciones.length === 0) return direccionSalto;
  for (let indice = 0; indice < direcciones.length - 1; indice += 1) {
    try {
      if (!confiarProxy(direcciones[indice], indice)) return direcciones[indice];
    } catch {
      return direcciones[indice];
    }
  }
  return direcciones.at(-1) || direccionSalto;
}

function normalizarProtocoloReenviado(valor) {
  if (Array.isArray(valor) || String(valor ?? '').includes(',')) return null;
  const protocolo = normalizarTexto(valor)?.toLowerCase();
  return protocolo === 'http' || protocolo === 'https' ? protocolo : null;
}

function sanearHostDiagnostico(valor) {
  if (Array.isArray(valor) || String(valor ?? '').includes(',')) return null;
  const host = normalizarTexto(valor)?.toLowerCase();
  if (!host || host.length > 255 || !/^[a-z0-9.[\]:-]+$/u.test(host)) return null;
  return host;
}

function detectarRangosExcesivamenteAmplios(proxies) {
  return proxies
    .filter((entrada) => entrada === '0.0.0.0/0' || entrada === '::/0')
    .map((entrada) =>
      `El rango ${entrada} confía en cualquier origen de red y debe revisarse.`
    );
}

function normalizarTexto(valor) {
  const texto = String(valor ?? '').trim();
  return texto || null;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
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
