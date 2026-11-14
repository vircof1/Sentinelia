import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

const SEMANTICA = Object.freeze({
  'federacion.recuperacion_solicitada': ['solicitar_recuperacion', 'solicitada'],
  'federacion.credencial_recuperada': ['recuperar_credencial', 'recuperada'],
  'federacion.credencial_rotada': ['rotar_credencial', 'rotada'],
  'federacion.localizacion_propuesta': ['proponer_localizacion', 'propuesta'],
  'federacion.localizacion_cambiada': ['cambiar_localizacion', 'actualizada'],
  'federacion.conflicto_identidad_detectado': ['detectar_conflicto_identidad', 'detectado'],
  'federacion.conflicto_identidad_resuelto': ['resolver_conflicto_identidad', 'resuelto']
});

export class AdaptadorAuditoriaSeguridadFederacion {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('La seguridad federada exige auditoría transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async registrarEnTransaccion(entrada, { conexion } = {}) {
    if (!conexion?.execute || !SEMANTICA[entrada.tipo]) {
      throw new Error('La transición de seguridad federada no es auditable.');
    }
    const [accion, resultado] = SEMANTICA[entrada.tipo];
    const tecnico = entrada.actor.real.tipo === 'instancia_remota';
    const runtime = entrada.actor.real.tipo === 'runtime';
    const sujetoTipo = entrada.tipo.startsWith('federacion.conflicto_identidad_')
      ? 'instalacion_federada' : 'relacion_federada';
    const resultadoAuditoria = await this.repositorioAuditoria.incorporarEnTransaccion([{
      eventoId: entrada.eventoId,
      tipo: entrada.tipo,
      versionContrato: 2,
      flujo: 'federacion',
      claveCadena: construirClaveCadenaAuditoria({
        flujo: 'federacion', tenantId: entrada.scope.tenantId
      }),
      actorReal: entrada.actor.real,
      actorEfectivo: entrada.actor.efectivo ?? null,
      modoActuacion: entrada.actor.modo,
      sujeto: { tipo: sujetoTipo, id: entrada.sujetoId },
      origen: tecnico ? 'api_federacion' : runtime ? 'runtime' : 'web',
      scope: entrada.scope,
      correlacionId: entrada.correlacionId,
      causalidad: { tipo: 'relacion_federacion', id: entrada.relacionId },
      productor: tecnico ? 'api_federacion'
        : runtime ? 'runtime_federacion' : 'portal_federacion',
      claveOperacion: `seguridad-federacion:v1:${entrada.eventoId}`,
      rolEvento: 'principal',
      efectivoEnUtc: fechaIso(entrada.efectivoEnUtc),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        accion,
        resultado,
        motivoCodigo: entrada.motivoCodigo ?? null,
        revisionConcesionId: null,
        resumen: {
          relacionesAfectadas: String(entrada.relacionesAfectadas ?? 1),
          flujosAfectados: '0',
          proyeccionesAfectadas: '0'
        }
      }
    }], { conexion });
    if (resultadoAuditoria?.eventos?.[0]?.estado !== 'incorporado') {
      throw new Error('La auditoría no incorporó la seguridad federada.');
    }
    return Object.freeze({ ...resultadoAuditoria.eventos[0] });
  }
}

function fechaIso(valor) {
  const texto = String(valor);
  const sql = texto.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})/u);
  return sql ? `${sql[1]}T${sql[2]}.${sql[3]}Z` : texto;
}
