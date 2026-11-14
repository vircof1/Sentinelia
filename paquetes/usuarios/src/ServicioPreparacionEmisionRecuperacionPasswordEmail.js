import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { normalizarBuzonCorreo }
  from '../../correo/src/NormalizadorBuzonCorreo.js';
import {
  ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL,
  PERFILES_RECUPERACION_PASSWORD_EMAIL,
  PLANTILLAS_CORREO_RECUPERACION_PASSWORD_EMAIL,
  PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL,
  RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL,
  VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
  crearFronteraRecuperacionPasswordEmail
} from './ContratoRecuperacionPasswordEmail.js';

const PERFIL_PREPARACION_CORREO =
  'recuperacion_password@1/preparacion_correo';

export class ServicioPreparacionEmisionRecuperacionPasswordEmail {
  constructor({
    repositorioUsuarios,
    repositorioSolicitudes,
    repositorioCoordinacionCorreo,
    fronteraTransaccional,
    servicioConfiguracionPortal,
    propietarioProceso,
    generarId = generarUuidV7Auditoria
  } = {}) {
    exigirMetodo(repositorioUsuarios,
      'listarFronteraElegibleRecuperacionPorBuzonEnTransaccion',
      'repositorioUsuarios');
    exigirMetodo(repositorioSolicitudes, 'generarToken', 'repositorioSolicitudes');
    exigirMetodo(repositorioSolicitudes, 'preparar', 'repositorioSolicitudes');
    exigirMetodo(repositorioSolicitudes, 'descartarPreparacion',
      'repositorioSolicitudes');
    exigirMetodo(repositorioCoordinacionCorreo,
      'crearSalidaPreparadaEnTransaccion', 'repositorioCoordinacionCorreo');
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada',
      'servicioConfiguracionPortal');
    exigirMetodo(servicioConfiguracionPortal, 'obtenerConfiguracionActual',
      'servicioConfiguracionPortal');
    if (typeof generarId !== 'function') throw new Error('generarId es obligatorio.');
    this.repositorioUsuarios = repositorioUsuarios;
    this.repositorioSolicitudes = repositorioSolicitudes;
    this.repositorioCoordinacionCorreo = repositorioCoordinacionCorreo;
    this.frontera = fronteraTransaccional;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.propietarioProceso = textoAscii(propietarioProceso, 'propietarioProceso');
    this.generarId = generarId;
  }

  async preparar({ buzon, direccionIp } = {}) {
    const buzonCanonico = normalizarBuzonCorreo(String(buzon ?? '')).canonico;
    const ip = normalizarIp(direccionIp);
    await this.servicioConfiguracionPortal.asegurarActualizada();
    const portal = this.servicioConfiguracionPortal.obtenerConfiguracionActual();
    const configuracionUsuarios = portal.obtenerConfiguracionUsuarios();
    const origenPublico = validarOrigenPublico(portal.obtenerOrigenPublicoPortal());
    const nombrePortal = String(portal.obtenerNombreVisiblePortal()).trim();
    let autoridadPreparada = null;

    try {
      return await this.frontera.ejecutar(async (conexion) => {
        const miembrosSql = await this.repositorioUsuarios
          .listarFronteraElegibleRecuperacionPorBuzonEnTransaccion(
            { buzonCanonico }, { conexion }
          );
        if (miembrosSql.length === 0) {
          return Object.freeze({
            resultado: RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL.SIN_IDENTIDADES,
            preparada: false
          });
        }

        const ids = generarIdentidades(this.generarId);
        const token = this.repositorioSolicitudes.generarToken();
        const frontera = crearFronteraRecuperacionPasswordEmail({
          perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.FRONTERA,
          version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
          miembros: miembrosSql.map((miembro) => ({
            usuarioId: String(miembro.usuarioId),
            generacionRecuperacionObservada:
              String(miembro.generacionRecuperacion),
            estado:
              ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL.UTILIZABLE
          }))
        });
        const enlaceRecuperacion = construirEnlace(origenPublico, token);
        const contenido = prepararContenido({
          nombrePortal,
          enlaceRecuperacion
        });
        const creadaEnUtc = await obtenerAhoraSqlUtc(conexion);
        const materialPreparacion = Object.freeze({
          perfil: PERFIL_PREPARACION_CORREO,
          version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
          token,
          enlaceRecuperacion,
          cuerpoPlantilla: contenido.cuerpoPlantilla,
          operacionId: ids.operacionId,
          propietario: this.propietarioProceso,
          eventoConsumoId: ids.eventoConsumoId,
          vigenciaSegundos:
            configuracionUsuarios.recuperacionEmailVigenciaSegundos
        });
        autoridadPreparada = { solicitudId: ids.solicitudId, token,
          operacionId: ids.operacionId, propietario: this.propietarioProceso };
        const preparadaRedis = await this.repositorioSolicitudes.preparar({
          solicitudId: ids.solicitudId,
          token,
          buzonCanonico,
          frontera,
          eventoEmisionId: ids.eventoEmisionId,
          eventoConsumoId: ids.eventoConsumoId,
          presupuestoMaximo:
            configuracionUsuarios.recuperacionEmailAlegacionesMaximas,
          operacionId: ids.operacionId,
          propietario: this.propietarioProceso,
          leaseSegundos:
            configuracionUsuarios.recuperacionEmailLeasePreparacionSegundos
        });
        if (!['preparada', 'repetida'].includes(preparadaRedis.estado)) {
          throw new Error(`Redis rechazó la preparación: ${preparadaRedis.estado}.`);
        }

        const salida = await this.repositorioCoordinacionCorreo
          .crearSalidaPreparadaEnTransaccion({
            solicitudId: ids.solicitudId,
            eventoEmisionId: ids.eventoEmisionId,
            claveOperacionSha256: sha(
              `recuperacion-password\0emision\0${ids.eventoEmisionId}`
            ),
            direccionIpOrigen: ip,
            materialPreparacion,
            buzonCanonico,
            claveBuzonSha256: sha(buzonCanonico),
            smtpMessageId: construirMessageId(ids.solicitudId, origenPublico),
            asunto: contenido.asunto,
            usuariosJustificantesIds:
              frontera.miembros.map(({ usuarioId }) => usuarioId),
            creadaEnUtc
          }, { conexion });

        return Object.freeze({
          resultado: 'preparada',
          preparada: true,
          solicitudId: ids.solicitudId,
          eventoEmisionId: ids.eventoEmisionId,
          eventoConsumoId: ids.eventoConsumoId,
          operacionId: ids.operacionId,
          token,
          salidaId: String(salida.salida.id),
          buzonCanonico,
          direccionIp: ip,
          asunto: contenido.asunto,
          frontera,
          materialPreparacion
        });
      });
    } catch (error) {
      if (autoridadPreparada) {
        await this.repositorioSolicitudes
          .descartarPreparacion(autoridadPreparada)
          .catch(() => {});
      }
      throw error;
    }
  }
}

