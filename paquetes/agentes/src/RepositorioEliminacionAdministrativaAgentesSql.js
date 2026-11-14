import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { LeaseOperacionDurablePerdido } from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { crearComandoEliminacionAdministrativaAgente } from './ContratoEliminacionAdministrativaAgente.js';
import { AutoridadReservasJerarquicasOperacionesAdministrativasSql }
  from '../../jerarquia-organizativa/src/AutoridadReservasJerarquicasOperacionesAdministrativasSql.js';
import { RepositorioPreparacionBajaEjecucionesTriggerCorreoSql }
  from '../../correo/src/RepositorioPreparacionBajaEjecucionesTriggerCorreoSql.js';

const PERFIL_FOTOGRAFIA_CANONICA =
  'sentinelia-eliminacion-agente-fotografia-canonica-v1';
const LIMITE_CONTEO_HISTORICO = 10_000n;
const LIMITE_LECTURA_HISTORICO = LIMITE_CONTEO_HISTORICO + 1n;

export const ORDEN_BLOQUEO_ELIMINACION_AGENTE = Object.freeze([
  'tenant',
  'empresa',
  'sitio',
  'operacion',
  'reclamo',
  'agente',
  'concesiones_ddns',
  'intenciones_ddns',
  'intentos_publicacion_ddns',
  'causas_pol_ddns',
  'reglas',
  'revisiones_reglas',
  'monitores',
  'asignaciones_trigger',
  'triggers_compartidos',
  'perfil_servidor',
  'relaciones_federacion',
  'flujos_federacion',
  'identidad_contexto_agente',
  'identidades_telemetria',
  'identidades_monitores',
  'cabecera_sesion_tecnica',
  'sesiones_tecnicas',
  'ejecuciones_trigger'
]);

export class ErrorRepositorioEliminacionAdministrativaAgente extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorRepositorioEliminacionAdministrativaAgente';
    this.codigo = codigo;
  }
}

export class RepositorioEliminacionAdministrativaAgentesSql {
  constructor(clienteSql, {
    autoridadReservasJerarquicas =
      new AutoridadReservasJerarquicasOperacionesAdministrativasSql(clienteSql),
    repositorioPreparacionBajaEjecucionesCorreo =
      new RepositorioPreparacionBajaEjecucionesTriggerCorreoSql()
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El impacto de eliminación de agentes requiere ClienteSql.');
    }
    this.clienteSql = clienteSql;
    if (typeof autoridadReservasJerarquicas?.exigirDisponibilidadEnTransaccion !==
        'function') {
      throw new Error('La eliminación de agentes exige autoridad jerárquica.');
    }
    this.autoridadReservasJerarquicas = autoridadReservasJerarquicas;
    if (typeof repositorioPreparacionBajaEjecucionesCorreo
      ?.prepararPorMonitoresEnTransaccion !== 'function') {
      throw new Error('La eliminación de agentes exige preparar el histórico de correo.');
    }
    this.repositorioPreparacionBajaEjecucionesCorreo =
      repositorioPreparacionBajaEjecucionesCorreo;
  }

  async cargarImpactoEnTransaccion(
    { agenteId, bloquearRaiz = false } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const id = idDecimal(agenteId, 'agenteId');
    const agente = await cargarAgente(conexion, id, bloquearRaiz);
    if (!agente) {
      throw new ErrorRepositorioEliminacionAdministrativaAgente(
        'agente_eliminacion_no_encontrada',
        'No existe un agente eliminable dentro del alcance autorizado.'
      );
    }

    const reglas = await cargarReglas(conexion, id);
    const monitores = await cargarMonitores(conexion, id);
    const asignaciones = await cargarAsignaciones(conexion, id);
    const perfilesServidor = await cargarPerfilesServidor(conexion, id);
    const dependenciasFederadas = await cargarDependenciasFederadas(conexion, agente);
    const ddns = await cargarImpactoDdns(conexion, id);
    const conteos = await cargarConteos({
      conexion,
      agenteId: id,
      reglas,
      monitores,
      asignaciones,
      perfilesServidor,
      ddns
    });

    return Object.freeze({
      fotografiaCanonica: congelar({
        perfil: PERFIL_FOTOGRAFIA_CANONICA,
        version: 1,
        sujeto: {
          id: String(agente.id),
          guid: String(agente.guid),
          nombre: String(agente.nombre),
          descripcion: agente.descripcion === null ? null : String(agente.descripcion),
          estadoAdministrativo: String(agente.estado_administrativo),
          estadoAcceso: String(agente.estado_acceso),
          versionAgente: agente.ultima_version_agente === null
            ? null
            : String(agente.ultima_version_agente),
          scope: {
            nivel: 'sitio',
            tenantId: String(agente.tenant_id),
            empresaId: String(agente.empresa_id),
            sitioId: String(agente.sitio_id)
          }
        },
        reglas,
        monitores,
        asignacionesTrigger: asignaciones,
        perfilesServidor,
        dependenciasFederadas,
        ddns
      }),
      conteos: congelar(conteos)
    });
  }

  async cargarInventarioBloqueadoEnTransaccion(
    {
      operacionId,
      instanciaId,
      leaseToken,
      fencingToken
    } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const operacionPreliminar = await cargarOperacionPreliminar(conexion, {
      operacionId,
      instanciaId,
      leaseToken,
      fencingToken
    });
    if (!operacionPreliminar) {
      throw new LeaseOperacionDurablePerdido(
        'La eliminación perdió lease o fencing antes de resolver su autoridad.'
      );
    }
    const comandoPreliminar = crearComandoEliminacionAdministrativaAgente(
      json(operacionPreliminar.comando_canonico)
    );
    const agenteIdPreliminar = idDecimal(
      comandoPreliminar.sujeto.id,
      'comando.sujeto.id'
    );
    let resolucionAutoridad = null;
    try {
      resolucionAutoridad = await exigirAutoridadJerarquicaEstable(
        this.autoridadReservasJerarquicas,
        {
          recursos: [{ tipoRecurso: 'agente', recursoId: agenteIdPreliminar }],
          operacionPropietariaId: operacionId
        },
        conexion
      );
    } catch (error) {
      if (error?.codigo !== 'recurso_reserva_jerarquica_ausente') throw error;
    }
    if (resolucionAutoridad && !conservaReclamoPropioExacto(
      resolucionAutoridad,
      operacionId,
      agenteIdPreliminar
    )) {
      throw new ErrorRepositorioEliminacionAdministrativaAgente(
        'agente_eliminacion_impacto_no_seguro',
        'La autoridad no encontró el reclamo propio y exacto del agente.'
      );
    }
    const operacion = await bloquearOperacion(conexion, {
      operacionId,
      instanciaId,
      leaseToken,
      fencingToken
    }, { bloquear: resolucionAutoridad === null });
    if (!operacion) {
      throw new LeaseOperacionDurablePerdido(
        'La eliminación perdió lease o fencing antes de bloquear su inventario.'
      );
    }
    const comando = crearComandoEliminacionAdministrativaAgente(
      json(operacion.comando_canonico)
    );
    const agenteId = idDecimal(comando.sujeto.id, 'comando.sujeto.id');
    if (agenteId !== agenteIdPreliminar) {
      throw new ErrorRepositorioEliminacionAdministrativaAgente(
        'agente_eliminacion_impacto_no_seguro',
        'El sujeto de la operación cambió durante la adquisición de autoridad.'
      );
    }
    await bloquearReclamo(
      conexion,
      operacionId,
      agenteId,
      { bloquear: resolucionAutoridad === null }
    );
    const agente = await cargarAgente(conexion, agenteId, true);
    if (!agente) {
      return congelar({
        estado: 'agente_ausente',
        comando,
        fotografiaAdministrativa: null,
        impacto: null,
        ordenBloqueo: ORDEN_BLOQUEO_ELIMINACION_AGENTE
      });
    }
    await bloquearEstructuraAgente(conexion, agente);
    const impacto = await this.cargarImpactoEnTransaccion(
      { agenteId, bloquearRaiz: false },
      { conexion }
    );
    return congelar({
      estado: 'inventariado',
      comando,
      fotografiaAdministrativa: fotografiaAdministrativa(agente),
      impacto,
      ordenBloqueo: ORDEN_BLOQUEO_ELIMINACION_AGENTE
    });
  }

