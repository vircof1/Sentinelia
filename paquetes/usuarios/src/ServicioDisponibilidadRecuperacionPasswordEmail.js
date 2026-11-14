export class RecuperacionPasswordNoHabilitable extends Error {
  constructor(dependencias) {
    super('No se puede habilitar la recuperación hasta satisfacer sus dependencias obligatorias.');
    this.name = 'RecuperacionPasswordNoHabilitable';
    this.codigo = 'RECUPERACION_PASSWORD_NO_HABILITABLE';
    this.estadoHttp = 409;
    this.dependencias = dependencias;
  }
}

export class ServicioDisponibilidadRecuperacionPasswordEmail {
  constructor({
    servicioConfiguracionPortal,
    servicioCorreoPortal,
    presenciaPreparada = () => false
  } = {}) {
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada',
      'servicioConfiguracionPortal');
    exigirMetodo(servicioConfiguracionPortal, 'obtenerConfiguracionActual',
      'servicioConfiguracionPortal');
    if (typeof presenciaPreparada !== 'function') {
      throw new Error('La disponibilidad exige declarar la preparación local.');
    }
    this.configuracion = servicioConfiguracionPortal;
    this.correo = servicioCorreoPortal;
    this.presenciaPreparada = presenciaPreparada;
  }

  async evaluar() {
    await this.configuracion.asegurarActualizada();
    const portal = this.configuracion.obtenerConfiguracionActual();
    const usuarios = portal.obtenerConfiguracionUsuarios();
    const estadoCorreo = await obtenerEstadoCorreo(this.correo);
    const dependencias = Object.freeze([
      dependencia('despliegue', await this.presenciaPreparada() === true,
        'La presencia web declara compatible la recuperación completa.'),
      dependencia('smtp_verificado', estadoCorreo?.operativo === true,
        'El correo SMTP dispone de verificación empírica vigente.'),
      dependencia('origen_publico_https', esOrigenHttps(
        portal.obtenerOrigenPublicoPortal?.()
      ), 'El portal dispone de un origen público HTTPS canónico.')
    ]);
    const puedeHabilitar = dependencias.every(({ satisfecha }) => satisfecha);
    const intencionHabilitada = usuarios.recuperacionEmailActiva === true;
    return Object.freeze({
      intencionHabilitada,
      puedeHabilitar,
      disponible: intencionHabilitada && puedeHabilitar,
      dependencias,
      parametros: Object.freeze({ ...usuarios })
    });
  }

  async validarCambioIntencion(valor) {
    if (!esVerdadero(valor)) return this.evaluar();
    const estado = await this.evaluar();
    if (!estado.intencionHabilitada && !estado.puedeHabilitar) {
      throw new RecuperacionPasswordNoHabilitable(
        estado.dependencias.filter(({ satisfecha }) => !satisfecha)
      );
    }
    return estado;
  }
}

async function obtenerEstadoCorreo(servicio) {
  if (typeof servicio?.obtenerEstadoConfiguracionAutoritativo === 'function') {
    return servicio.obtenerEstadoConfiguracionAutoritativo();
  }
  if (typeof servicio?.obtenerEstadoConfiguracion === 'function') {
    return servicio.obtenerEstadoConfiguracion();
  }
  throw new Error('La disponibilidad de recuperación exige el estado SMTP.');
}

function dependencia(codigo, satisfecha, descripcion) {
  return Object.freeze({ codigo, satisfecha: satisfecha === true, descripcion });
}

function esOrigenHttps(valor) {
  try {
    const url = new URL(String(valor || ''));
    return url.protocol === 'https:' && !url.username && !url.password &&
      Boolean(url.hostname);
  } catch {
    return false;
  }
}

function esVerdadero(valor) {
  return valor === true || ['1', 'true', 'si', 'sí', 'on'].includes(
    String(valor ?? '').trim().toLowerCase()
  );
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}