function generarIdentidades(generarId) {
  const ids = {
    solicitudId: generarId(),
    eventoEmisionId: generarId(),
    eventoConsumoId: generarId(),
    operacionId: generarId()
  };
  if (new Set(Object.values(ids)).size !== 4) {
    throw new Error('Las identidades preasignadas deben ser distintas.');
  }
  return Object.freeze(ids);
}

function prepararContenido({ nombrePortal, enlaceRecuperacion }) {
  const plantilla = PLANTILLAS_CORREO_RECUPERACION_PASSWORD_EMAIL[
    PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL.TRANSPORTAR_SOLICITUD
  ];
  return Object.freeze({
    asunto: plantilla.asunto.replaceAll('{{portal}}', nombrePortal),
    cuerpoPlantilla: plantilla.cuerpo.replaceAll(
      '{{urlRecuperacion}}', enlaceRecuperacion
    )
  });
}

function construirEnlace(origenPublico, token) {
  const url = new URL('/recuperacion-password', origenPublico);
  url.searchParams.set('token', token);
  return url.toString();
}

function construirMessageId(solicitudId, origenPublico) {
  const host = new URL(origenPublico).hostname.replaceAll(':', '-');
  return `<${sha(`smtp\0${solicitudId}`)}@${host}>`;
}

async function obtenerAhoraSqlUtc(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora_utc');
  const valor = filas[0]?.ahora_utc;
  const fecha = valor instanceof Date ? valor : new Date(`${valor}Z`);
  if (Number.isNaN(fecha.getTime())) throw new Error('SQL no devolvió su reloj UTC.');
  return fecha.toISOString();
}

function validarOrigenPublico(valor) {
  let url;
  try { url = new URL(String(valor || '')); } catch {
    throw new Error('La recuperación exige portal.origen_publico válido.');
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('La recuperación exige un origen público HTTPS canónico.');
  }
  return url.origin;
}

function normalizarIp(valor) {
  const ip = String(valor ?? '').replace(/^::ffff:/u, '').trim();
  if (!isIP(ip)) throw new Error('direccionIp debe proceder de requisicion.ip.');
  return ip;
}

function textoAscii(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[\x21-\x7e]{1,190}$/u.test(texto)) {
    throw new Error(`${campo} debe ser una identidad ASCII.`);
  }
  return texto;
}

function sha(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

export const PERFIL_PREPARACION_CORREO_RECUPERACION_PASSWORD =
  PERFIL_PREPARACION_CORREO;