  async cargarDependenciasBloqueadasParaAgenteEnTransaccion(
    { agenteActual } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const agenteId = idDecimal(agenteActual?.id, 'agenteActual.id');
    const agente = await cargarAgente(conexion, agenteId, false);
    if (!agente || !coincideAgenteActual(agente, agenteActual)) {
      throw impactoNoSeguro(
        'El agente cambió después de adquirir el inventario organizativo.'
      );
    }
    const conjuntosBloqueados = await bloquearEstructuraAgente(conexion, agente);
    const impacto = await this.cargarImpactoEnTransaccion(
      { agenteId, bloquearRaiz: false },
      { conexion }
    );
    const fotografia = impacto.fotografiaCanonica;
    const monitores = fotografia.monitores.map(({ id }) => String(id));
    const reglas = fotografia.reglas.map(({ id }) => String(id));
    const concesionesDdnsInternas = fotografia.ddns.concesiones
      .map(({ idInterno }) => idInterno);
    const concesionesDdns = fotografia.ddns.concesiones
      .map(({ concesionId }) => concesionId);
    if (!mismosIds(reglas, conjuntosBloqueados.reglas) ||
        !mismosIds(monitores, conjuntosBloqueados.monitores) ||
        !mismosIds(concesionesDdnsInternas, conjuntosBloqueados.concesionesDdns)) {
      throw impactoNoSeguro(
        'Las dependencias del agente cambiaron durante su bloqueo.'
      );
    }
    return congelar({
      conteosFinales: impacto.conteos,
      conjuntosEstructurales: {
        reglas,
        monitores,
        asignacionesTrigger:
          fotografia.asignacionesTrigger.map(({ id }) => String(id)),
        triggersCompartidos: [...new Set(
          fotografia.asignacionesTrigger.map(({ triggerId }) => String(triggerId))
        )].sort(compararDecimales),
        perfilesServidor:
          fotografia.perfilesServidor.map(({ generacion }) => String(generacion)),
        dependenciasFederadas: fotografia.dependenciasFederadas.map(
          ({ familia, tipo, claveLocal, elementoOrigenId }) => ({
            familia,
            tipo,
            claveLocal,
            elementoOrigenId
          })
        ),
        concesionesDdns
      }
    });
  }

  async cargarContextoSesionBloqueadaEnTransaccion(
    { agenteId } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const id = idDecimal(agenteId, 'agenteId');
    const [filas] = await conexion.execute(
      `SELECT sesion_auditoria_id
         FROM agentes_sentinelia
        WHERE id=? FOR UPDATE`,
      [id]
    );
    if (!filas[0]) return null;
    return Object.freeze({
      agenteId: id,
      sesionAuditoriaIdBytes: filas[0].sesion_auditoria_id
        ? Buffer.from(filas[0].sesion_auditoria_id)
        : null
    });
  }

  async eliminarEjecucionesTriggersEnTransaccion(
    {
      monitorIds = [],
      cantidadEsperada,
      cantidadCorreoAceptadoEsperada = null
    } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const ids = [...new Set(monitorIds.map((id) => idDecimal(id, 'monitorId')))]
      .sort(compararDecimales);
    return this.repositorioPreparacionBajaEjecucionesCorreo
      .prepararPorMonitoresEnTransaccion(ids, {
        conexion,
        eliminarNoCorreo: true,
        cantidadEsperada: cantidad(cantidadEsperada),
        cantidadCorreoAceptadoEsperada:
          cantidad(cantidadCorreoAceptadoEsperada)
      });
  }

  async eliminarRaizEnTransaccion(
    { agenteId } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const id = idDecimal(agenteId, 'agenteId');
    const [resultado] = await conexion.execute(
      'DELETE FROM agentes_sentinelia WHERE id=?',
      [id]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw impactoNoSeguro(
        'El DELETE raíz no afectó exactamente al agente inventariado.'
      );
    }
    const [filasInstante] = await conexion.execute(
      'SELECT UTC_TIMESTAMP(3) AS efectivo_en_utc'
    );
    return Object.freeze({
      agenteId: id,
      eliminadas: '1',
      efectivoEnUtc: fechaUtcSql(filasInstante[0]?.efectivo_en_utc)
    });
  }

