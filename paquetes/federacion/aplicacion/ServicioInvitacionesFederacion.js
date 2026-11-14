import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { crearRepresentacionInvitacionEstablecimientoFederacion } from '../src/InvitacionEstablecimientoFederacion.js';

export class ServicioInvitacionesFederacion {
  constructor({
    repositorioInvitaciones,
    generadorCredencial,
    resolverOrigenPublico,
    installationReceptoraId,
    guardiaActivacion = null,
    guardiaRecepcion = null
  } = {}) {
    exigirMetodo(repositorioInvitaciones, 'emitir', 'repositorioInvitaciones');
    exigirMetodo(repositorioInvitaciones, 'revocar', 'repositorioInvitaciones');
    exigirMetodo(generadorCredencial, 'generar', 'generadorCredencial');
    if (typeof resolverOrigenPublico !== 'function') {
      throw new Error('El servicio de invitaciones requiere resolverOrigenPublico().');
    }
    exigirInstalacion(installationReceptoraId);
    this.repositorioInvitaciones = repositorioInvitaciones;
    this.generadorCredencial = generadorCredencial;
    this.resolverOrigenPublico = resolverOrigenPublico;
    this.installationReceptoraId = installationReceptoraId;
    if (guardiaActivacion !== null &&
        typeof guardiaActivacion?.exigirActiva !== 'function') {
      throw new Error('guardiaActivacion debe implementar exigirActiva().');
    }
    this.guardiaActivacion = guardiaActivacion;
    if (guardiaRecepcion !== null &&
        typeof guardiaRecepcion?.exigirPreparada !== 'function') {
      throw new Error('guardiaRecepcion debe implementar exigirPreparada().');
    }
    this.guardiaRecepcion = guardiaRecepcion;
  }

  async emitir(entrada = {}) {
    await this.guardiaRecepcion?.exigirPreparada('emitir_invitacion');
    await this.guardiaActivacion?.exigirActiva('emitir_invitacion');
    validarComun(entrada);
    const ttlSegundos = enteroAcotado(
      entrada.ttlSegundos ?? 900,
      60,
      86400,
      'ttlSegundos debe estar entre 60 segundos y 24 horas.'
    );
    const credencial = this.generadorCredencial.generar();
    const resultado = await this.repositorioInvitaciones.emitir({
      relacionId: entrada.relacionId,
      installationReceptoraId: this.installationReceptoraId,
      invitacionId: credencial.invitacionId,
      credencialHash: credencial.credencialHash,
      ttlSegundos,
      auditoria: auditoria(entrada)
    });
    const representacionTransportable =
      crearRepresentacionInvitacionEstablecimientoFederacion({
        invitacionId: credencial.invitacionId,
        credencialTemporal: credencial.credencialTemporal,
        relacionId: entrada.relacionId,
        installationReceptoraId: this.installationReceptoraId,
        origenPublico: this.resolverOrigenPublico(),
        expiraEnUtc: resultado.expiraEnUtc
      });
    return Object.freeze({
      estado: resultado.estado,
      invitacionId: credencial.invitacionId,
      expiraEnUtc: resultado.expiraEnUtc,
      representacionTransportable
    });
  }

  revocar(entrada = {}) {
    validarComun(entrada);
    if (typeof entrada.invitacionId !== 'string') {
      throw new Error('invitacionId es obligatoria para revocar.');
    }
    return this.repositorioInvitaciones.revocar({
      relacionId: entrada.relacionId,
      invitacionId: entrada.invitacionId,
      auditoria: auditoria(entrada)
    });
  }
}

function validarComun(entrada) {
  if (
    typeof entrada.relacionId !== 'string' ||
    !/^sfid1\.relacion\.[A-Za-z0-9_-]{21}[AQgw]$/u.test(entrada.relacionId)
  ) throw new Error('relacionId no es válida.');
  validarUuidV7Auditoria(entrada.eventoId, 'eventoId');
  validarUuidV7Auditoria(entrada.correlacionId, 'correlacionId');
  if (
    entrada.actor?.modo !== 'directo' ||
    entrada.actor?.real?.tipo !== 'usuario' ||
    entrada.actor?.efectivo != null ||
    !/^[1-9][0-9]*$/.test(String(entrada.actor.real.id))
  ) {
    throw new Error('Las invitaciones exigen una sesión humana directa.');
  }
}

function auditoria(entrada) {
  return Object.freeze({
    eventoId: entrada.eventoId,
    correlacionId: entrada.correlacionId,
    actor: entrada.actor
  });
}

function exigirInstalacion(valor) {
  if (!/^sfid1\.instalacion\.[A-Za-z0-9_-]{21}[AQgw]$/u.test(String(valor || ''))) {
    throw new Error('installationReceptoraId no es canónica.');
  }
}

function enteroAcotado(valor, minimo, maximo, mensaje) {
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(mensaje);
  }
  return valor;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
