import {
  DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL,
  PERFILES_RECUPERACION_PASSWORD_EMAIL,
  RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL,
  VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
  crearAlegacionRecuperacionPasswordEmail,
  crearHuellaRecuperacionPasswordEmail
} from './ContratoRecuperacionPasswordEmail.js';
import { ValidadorJerarquiaUsuario } from './ValidadorJerarquiaUsuario.js';
import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';

const RESUELTA = RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.RESUELTA;
const NO_RESUELTA =
  RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.NO_RESUELTA;
const AGOTADO =
  RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.PRESUPUESTO_AGOTADO;

export class ServicioResolucionAgnosticaRecuperacionPasswordEmail {
  constructor({
    repositorioSolicitudes,
    repositorioUsuarios,
    fronteraTransaccional,
    propietario,
    validadorUsuario = new ValidadorJerarquiaUsuario()
  } = {}) {
    for (const metodo of ['reservarAlegacion', 'inspeccionar',
      'consolidarAlegacion', 'restaurarAlegacion']) {
      exigirMetodo(repositorioSolicitudes, metodo, 'repositorioSolicitudes');
    }
    exigirMetodo(repositorioUsuarios,
      'buscarIdentidadElegibleRecuperacionPorUsuarioEnTransaccion',
      'repositorioUsuarios');
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    exigirMetodo(validadorUsuario, 'validarUsuario', 'validadorUsuario');
    this.solicitudes = repositorioSolicitudes;
    this.usuarios = repositorioUsuarios;
    this.frontera = fronteraTransaccional;
    this.propietario = texto(propietario, 190, 'propietario');
    this.validadorUsuario = validadorUsuario;
  }

  async resolver({ token, usuario, leaseSegundos } = {}) {
    const nombre = String(usuario ?? '').trim();
    this.validadorUsuario.validarUsuario(nombre);
    const huellaNombreSha256 = crearHuellaRecuperacionPasswordEmail(
      DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL.NOMBRE_ALEGADO,
      claseEquivalenciaNombre(nombre)
    );
    const reservaId = generarUuidV7Auditoria();
    const reserva = await this.solicitudes.reservarAlegacion({
      token,
      huellaNombreSha256,
      reservaId,
      propietario: this.propietario,
      leaseSegundos
    });

    if (reserva.estado === 'repetida') {
      return proyectarAlegacionConsolidada(
        huellaNombreSha256, reserva.alegacion, true
      );
    }
    if (reserva.estado === 'presupuesto_agotado') {
      return crearResultado({ huellaNombreSha256, resultado: AGOTADO });
    }
    if (reserva.estado !== 'reservada' &&
        reserva.estado !== 'repetida_reserva') {
      return Object.freeze({
        estado: reserva.estado,
        utilizable: false,
        alegacion: null
      });
    }

    try {
      const inspeccion = await this.solicitudes.inspeccionar(token);
      if (inspeccion.estado !== 'activa' || !inspeccion.solicitud) {
        await this.#restaurar({ token, huellaNombreSha256, reservaId });
        return Object.freeze({
          estado: inspeccion.estado,
          utilizable: false,
          alegacion: null
        });
      }
      const solicitud = inspeccion.solicitud;
      const identidad = await this.frontera.ejecutar((conexion) =>
        this.usuarios.buscarIdentidadElegibleRecuperacionPorUsuarioEnTransaccion({
          usuario: nombre,
          buzonCanonico: solicitud.buzonCanonico
        }, { conexion, forUpdate: true })
      );
      const miembro = identidad
        ? solicitud.frontera.miembros.find(({ usuarioId }) =>
          String(usuarioId) === String(identidad.id))
        : null;
      const resuelta = Boolean(miembro && miembro.estado === 'utilizable' &&
        String(miembro.generacionRecuperacionObservada) ===
          String(identidad.generacionRecuperacion));
      const consolidada = await this.solicitudes.consolidarAlegacion({
        token,
        huellaNombreSha256,
        reservaId,
        propietario: this.propietario,
        resultado: resuelta ? RESUELTA : NO_RESUELTA,
        usuarioIdResuelto: resuelta ? String(identidad.id) : null,
        generacionRecuperacionObservada: resuelta
          ? String(identidad.generacionRecuperacion)
          : null
      });
      if (!['consolidada', 'repetida'].includes(consolidada.estado)) {
        await this.#restaurar({ token, huellaNombreSha256, reservaId });
        return Object.freeze({
          estado: consolidada.estado,
          utilizable: false,
          alegacion: null
        });
      }
      return proyectarAlegacionConsolidada(
        huellaNombreSha256, consolidada.alegacion,
        consolidada.estado === 'repetida'
      );
    } catch (error) {
      await this.#restaurar({ token, huellaNombreSha256, reservaId });
      throw error;
    }
  }

  async #restaurar({ token, huellaNombreSha256, reservaId }) {
    try {
      await this.solicitudes.restaurarAlegacion({
        token,
        huellaNombreSha256,
        reservaId,
        propietario: this.propietario
      });
    } catch {
      // El fallo original conserva la autoridad; la lease limita el abandono.
    }
  }
}

function proyectarAlegacionConsolidada(huellaNombreSha256, alegacion, repetida) {
  if (!alegacion || ![RESUELTA, NO_RESUELTA].includes(alegacion.resultado)) {
    throw new Error('Redis devolvió una alegación consolidada incoherente.');
  }
  const contrato = crearAlegacionRecuperacionPasswordEmail({
    perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.ALEGACION,
    version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
    huellaNombreSha256,
    resultado: alegacion.resultado,
    repetida,
    consumePresupuesto: !repetida,
    usuarioIdResuelto: alegacion.usuarioIdResuelto == null
      ? null : String(alegacion.usuarioIdResuelto)
  });
  return Object.freeze({ estado: contrato.resultado, utilizable: true,
    alegacion: contrato });
}

function crearResultado({ huellaNombreSha256, resultado }) {
  const alegacion = crearAlegacionRecuperacionPasswordEmail({
    perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.ALEGACION,
    version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
    huellaNombreSha256,
    resultado,
    repetida: false,
    consumePresupuesto: false,
    usuarioIdResuelto: null
  });
  return Object.freeze({ estado: resultado, utilizable: true, alegacion });
}

function claseEquivalenciaNombre(nombre) {
  return nombre.replace(/[A-Z]/gu, (letra) => letra.toLowerCase());
}

function texto(valor, maximo, campo) {
  const normalizado = String(valor ?? '').trim();
  if (!normalizado || Buffer.byteLength(normalizado, 'utf8') > maximo) {
    throw new Error(`${campo} no es válido.`);
  }
  return normalizado;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}