  async verificarPostcondicionesEliminacionEnTransaccion(
    { lease, preparacion } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const agenteId = idDecimal(preparacion?.sujeto?.id, 'preparacion.sujeto.id');
    const operacion = await bloquearOperacion(conexion, lease || {});
    if (!operacion) {
      throw new LeaseOperacionDurablePerdido(
        'La eliminación perdió lease o fencing antes de validar sus postcondiciones.'
      );
    }
    const conjuntos = preparacion.conjuntosEstructurales;
    const conteos = {
      raiz: await contar(conexion, 'agentes_sentinelia', 'id', [agenteId]),
      agregadoFk: await contarAgregadoFk(conexion, agenteId),
      revisionesReglas: await contarPorIds(
        conexion,
        'revisiones_reglas_derivacion_telemetria',
        'regla_id',
        conjuntos.reglas
      ),
      monitores: await contarPorIds(
        conexion,
        'monitores',
        'id',
        conjuntos.monitores
      ),
      asignacionesTrigger: await contarPorIds(
        conexion,
        'asignaciones_triggers_monitores',
        'id',
        conjuntos.asignacionesTrigger
      ),
      dependenciasMonitores: await contarDependenciasMonitores(
        conexion,
        conjuntos.monitores
      ),
      ejecucionesTrigger: await contarPorIds(
        conexion,
        'ejecuciones_triggers',
        'monitor_id',
        conjuntos.monitores
      ),
      correoAceptadoPreservadas: await contarEjecucionesPreservadas(
        conexion,
        preparacion.ejecucionesTriggers?.idsCorreoAceptadoPreservadas || []
      ),
      triggersCompartidos: await contarPorIds(
        conexion,
        'triggers',
        'id',
        conjuntos.triggersCompartidos
      ),
      identidadesFederadasVigentes: await contarIdentidadesFederadasVigentes(
        conexion,
        agenteId,
        conjuntos.monitores
      ),
      obligacionesPostcommit: await contarObligacionesOperacion(
        conexion,
        lease.operacionId
      ),
      sesionesLoginRefreshNoTerminales: await contarSesionesNoTerminales(
        conexion,
        agenteId
      ),
      retiradasSesionReemplazadas: await contarOperacionesSesionEnEstado(
        conexion,
        preparacion.neutralizacionSesion.retiradasPendientes
          .map(({ operacionId }) => operacionId),
        'reemplazada'
      ),
      invalidacionSesionPendiente: await contarInvalidacionEsperada(
        conexion,
        preparacion.neutralizacionSesion.operacion
      ),
      cabeceraSesion: await contarCabeceraSesion(
        conexion,
        agenteId,
        preparacion.neutralizacionSesion.fencingToken
      ),
      reclamoAdministrativo: await contarReclamoActivo(
        conexion,
        lease.operacionId,
        agenteId
      ),
      concesionesDdnsVinculadas: await contar(
        conexion,
        'concesiones_ddns_agentes',
        'agente_id',
        [agenteId]
      ),
      causasPolDdnsNoConvertidas: await contarCausasPolDdnsNoConvertidas(
        conexion,
        agenteId
      )
    };
    exigirCero(conteos.raiz, 'raíz de agente');
    exigirCero(conteos.agregadoFk, 'dependencias locales con FK');
    exigirCero(conteos.revisionesReglas, 'revisiones de reglas');
    exigirCero(conteos.monitores, 'monitores propios');
    exigirCero(conteos.asignacionesTrigger, 'asignaciones de triggers');
    exigirCero(conteos.dependenciasMonitores, 'dependencias de monitores');
    exigirCero(conteos.ejecucionesTrigger, 'ejecuciones de triggers');
    exigirIgual(
      conteos.correoAceptadoPreservadas,
      preparacion.postcondicionesEsperadas.correoAceptadoPreservadas,
      'ejecuciones de correo aceptadas preservadas y desvinculadas'
    );
    exigirCero(
      conteos.identidadesFederadasVigentes,
      'identidades federadas todavía vigentes'
    );
    exigirCero(
      conteos.sesionesLoginRefreshNoTerminales,
      'login o refresh todavía ejecutables'
    );
    exigirCero(
      conteos.concesionesDdnsVinculadas,
      'concesiones DDNS todavía vinculadas al agente'
    );
    exigirCero(
      conteos.causasPolDdnsNoConvertidas,
      'causas POL DDNS no convertidas'
    );
    exigirIgual(
      conteos.triggersCompartidos,
      String(conjuntos.triggersCompartidos.length),
      'definiciones compartidas de triggers'
    );
    exigirIgual(
      conteos.obligacionesPostcommit,
      preparacion.postcondicionesEsperadas.obligacionesPostcommit,
      'obligaciones postcommit'
    );
    exigirIgual(
      conteos.retiradasSesionReemplazadas,
      String(preparacion.neutralizacionSesion.retiradasPendientes.length),
      'operaciones de sesión reemplazadas'
    );
    exigirIgual(
      conteos.invalidacionSesionPendiente,
      preparacion.neutralizacionSesion.operacion ? '1' : '0',
      'invalidación durable de sesión'
    );
    exigirIgual(conteos.cabeceraSesion, '1', 'cabecera de sesión con fencing');
    exigirIgual(conteos.reclamoAdministrativo, '1', 'reclamo administrativo');
    return congelar({
      verificadas: true,
      agenteId,
      fencingOperacion: String(lease.fencingToken),
      fencingSesion: String(preparacion.neutralizacionSesion.fencingToken),
      conteos
    });
  }
}

function fechaUtcSql(valor) {
  const candidato = valor instanceof Date
    ? valor
    : new Date(`${String(valor || '').replace(/Z$/u, '')}Z`);
  if (Number.isNaN(candidato.getTime())) {
    throw new Error('MariaDB no devolvió el instante efectivo del DELETE raíz.');
  }
  return candidato.toISOString();
}

const TABLAS_AGREGADO_FK = Object.freeze([
  'periodos_vida_pol_agentes',
  'senales_telemetria_agentes',
  'observaciones_telemetria_agentes',
  'estado_actual_telemetria_agentes',
  'reglas_derivacion_telemetria',
  'estado_actual_evaluacion_reglas_telemetria',
  'eventos_derivados_telemetria',
  'trabajos_evaluacion_telemetria',
  'perfiles_servidor_agentes',
  'estados_runtime_servidor_agentes',
  'transiciones_runtime_servidor_agentes',
  'lotes_idempotentes_telemetria_agentes',
  'vinculos_monitores_telemetria'
]);

async function cargarAgente(conexion, agenteId, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT id,guid,nombre,descripcion,estado_administrativo,estado_acceso,
            ultima_version_agente,
            tenant_id,empresa_id,sitio_id
       FROM agentes_sentinelia WHERE id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [agenteId]
  );
  return filas[0] || null;
}

function coincideAgenteActual(fila, actual) {
  return String(fila.id) === String(actual?.id) &&
    String(fila.guid) === String(actual?.guid) &&
    String(fila.tenant_id) === String(actual?.scope?.tenantId) &&
    String(fila.empresa_id) === String(actual?.scope?.empresaId) &&
    String(fila.sitio_id) === String(actual?.scope?.sitioId);
}

function mismosIds(a, b) {
  const izquierda = [...a].map(String).sort(compararDecimales);
  const derecha = [...b].map(String).sort(compararDecimales);
  return izquierda.length === derecha.length &&
    izquierda.every((id, indice) => id === derecha[indice]);
}

