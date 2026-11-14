import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 }
  from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class RegistradorOutboxPublicacionDns {
  constructor({ repositorioOutbox } = {}) {
    if (typeof repositorioOutbox?.encolarEnTransaccion !== 'function') {
      throw new Error('La publicación DNS requiere la outbox auditable del runtime.');
    }
    this.repositorioOutbox = repositorioOutbox;
  }

  async registrarEnTransaccion({ tipo, operacion, resumen, diagnostico = null } = {}, { conexion } = {}) {
    if (!conexion?.execute || !['aplicada', 'fallida'].includes(tipo) || !operacion) {
      throw new Error('La obligación auditable DNS no está completa.');
    }
    const eventoId = generarUuidV7Auditoria();
    const generacionDns = String(operacion.generacionDns);
    const fallida = tipo === 'fallida';
    const intencion = {
      eventoId,
      tipo: fallida ? 'dns.publicacion_fallida' : 'dns.publicacion_aplicada',
      versionContrato: 1,
      flujo: 'dns',
      claveCadena: 'dns:portal',
      actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: { tipo: 'configuracion_portal', id: 'portal' },
      origen: 'runtime',
      scope: { tenantId: null, empresaId: null, sitioId: null },
      correlacionId: eventoId,
      causalidad: { tipo: 'generacion_dns', id: generacionDns },
      productor: 'runtime_dns',
      claveOperacion: `dns-publicacion:v1:${generacionDns}`,
      rolEvento: 'resultado',
      efectivoEnUtc: new Date().toISOString(),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        sistemaDestino: 'bind',
        resultado: fallida ? 'fallido' : 'aplicado',
        codigo: fallida ? codigoFalloAuditable(diagnostico?.codigo) : null,
        versionRecurso: generacionDns,
        resumen: normalizarResumen(resumen)
      }
    };
    const resultado = await this.repositorioOutbox.encolarEnTransaccion(
      [intencion],
      { conexion }
    );
    const obligacion = resultado?.[0];
    if (!obligacion?.id) {
      throw new Error('La outbox no devolvió la obligación de publicación DNS.');
    }
    return Object.freeze({ obligacionId: String(obligacion.id), eventoId });
  }
}

function normalizarResumen(resumen = {}) {
  return Object.freeze({
    zonas: String(resumen.zonas ?? 0),
    artefactos: String(resumen.artefactos ?? 0),
    cambios: String(resumen.cambios ?? 0)
  });
}

function codigoFalloAuditable(codigo) {
  const admitidos = new Set([
    'artefacto_invalido',
    'checkconf_rechazado',
    'checkzone_rechazado',
    'configuracion_despliegue_invalida'
  ]);
  return admitidos.has(codigo) ? codigo : 'configuracion_despliegue_invalida';
}
