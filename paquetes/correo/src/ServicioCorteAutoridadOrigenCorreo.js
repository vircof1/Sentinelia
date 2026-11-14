import { CLAVE_LEGACY_ORIGEN_PUBLICO }
  from './CatalogoConfiguracionCorreo.js';

const CLAVE_ORIGEN_LEGACY = CLAVE_LEGACY_ORIGEN_PUBLICO;
const CLAVE_ORIGEN_PORTAL = 'portal.origen_publico';

export class ServicioCorteAutoridadOrigenCorreo {
  constructor({
    repositorioConfiguracion,
    fronteraTransaccional,
    versionadorConfiguracionRedis
  } = {}) {
    if (!repositorioConfiguracion?.bloquearAutoridadCorreoEnTransaccion ||
        !repositorioConfiguracion?.actualizarValorEnTransaccion ||
        !repositorioConfiguracion?.cortarAutoridadOrigenCorreoEnTransaccion ||
        !repositorioConfiguracion?.incrementarVersionEnTransaccion ||
        !fronteraTransaccional?.ejecutar ||
        !versionadorConfiguracionRedis?.publicarVersion) {
      throw new Error('El corte del origen público requiere autoridad SQL y versión Redis.');
    }
    this.repositorioConfiguracion = repositorioConfiguracion;
    this.fronteraTransaccional = fronteraTransaccional;
    this.versionadorConfiguracionRedis = versionadorConfiguracionRedis;
  }

  async ejecutar({ preparacionUnanime } = {}) {
    if (preparacionUnanime?.unanimidad !== true ||
        typeof preparacionUnanime?.gateAbierto !== 'boolean') {
      throw new Error('El origen público no puede cortarse sin unanimidad compatible.');
    }
    const resultado = await this.fronteraTransaccional.ejecutar(async (conexion) => {
      const autoridad = await this.repositorioConfiguracion
        .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'exclusivo' });
      const estado = autoridad.estadoDespliegue;
      exigirPerfil(preparacionUnanime.perfil, estado.perfil_objetivo);
      if (['corte_origen', 'corte_verificacion', 'quietud_cola', 'activado']
        .includes(estado.estado)) {
        exigirPostcondiciones(estado);
        return Object.freeze({
          cambioEfectivo: false,
          origenCopiado: autoridad.valores.get(CLAVE_ORIGEN_PORTAL),
          versionDurable: autoridad.versionConfiguracion,
          estado: estado.estado
        });
      }
      if (estado.estado !== 'preparacion') {
        throw new Error(`El corte del origen no admite el estado ${estado.estado}.`);
      }
      exigirPreparacionCerrada(estado);
      const origenLegado = autoridad.valores.get(CLAVE_ORIGEN_LEGACY);
      await this.repositorioConfiguracion.actualizarValorEnTransaccion(
        CLAVE_ORIGEN_PORTAL,
        origenLegado,
        { conexion }
      );
      await this.repositorioConfiguracion
        .cortarAutoridadOrigenCorreoEnTransaccion({ conexion });
      const versionDurable = await this.repositorioConfiguracion
        .incrementarVersionEnTransaccion({ conexion });
      return Object.freeze({
        cambioEfectivo: true,
        origenCopiado: origenLegado,
        versionDurable,
        estado: 'corte_origen'
      });
    });
    const versionPublicada = await this.versionadorConfiguracionRedis
      .publicarVersion(resultado.versionDurable);
    return Object.freeze({ ...resultado, versionPublicada });
  }
}

function exigirPerfil(declarado, objetivo) {
  if (!declarado || String(declarado) !== String(objetivo)) {
    throw new Error('El perfil unánime no coincide con la cabecera de despliegue.');
  }
}

function exigirPreparacionCerrada(estado) {
  const gates = [
    'guard_metadatos_activo',
    'origen_portal_autoritativo',
    'verificacion_smtp_autoritativa',
    'guard_verificacion_legacy_activo',
    'guard_revision_trigger_activo',
    'cola_sql_autoritativa',
    'tipo_correo_habilitado'
  ];
  if (gates.some((clave) => Number(estado[clave]) !== 0)) {
    throw new Error('La preparación del origen contiene gates anticipados.');
  }
}

function exigirPostcondiciones(estado) {
  const smtpCortado = ['corte_verificacion', 'quietud_cola', 'activado']
    .includes(estado.estado);
  if (Number(estado.origen_portal_autoritativo) !== 1 ||
      Number(estado.guard_metadatos_activo) !== (smtpCortado ? 1 : 0) ||
      Number(estado.verificacion_smtp_autoritativa) !== (smtpCortado ? 1 : 0) ||
      Number(estado.guard_verificacion_legacy_activo) !== (smtpCortado ? 1 : 0) ||
      ![0, 1].includes(Number(estado.guard_revision_trigger_activo)) ||
      Number(estado.cola_sql_autoritativa) !==
        (estado.estado === 'activado' ? 1 : 0) ||
      !tipoCoherente(estado) ||
      !estado.cortado_en_utc) {
    throw new Error('La autoridad durable del origen público es incoherente.');
  }
}

function tipoCoherente(estado) {
  return [0, 1].includes(Number(estado.tipo_correo_habilitado)) &&
    (estado.estado === 'activado' || Number(estado.tipo_correo_habilitado) === 0);
}