async function contarAgregadoFk(conexion, agenteId) {
  let total = 0n;
  for (const tabla of TABLAS_AGREGADO_FK) {
    total += BigInt(await contar(conexion, tabla, 'agente_id', [agenteId]));
  }
  return total.toString();
}

async function contar(conexion, tabla, columna, valores) {
  identificadorSeguro(tabla);
  identificadorSeguro(columna);
  const unicos = [...new Set(valores.map(String))];
  if (unicos.length === 0) return '0';
  const placeholders = unicos.map(() => '?').join(',');
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total FROM ${tabla} WHERE ${columna} IN (${placeholders})`,
    unicos
  );
  return cantidad(fila.total);
}

async function contarCausasPolDdnsNoConvertidas(conexion, agenteId) {
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total FROM causas_pol_ddns p
      WHERE p.agente_id_fotografia=?
        AND p.estado IN ('pendiente','procesando','reintentable')
        AND NOT EXISTS (
          SELECT 1 FROM intenciones_ddns_agentes i
           WHERE i.causa_tipo='pol' AND i.causa_id=p.causa_id
        )`,
    [agenteId]
  );
  return cantidad(fila?.total || 0);
}

function contarPorIds(conexion, tabla, columna, ids) {
  return contar(conexion, tabla, columna, ids);
}

async function contarDependenciasMonitores(conexion, monitorIds) {
  const tablas = [
    'estado_actual_monitores',
    'eventos_monitores',
    'alertas_activas_monitores',
    'historico_monitores'
  ];
  let total = 0n;
  for (const tabla of tablas) {
    total += BigInt(await contar(conexion, tabla, 'monitor_id', monitorIds));
  }
  return total.toString();
}

async function contarEjecucionesPreservadas(conexion, ids) {
  const normalizados = ids.map((id) => idDecimal(id, 'ejecucionTriggerId'));
  if (normalizados.length === 0) return '0';
  const placeholders = normalizados.map(() => '?').join(',');
  const [[fila]] = await conexion.execute(`
    SELECT COUNT(*) total
      FROM ejecuciones_triggers
     WHERE id IN (${placeholders})
       AND monitor_id IS NULL
       AND asignacion_trigger_monitor_id IS NULL
  `, normalizados);
  return cantidad(fila.total);
}

async function contarIdentidadesFederadasVigentes(
  conexion,
  agenteId,
  monitorIds
) {
  const [[telemetria]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM identidades_elementos_telemetria_federacion
      WHERE agente_id_local=? AND estado='vigente'`,
    [agenteId]
  );
  const [[contexto]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM identidades_contexto_operativo_agentes_federacion
      WHERE agente_id_local=? AND estado='vigente'`,
    [agenteId]
  );
  const monitores = monitorIds.length === 0
    ? '0'
    : await contarIdentidadesMonitoresVigentes(conexion, monitorIds);
  return (
    BigInt(cantidad(telemetria.total)) +
    BigInt(cantidad(contexto.total)) +
    BigInt(monitores)
  ).toString();
}

async function contarIdentidadesMonitoresVigentes(conexion, monitorIds) {
  const placeholders = monitorIds.map(() => '?').join(',');
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM identidades_elementos_monitores_federacion
      WHERE monitor_id_local IN (${placeholders}) AND estado='vigente'`,
    monitorIds
  );
  return cantidad(fila.total);
}

async function contarObligacionesOperacion(conexion, operacionId) {
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM obligaciones_postcommit_operaciones_administrativas
      WHERE operacion_id=?`,
    [uuidV7AuditoriaABytes(operacionId)]
  );
  return cantidad(fila.total);
}

async function contarSesionesNoTerminales(conexion, agenteId) {
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM operaciones_sesion_agentes
      WHERE agente_id=? AND tipo IN ('login','refresh')
        AND estado IN ('pendiente','redis_preparada','respuesta_pendiente')`,
    [agenteId]
  );
  return cantidad(fila.total);
}

async function contarOperacionesSesionEnEstado(conexion, operacionIds, estado) {
  if (operacionIds.length === 0) return '0';
  const placeholders = operacionIds.map(() => '?').join(',');
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM operaciones_sesion_agentes
      WHERE operacion_id IN (${placeholders}) AND estado=?`,
    [...operacionIds.map((id) => uuidV7AuditoriaABytes(id)), estado]
  );
  return cantidad(fila.total);
}

async function contarInvalidacionEsperada(conexion, operacion) {
  if (!operacion) return '0';
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM operaciones_sesion_agentes
      WHERE operacion_id=? AND tipo='invalidacion' AND estado='pendiente'
        AND fencing_token=?`,
    [uuidV7AuditoriaABytes(operacion.operacionId), operacion.fencingToken]
  );
  return cantidad(fila.total);
}

async function contarCabeceraSesion(conexion, agenteId, fencingToken) {
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM cabeceras_coordinacion_sesion_agentes
      WHERE agente_id=? AND fencing_token=?`,
    [agenteId, decimalPositivo(fencingToken, 'fencingTokenSesion')]
  );
  return cantidad(fila.total);
}

