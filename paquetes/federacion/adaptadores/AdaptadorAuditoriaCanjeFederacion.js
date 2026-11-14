import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class AdaptadorAuditoriaCanjeFederacion {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('El canje federado requiere auditoría transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async registrarEnTransaccion(entrada, { conexion } = {}) {
    if (!conexion?.execute) throw new Error('El canje exige una conexión prestada.');
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion([
      {
        eventoId: entrada.eventoId,
        tipo: 'federacion.invitacion_consumida',
        versionContrato: 2,
        flujo: 'federacion',
        claveCadena: construirClaveCadenaAuditoria({
          flujo: 'federacion', tenantId: entrada.scope.tenantId
        }),
        actorReal: {
          tipo: 'instancia_remota', id: entrada.installationEmisoraId
        },
        actorEfectivo: null,
        modoActuacion: 'directo',
        sujeto: { tipo: 'relacion_federada', id: entrada.relacionId },
        origen: 'api_federacion',
        scope: entrada.scope,
        correlacionId: entrada.solicitudCanjeId,
        causalidad: { tipo: 'relacion_federacion', id: entrada.relacionId },
        productor: 'api_federacion',
        claveOperacion: `canje-federacion:v1:${entrada.solicitudCanjeId}`,
        rolEvento: 'principal',
        efectivoEnUtc: normalizarFecha(entrada.efectivoEnUtc),
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
        payload: {
          accion: 'consumir_invitacion',
          resultado: 'consumida',
          motivoCodigo: null,
          revisionConcesionId: null,
          resumen: {
            relacionesAfectadas: '1',
            flujosAfectados: '0',
            proyeccionesAfectadas: '0'
          }
        }
      }
    ], { conexion });
    if (resultado?.eventos?.length !== 1 || resultado.eventos[0]?.estado !== 'incorporado') {
      throw new Error('La auditoría no incorporó el consumo de invitación.');
    }
    return Object.freeze({ ...resultado.eventos[0] });
  }
}

function normalizarFecha(valor) {
  const texto = String(valor || '');
  const sql = texto.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})\d{0,3}$/u
  );
  return sql ? `${sql[1]}T${sql[2]}.${sql[3]}Z` : texto;
}
