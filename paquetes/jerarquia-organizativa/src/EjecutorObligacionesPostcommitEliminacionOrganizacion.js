const TIPOS = new Set([
  'invalidar_catalogo_monitores',
  'invalidar_sesiones_usuarios_redis',
  'retirar_estructura_organizacion_redis'
]);

export class EjecutorObligacionesPostcommitEliminacionOrganizacion {
  constructor({
    invalidatorSesionesUsuariosRedis,
    retiradorEstructuraOrganizacionRedis,
    versionadorCatalogoMonitoresRedis
  } = {}) {
    if (typeof invalidatorSesionesUsuariosRedis?.invalidar !== 'function' ||
        typeof retiradorEstructuraOrganizacionRedis?.retirar !== 'function' ||
        typeof versionadorCatalogoMonitoresRedis?.incrementarVersion !== 'function') {
      throw new Error('El ejecutor organizativo exige sus tres puertos Redis.');
    }
    Object.assign(this, {
      invalidatorSesionesUsuariosRedis,
      retiradorEstructuraOrganizacionRedis,
      versionadorCatalogoMonitoresRedis
    });
  }

  async ejecutar(obligacion) {
    const tipo = String(obligacion?.tipo || '');
    const objetivo = obligacion?.objetivo;
    if (!TIPOS.has(tipo) || Number(obligacion?.version) !== 1 ||
        !objetivoOrganizativo(objetivo)) {
      throw errorEjecucion(
        'obligacion_postcommit_contrato_incompatible',
        'La obligación organizativa no pertenece al contrato ejecutable.',
        true
      );
    }
    try {
      if (tipo === 'invalidar_catalogo_monitores') {
        const versionCatalogo = await this.versionadorCatalogoMonitoresRedis
          .incrementarVersion();
        return Object.freeze({ tipo, aplicada: true, versionCatalogo });
      }
      if (tipo === 'invalidar_sesiones_usuarios_redis') {
        const resultado = await this.invalidatorSesionesUsuariosRedis
          .invalidar(objetivo);
        return Object.freeze({ tipo, aplicada: true, ...resultado });
      }
      const resultado = await this.retiradorEstructuraOrganizacionRedis
        .retirar(objetivo);
      return Object.freeze({ tipo, aplicada: true, ...resultado });
    } catch (error) {
      if (error?.esErrorObligacionPostcommit === true) throw error;
      throw errorEjecucion(
        'obligacion_postcommit_dependencia_no_disponible',
        'Una dependencia efímera no permitió converger la organización.',
        false,
        error
      );
    }
  }
}

function objetivoOrganizativo(objetivo) {
  return objetivo && ['tenant', 'empresa', 'sitio'].includes(objetivo.tipo) &&
    /^[1-9][0-9]*$/u.test(String(objetivo.id ?? ''));
}

function errorEjecucion(codigo, mensaje, permanente, causa = null) {
  return Object.assign(new Error(mensaje, causa ? { cause: causa } : undefined), {
    codigo,
    permanente,
    esErrorObligacionPostcommit: true
  });
}