async function contarReclamoActivo(conexion, operacionId, agenteId) {
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM recursos_operaciones_administrativas
      WHERE operacion_id=? AND tipo_recurso='agente' AND recurso_id=?
        AND estado_reclamo='activo'`,
    [uuidV7AuditoriaABytes(operacionId), agenteId]
  );
  return cantidad(fila.total);
}

function exigirCero(actual, descripcion) {
  exigirIgual(actual, '0', descripcion);
}

function exigirIgual(actual, esperado, descripcion) {
  if (String(actual) !== String(esperado)) {
    throw impactoNoSeguro(
      `La postcondición de ${descripcion} esperaba ${esperado} y encontró ${actual}.`
    );
  }
}

function identificadorSeguro(valor) {
  if (!/^[a-z][a-z0-9_]*$/u.test(String(valor))) {
    throw new TypeError('El identificador SQL de postcondición no es seguro.');
  }
}

async function bloquearOperacion(conexion, {
  operacionId,
  instanciaId,
  leaseToken,
  fencingToken
}, { bloquear = true } = {}) {
  const [filas] = await conexion.execute(
    `SELECT comando_canonico
       FROM operaciones_administrativas
      WHERE operacion_id=? AND tipo='eliminar_agente' AND version_contrato=1
        AND estado='ejecutando' AND fase='preparacion' AND instancia_id=?
        AND lease_token=? AND fencing_token=?
        AND lease_expira_utc>UTC_TIMESTAMP(3)
      ${bloquear ? 'FOR UPDATE' : ''}`,
    [
      uuidV7AuditoriaABytes(operacionId),
      ascii(instanciaId, 128, 'instanciaId'),
      tokenLease(leaseToken),
      decimalPositivo(fencingToken, 'fencingToken')
    ]
  );
  return filas[0] || null;
}

async function cargarOperacionPreliminar(conexion, {
  operacionId,
  instanciaId,
  leaseToken,
  fencingToken
}) {
  const [filas] = await conexion.execute(
    `SELECT comando_canonico
       FROM operaciones_administrativas
      WHERE operacion_id=? AND tipo='eliminar_agente' AND version_contrato=1
        AND estado='ejecutando' AND fase='preparacion' AND instancia_id=?
        AND lease_token=? AND fencing_token=?
        AND lease_expira_utc>UTC_TIMESTAMP(3)`,
    [
      uuidV7AuditoriaABytes(operacionId),
      ascii(instanciaId, 128, 'instanciaId'),
      tokenLease(leaseToken),
      decimalPositivo(fencingToken, 'fencingToken')
    ]
  );
  return filas[0] || null;
}

async function exigirAutoridadJerarquicaEstable(autoridad, entrada, conexion) {
  try {
    return await autoridad.exigirDisponibilidadEnTransaccion(
      entrada,
      { conexion }
    );
  } catch (error) {
    if (error?.codigo !== 'ruta_reserva_jerarquica_modificada') throw error;
    return autoridad.exigirDisponibilidadEnTransaccion(entrada, { conexion });
  }
}

function conservaReclamoPropioExacto(resolucion, operacionId, agenteId) {
  return resolucion.reclamosPropios?.some((reclamo) =>
    reclamo.operacionId === String(operacionId) &&
    reclamo.recurso?.tipoRecurso === 'agente' &&
    reclamo.recurso?.recursoId === String(agenteId)
  );
}

async function bloquearReclamo(
  conexion,
  operacionId,
  agenteId,
  { bloquear = true } = {}
) {
  const [filas] = await conexion.execute(
    `SELECT tipo_recurso,recurso_id,estado_reclamo
       FROM recursos_operaciones_administrativas
      WHERE operacion_id=?
      ORDER BY tipo_recurso,recurso_id
      ${bloquear ? 'FOR UPDATE' : ''}`,
    [uuidV7AuditoriaABytes(operacionId)]
  );
  if (
    filas.length !== 1 ||
    filas[0].tipo_recurso !== 'agente' ||
    String(filas[0].recurso_id) !== agenteId ||
    filas[0].estado_reclamo !== 'activo'
  ) {
    throw new ErrorRepositorioEliminacionAdministrativaAgente(
      'agente_eliminacion_impacto_no_seguro',
      'La operación no conserva el reclamo activo y exclusivo de su agente.'
    );
  }
}

async function bloquearEstructuraAgente(conexion, agente) {
  const agenteId = String(agente.id);
  const concesionesDdns = await bloquearIds(
    conexion,
    `SELECT id FROM concesiones_ddns_agentes
      WHERE agente_id=? ORDER BY id FOR UPDATE`,
    [agenteId]
  );
  await bloquearPorIds(
    conexion,
    'SELECT id FROM intenciones_ddns_agentes',
    'concesion_interna_id',
    concesionesDdns
  );
  await bloquearPorIds(
    conexion,
    'SELECT id FROM intentos_publicacion_ddns',
    'concesion_interna_id',
    concesionesDdns
  );
  await bloquearIds(
    conexion,
    `SELECT causa_id AS id FROM causas_pol_ddns
      WHERE agente_id_fotografia=?
      ORDER BY causa_id FOR UPDATE`,
    [agenteId]
  );
  const reglas = await bloquearIds(
    conexion,
    `SELECT id FROM reglas_derivacion_telemetria
      WHERE agente_id=? ORDER BY id FOR UPDATE`,
    [agenteId]
  );
  await bloquearIds(
    conexion,
    `SELECT rv.id
       FROM revisiones_reglas_derivacion_telemetria rv
       INNER JOIN reglas_derivacion_telemetria r ON r.id=rv.regla_id
      WHERE r.agente_id=? ORDER BY rv.id FOR UPDATE`,
    [agenteId]
  );
  const monitores = await bloquearIds(
    conexion,
    `SELECT m.id
       FROM vinculos_monitores_telemetria v
       INNER JOIN monitores m ON m.id=v.monitor_id
      WHERE v.agente_id=? ORDER BY m.id FOR UPDATE`,
    [agenteId]
  );
  await bloquearPorIds(
    conexion,
    'SELECT id FROM asignaciones_triggers_monitores',
    'monitor_id',
    monitores
  );
  const triggersCompartidos = await seleccionarPorIds(
    conexion,
    'SELECT trigger_id AS id FROM asignaciones_triggers_monitores',
    'monitor_id',
    monitores,
    'trigger_id'
  );
  await bloquearPorIds(
    conexion,
    'SELECT id FROM triggers',
    'id',
    [...new Set(triggersCompartidos)]
  );
  await bloquearIds(
    conexion,
    `SELECT agente_id
       FROM perfiles_servidor_agentes
      WHERE agente_id=? ORDER BY generacion FOR UPDATE`,
    [agenteId]
  );

  const parametrosScope = parametrosScopeAgente(agente);
  const relaciones = await seleccionarIds(
    conexion,
    `SELECT DISTINCT HEX(f.relacion_id) AS id
       FROM flujos_federacion f
      WHERE f.direccion='emision'
        AND f.familia IN ('telemetria','monitores','contextoOperativoAgentesSesiones')
        AND ${FILTRO_SCOPE_FLUJO}
      ORDER BY id`,
    parametrosScope
  );
  await bloquearPorIds(
    conexion,
    'SELECT relacion_id AS id FROM relaciones_federacion',
    'HEX(relacion_id)',
    [...new Set(relaciones)]
  );
  await bloquearIds(
    conexion,
    `SELECT flujo_id AS id
       FROM flujos_federacion
      WHERE direccion='emision'
        AND familia IN ('telemetria','monitores','contextoOperativoAgentesSesiones')
        AND ${FILTRO_SCOPE_FLUJO}
      ORDER BY flujo_id FOR UPDATE`,
    parametrosScope
  );
  await bloquearIds(
    conexion,
    `SELECT agente_id_local AS id
       FROM identidades_contexto_operativo_agentes_federacion
      WHERE agente_id_local=? ORDER BY agente_id_local FOR UPDATE`,
    [agenteId]
  );
  await bloquearIds(
    conexion,
    `SELECT clave_local AS id
       FROM identidades_elementos_telemetria_federacion
      WHERE agente_id_local=?
      ORDER BY tipo_elemento,clave_local,elemento_origen_id FOR UPDATE`,
    [agenteId]
  );
  await bloquearPorIds(
    conexion,
    'SELECT clave_local AS id FROM identidades_elementos_monitores_federacion',
    'monitor_id_local',
    monitores,
    'tipo_elemento,clave_local,elemento_origen_id'
  );
  await conexion.execute(
    `INSERT IGNORE INTO cabeceras_coordinacion_sesion_agentes (
       agente_id,fencing_token,creada_en_utc,actualizada_en_utc
     ) VALUES (?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [agenteId]
  );
  await bloquearIds(
    conexion,
    `SELECT agente_id AS id
       FROM cabeceras_coordinacion_sesion_agentes
      WHERE agente_id=? ORDER BY agente_id FOR UPDATE`,
    [agenteId]
  );
  await bloquearIds(
    conexion,
    `SELECT operacion_id AS id
       FROM operaciones_sesion_agentes
      WHERE agente_id=? ORDER BY operacion_id FOR UPDATE`,
    [agenteId]
  );
  await bloquearPorIds(
    conexion,
    'SELECT id FROM ejecuciones_triggers',
    'monitor_id',
    monitores
  );

  return Object.freeze({ reglas, monitores, concesionesDdns });
}

async function seleccionarIds(conexion, sql, parametros) {
  const [filas] = await conexion.execute(sql, parametros);
  return filas.map((fila) => String(fila.id));
}

async function seleccionarPorIds(
  conexion,
  seleccion,
  columna,
  ids,
  orden = 'id'
) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return seleccionarIds(
    conexion,
    `${seleccion} WHERE ${columna} IN (${placeholders}) ORDER BY ${orden}`,
    ids
  );
}

async function bloquearIds(conexion, sql, parametros) {
  return seleccionarIds(conexion, sql, parametros);
}

async function bloquearPorIds(
  conexion,
  seleccion,
  columna,
  ids,
  orden = 'id'
) {
  if (ids.length === 0) {
    return bloquearIds(
      conexion,
      `${seleccion} WHERE 1=0 ORDER BY ${orden} FOR UPDATE`,
      []
    );
  }
  const placeholders = ids.map(() => '?').join(',');
  return bloquearIds(
    conexion,
    `${seleccion} WHERE ${columna} IN (${placeholders}) ORDER BY ${orden} FOR UPDATE`,
    ids
  );
}

const FILTRO_SCOPE_FLUJO = `(
  scope_nivel='portal'
  OR (scope_nivel='tenant' AND scope_tenant_id=?)
  OR (scope_nivel='empresa' AND scope_tenant_id=? AND scope_empresa_id=?)
  OR (scope_nivel='sitio' AND scope_tenant_id=?
      AND scope_empresa_id=? AND scope_sitio_id=?)
)`;

function parametrosScopeAgente(agente) {
  return [
    agente.tenant_id,
    agente.tenant_id,
    agente.empresa_id,
    agente.tenant_id,
    agente.empresa_id,
    agente.sitio_id
  ];
}

function fotografiaAdministrativa(agente) {
  return {
    id: String(agente.id),
    guid: String(agente.guid),
    nombre: String(agente.nombre),
    descripcion: agente.descripcion === null ? null : String(agente.descripcion),
    estadoAdministrativo: String(agente.estado_administrativo),
    estadoAcceso: String(agente.estado_acceso),
    versionAgente: agente.ultima_version_agente === null
      ? null
      : String(agente.ultima_version_agente),
    scope: {
      nivel: 'sitio',
      tenantId: String(agente.tenant_id),
      empresaId: String(agente.empresa_id),
      sitioId: String(agente.sitio_id)
    }
  };
}

async function cargarReglas(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT r.id,r.estado,r.revision_vigente_id,
            rv.numero,rv.condicion_tipo,rv.condicion_version,
            rv.condicion_canonica,rv.severidad_calculada,
            rv.mensaje_operativo,rv.nombre,rv.descripcion,
            rv.metadatos_descriptivos
       FROM reglas_derivacion_telemetria r
       LEFT JOIN revisiones_reglas_derivacion_telemetria rv
         ON rv.id=r.revision_vigente_id AND rv.regla_id=r.id
      WHERE r.agente_id=? ORDER BY r.id`,
    [agenteId]
  );
  return filas.map((fila) => ({
    id: String(fila.id),
    estado: String(fila.estado),
    revisionVigenteId: opcional(fila.revision_vigente_id),
    revision: fila.revision_vigente_id === null ? null : {
      numero: String(fila.numero),
      condicionTipo: String(fila.condicion_tipo),
      condicionVersion: String(fila.condicion_version),
      condicion: json(fila.condicion_canonica),
      severidad: String(fila.severidad_calculada),
      mensaje: String(fila.mensaje_operativo),
      nombre: String(fila.nombre),
      descripcion: fila.descripcion === null ? null : String(fila.descripcion),
      metadatos: jsonOpcional(fila.metadatos_descriptivos)
    }
  }));
}

async function cargarMonitores(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT m.id,m.tipo,m.activo,m.configuracion,
            v.tipo_fuente,v.senal_id,v.regla_id
       FROM vinculos_monitores_telemetria v
       INNER JOIN monitores m ON m.id=v.monitor_id
      WHERE v.agente_id=? ORDER BY m.id`,
    [agenteId]
  );
  return filas.map((fila) => ({
    id: String(fila.id),
    tipo: String(fila.tipo),
    activo: Boolean(fila.activo),
    configuracion: jsonOpcional(fila.configuracion),
    fuente: {
      tipo: String(fila.tipo_fuente),
      senalId: opcional(fila.senal_id),
      reglaId: opcional(fila.regla_id)
    }
  }));
}

async function cargarAsignaciones(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT a.id,a.monitor_id,a.trigger_id
       FROM asignaciones_triggers_monitores a
       INNER JOIN vinculos_monitores_telemetria v ON v.monitor_id=a.monitor_id
      WHERE v.agente_id=? ORDER BY a.id`,
    [agenteId]
  );
  return filas.map((fila) => ({
    id: String(fila.id),
    monitorId: String(fila.monitor_id),
    triggerId: String(fila.trigger_id)
  }));
}

async function cargarPerfilesServidor(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT agente_id,generacion,estado,histeresis_sin_pol_segundos,
            duracion_reinicio_reciente_segundos,version_estado
       FROM perfiles_servidor_agentes
      WHERE agente_id=? ORDER BY generacion`,
    [agenteId]
  );
  return filas.map((fila) => ({
    generacion: String(fila.generacion),
    estado: String(fila.estado),
    histeresisSinPolSegundos: String(fila.histeresis_sin_pol_segundos),
    duracionReinicioRecienteSegundos:
      String(fila.duracion_reinicio_reciente_segundos),
    versionEstado: String(fila.version_estado)
  }));
}

async function cargarDependenciasFederadas(conexion, agente) {
  const agenteId = String(agente.id);
  const [filas] = await conexion.execute(
    `SELECT familia,tipo_elemento,clave_local,elemento_origen_id,estado,
            version_registro
       FROM (
         SELECT CAST('contextoAgente' AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin AS familia,
                CAST('fuente' AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin AS tipo_elemento,
                CAST(agente_id_local AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin AS clave_local,
                CAST(elemento_origen_id AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin AS elemento_origen_id,
                CAST(estado AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin AS estado,
                CAST(version_registro AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin AS version_registro
           FROM identidades_contexto_operativo_agentes_federacion
          WHERE agente_id_local=?
         UNION ALL
         SELECT CAST('telemetria' AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.tipo_elemento AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.clave_local AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.elemento_origen_id AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.estado AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.version_registro AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin
           FROM identidades_elementos_telemetria_federacion i
          WHERE i.agente_id_local=?
            AND i.tipo_elemento IN (
              'fuente','reglaDerivacion','revisionReglaDerivacion'
            )
         UNION ALL
         SELECT CAST('monitores' AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.tipo_elemento AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.clave_local AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.elemento_origen_id AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.estado AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(i.version_registro AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin
           FROM identidades_elementos_monitores_federacion i
           INNER JOIN vinculos_monitores_telemetria v
             ON v.monitor_id=i.monitor_id_local
          WHERE v.agente_id=?
            AND i.tipo_elemento IN ('definicion','referenciaTrigger')
         UNION ALL
         SELECT CAST('flujoFederacion' AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(f.familia AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(CONCAT(
                  f.flujo_id,':',COALESCE(f.generacion_activa_id,'sin-generacion')
                ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin,
                CAST(f.relacion_id AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_bin,
                CAST(CONCAT(
                  f.estado,':',r.estado_ciclo,':',r.estado_autoridad,':',
                  r.estado_identidad,':',
                  COALESCE(r.estado_compatibilidad,'sin-compatibilidad')
                ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin,
                CAST(CONCAT(
                  f.version_registro,':',f.version_estado,':',
                  f.version_propietario,':',r.revision,':',r.version_autoridad
                ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin
           FROM flujos_federacion f
           INNER JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
          WHERE f.direccion='emision'
            AND f.familia IN ('telemetria','monitores','contextoOperativoAgentesSesiones')
            AND (
              f.scope_nivel='portal'
              OR (f.scope_nivel='tenant' AND f.scope_tenant_id=?)
              OR (f.scope_nivel='empresa' AND f.scope_tenant_id=?
                  AND f.scope_empresa_id=?)
              OR (f.scope_nivel='sitio' AND f.scope_tenant_id=?
                  AND f.scope_empresa_id=? AND f.scope_sitio_id=?)
            )
       ) dependencias
      ORDER BY familia,tipo_elemento,clave_local,elemento_origen_id`,
    [
      agenteId, agenteId, agenteId,
      agente.tenant_id,
      agente.tenant_id, agente.empresa_id,
      agente.tenant_id, agente.empresa_id, agente.sitio_id
    ]
  );
  return filas.map((fila) => ({
    familia: String(fila.familia),
    tipo: String(fila.tipo_elemento),
    claveLocal: String(fila.clave_local),
    elementoOrigenId: String(fila.elemento_origen_id),
    estado: String(fila.estado),
    version: String(fila.version_registro)
  }));
}

async function cargarConteos({
  conexion,
  agenteId,
  reglas,
  monitores,
  asignaciones,
  perfilesServidor,
  ddns
}) {
  const exactosSql = await consultarFila(conexion,
    `SELECT
       (SELECT COUNT(*) FROM operaciones_sesion_agentes WHERE agente_id=?) sesiones,
       (SELECT COUNT(*) FROM operaciones_sesion_agentes
         WHERE agente_id=? AND tipo IN ('login','refresh')
           AND estado IN ('pendiente','redis_preparada','respuesta_pendiente'))
         sesiones_retirables,
       (SELECT COUNT(*) FROM agentes_sentinelia
         WHERE id=? AND sesion_auditoria_id IS NOT NULL) sesion_actual,
       (SELECT COUNT(DISTINCT a.trigger_id)
          FROM asignaciones_triggers_monitores a
          INNER JOIN vinculos_monitores_telemetria v ON v.monitor_id=a.monitor_id
         WHERE v.agente_id=?) referencias`,
    [agenteId, agenteId, agenteId, agenteId]
  );
  const identidadesFederadas = await contarIdentidadesFederadas(conexion, agenteId);
  const historicos = await cargarConteosHistoricosAcotados(conexion, agenteId);
  const sesiones = cantidad(exactosSql.sesiones);
  const obligaciones = BigInt(1) +
    (monitores.length > 0 ? 1n : 0n) +
    (BigInt(perfilesServidor.length) * 2n) +
    BigInt(cantidad(exactosSql.sesiones_retirables)) +
    BigInt(cantidad(exactosSql.sesion_actual));
  const exacta = (categoria, valor) => ({
    categoria,
    cantidad: cantidad(valor),
    precision: 'exacta'
  });
  return [
    exacta('agente', 1),
    exacta('reglas', reglas.length),
    exacta('monitores', monitores.length),
    exacta('asignaciones_trigger', asignaciones.length),
    exacta('perfil_servidor', perfilesServidor.length),
    exacta('sesiones_tecnicas', sesiones),
    exacta('identidades_federadas', identidadesFederadas),
    exacta('concesiones_ddns', ddns.concesiones.length),
    exacta('intenciones_ddns_aceptadas', ddns.intencionesAceptadas),
    exacta('causas_pol_ddns_pendientes', ddns.causasPolPendientes),
    ...historicos,
    exacta('referencias_compartidas', exactosSql.referencias),
    exacta('obligaciones_postcommit', obligaciones)
  ].sort((a, b) => a.categoria.localeCompare(b.categoria));
}

export async function cargarConteosHistoricosAcotados(conexion, agenteId) {
  const correoPreservado = `e.tipo_trigger='correo' AND (
    EXISTS (
      SELECT 1 FROM notificaciones_triggers_correo n
       WHERE n.ejecucion_trigger_id=e.id
    ) OR JSON_UNQUOTE(JSON_EXTRACT(
      e.payload_respuesta,
      '$.detalle_correo_estado'
    ))='purgado'
  )`;
  const selecciones = {
    senales: ['SELECT 1 FROM senales_telemetria_agentes WHERE agente_id=?'],
    observaciones: ['SELECT 1 FROM observaciones_telemetria_agentes WHERE agente_id=?'],
    pol: ['SELECT 1 FROM periodos_vida_pol_agentes WHERE agente_id=?'],
    estados_actuales: [
      'SELECT 1 FROM estado_actual_telemetria_agentes WHERE agente_id=?',
      'SELECT 1 FROM estado_actual_evaluacion_reglas_telemetria WHERE agente_id=?',
      'SELECT 1 FROM estados_runtime_servidor_agentes WHERE agente_id=?',
      `SELECT 1 FROM estado_actual_monitores em
        INNER JOIN vinculos_monitores_telemetria v ON v.monitor_id=em.monitor_id
       WHERE v.agente_id=?`
    ],
    eventos: [
      'SELECT 1 FROM eventos_derivados_telemetria WHERE agente_id=?',
      'SELECT 1 FROM transiciones_runtime_servidor_agentes WHERE agente_id=?',
      `SELECT 1 FROM eventos_monitores em
        INNER JOIN vinculos_monitores_telemetria v ON v.monitor_id=em.monitor_id
       WHERE v.agente_id=?`
    ],
    ejecuciones_trigger: [
      `SELECT 1 FROM ejecuciones_triggers e
        INNER JOIN vinculos_monitores_telemetria v ON v.monitor_id=e.monitor_id
       WHERE v.agente_id=? AND NOT (${correoPreservado})`
    ],
    correo_aceptado_preservadas: [
      `SELECT 1 FROM ejecuciones_triggers e
        INNER JOIN vinculos_monitores_telemetria v ON v.monitor_id=e.monitor_id
       WHERE v.agente_id=? AND ${correoPreservado}`
    ]
  };
  const conteos = [];
  for (const [categoria, consultas] of Object.entries(selecciones)) {
    let total = 0n;
    for (const seleccion of consultas) {
      const restante = LIMITE_LECTURA_HISTORICO - total;
      if (restante <= 0n) break;
      const fila = await consultarFila(conexion,
        `SELECT COUNT(*) cantidad FROM (${seleccion} LIMIT ${restante}) impacto_acotado`,
        [agenteId]
      );
      total += BigInt(cantidad(fila.cantidad));
    }
    const superaLimite = total > LIMITE_CONTEO_HISTORICO;
    conteos.push({
      categoria,
      cantidad: String(superaLimite ? LIMITE_CONTEO_HISTORICO : total),
      precision: superaLimite ? 'estimada' : 'exacta'
    });
  }
  return conteos;
}

async function cargarImpactoDdns(conexion, agenteId) {
  const [concesiones] = await conexion.execute(
    `SELECT c.id,c.concesion_id,c.estado,c.registro_dns_id_fotografia,
            CAST(c.version_ddns AS CHAR) version_ddns,
            i.terminal
       FROM concesiones_ddns_agentes c
       LEFT JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
      WHERE c.agente_id=? ORDER BY c.id`,
    [agenteId]
  );
  const [[causas]] = await conexion.execute(
    `SELECT COUNT(*) total FROM causas_pol_ddns p
      WHERE p.agente_id_fotografia=?
        AND p.estado IN ('pendiente','procesando','reintentable')
        AND NOT EXISTS (
          SELECT 1 FROM intenciones_ddns_agentes i
           WHERE i.causa_tipo='pol' AND i.causa_id=p.causa_id
        )`,
    [agenteId]
  );
  const fotografiadas = concesiones.map((fila) => ({
    idInterno: String(fila.id),
    concesionId: bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId'),
    estado: String(fila.estado),
    registroDnsId: String(fila.registro_dns_id_fotografia),
    versionDdns: String(fila.version_ddns),
    intencionTerminal: fila.terminal === null ? null : String(fila.terminal)
  }));
  return congelar({
    concesiones: fotografiadas,
    intencionesAceptadas: fotografiadas.filter(
      ({ versionDdns, intencionTerminal }) =>
        versionDdns !== '0' && intencionTerminal === null
    ).length,
    causasPolPendientes: Number(causas?.total || 0)
  });
}

async function contarIdentidadesFederadas(conexion, agenteId) {
  const fila = await consultarFila(conexion,
    `SELECT
       (SELECT COUNT(*)
          FROM identidades_contexto_operativo_agentes_federacion
         WHERE agente_id_local=?) +
       (SELECT COUNT(*)
          FROM identidades_elementos_monitores_federacion i
          INNER JOIN vinculos_monitores_telemetria v
            ON v.monitor_id=i.monitor_id_local
         WHERE v.agente_id=?) +
       (SELECT COUNT(*)
          FROM identidades_elementos_telemetria_federacion i
         WHERE i.agente_id_local=?) AS total`,
    [agenteId, agenteId, agenteId]
  );
  return cantidad(fila.total);
}

async function consultarFila(conexion, sql, parametros) {
  const [filas] = await conexion.execute(sql, parametros);
  return filas[0] || {};
}

function json(valor) {
  if (typeof valor === 'string') return JSON.parse(valor);
  return valor;
}

function jsonOpcional(valor) {
  return valor === null ? null : json(valor);
}

function opcional(valor) {
  return valor === null ? null : String(valor);
}

function cantidad(valor) {
  const texto = typeof valor === 'bigint' ? valor.toString() : String(valor ?? '0');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) {
    throw new ErrorRepositorioEliminacionAdministrativaAgente(
      'agente_eliminacion_impacto_no_seguro',
      'El inventario devolvió un conteo no representable de forma segura.'
    );
  }
  return texto;
}

function impactoNoSeguro(mensaje) {
  return new ErrorRepositorioEliminacionAdministrativaAgente(
    'agente_eliminacion_impacto_no_seguro',
    mensaje
  );
}

function compararDecimales(a, b) {
  const izquierda = BigInt(a);
  const derecha = BigInt(b);
  return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${campo} debe ser una identidad decimal positiva.`);
  }
  return texto;
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('El inventario exige una conexión SQL prestada.');
  }
}

async function exigirTransaccionActiva(conexion) {
  if (typeof conexion.query !== 'function') {
    throw new Error('El inventario bloqueado exige una conexión transaccional.');
  }
  const [filas] = await conexion.query(
    'SELECT @@session.in_transaction AS activa'
  );
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('El inventario bloqueado exige una transacción activa.');
  }
}

function tokenLease(valor) {
  const token = Buffer.isBuffer(valor)
    ? Buffer.from(valor)
    : Buffer.from(String(valor || ''), 'hex');
  if (token.length !== 32) {
    throw new TypeError('leaseToken debe contener 32 bytes.');
  }
  return token;
}

function ascii(valor, maximo, campo) {
  const texto = String(valor || '');
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/u.test(texto)) {
    throw new TypeError(`${campo} no es ASCII válido.`);
  }
  return texto;
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${campo} debe ser un decimal positivo.`);
  }
  return texto;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
