import { randomUUID } from 'node:crypto';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../../federacion/src/IdentidadFederada.js';
import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';
import {
  interpretarEntradaFederadaMonitorLogico,
  resolverTransicionEntradaFederadaMonitorLogico
} from './ResolucionEntradaFederadaMonitorLogico.js';

const EPOCA_PROCESO_MONITORES_LOGICOS = randomUUID();

export const CODIGOS_ERROR_ENTRADA_FEDERADA_MONITOR_LOGICO = Object.freeze({
  OBJETIVO_INCOMPATIBLE: 'entrada_federada_monitor_logico_incompatible',
  DUPLICADA: 'entrada_federada_monitor_logico_duplicada',
  ESTADO_INCONSISTENTE: 'entrada_federada_monitor_logico_inconsistente'
});

export class ErrorEntradaFederadaMonitorLogico extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = 'ErrorEntradaFederadaMonitorLogico';
    this.code = codigo;
  }
}

export class EntradaFederadaMonitorLogicoPersistida {
  constructor(fila = {}) {
    this.entradaId = enteroPositivo(fila.entrada_id, 'entradaId');
    this.monitorId = enteroPositivo(fila.monitor_id, 'monitorId');
    this.variable = variable(fila.variable);
    this.proyeccionId = proyeccion(fila.proyeccion_id);
    this.installationOrigenId = identidad(
      fila.installation_origen_id,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationOrigenId'
    );
    this.elementoOrigenId = identidad(
      fila.elemento_origen_id,
      TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
      'elementoOrigenId'
    );
    this.scope = Object.freeze({
      tenantId: decimal(fila.scope_tenant_id),
      empresaId: decimal(fila.scope_empresa_id),
      sitioId: decimal(fila.scope_sitio_id)
    });
    this.revisionConfiguracion = enteroPositivo(
      fila.revision_configuracion,
      'revisionConfiguracion'
    );
    this.estadoInicial = estadoInicial(fila.estado_inicial);
    this.inversion = Boolean(fila.inversion);
    this.retardoCambioSegundos = retardoCambio(fila.retardo_cambio_segundos);
    this.politicaPerdidaEnFallo = politicaPerdida(
      fila.politica_perdida_en_fallo,
      'politicaPerdidaEnFallo'
    );
    this.politicaPerdidaEnCorrecto = politicaPerdida(
      fila.politica_perdida_en_correcto,
      'politicaPerdidaEnCorrecto'
    );
    this.fechaCreacion = fechaIso(fila.fecha_creacion);
    this.fechaActualizacion = fechaIso(fila.fecha_actualizacion);
    Object.freeze(this);
  }

  serializar() {
    return {
      entradaId: this.entradaId,
      monitorId: this.monitorId,
      variable: this.variable,
      proyeccionId: this.proyeccionId,
      installationOrigenId: this.installationOrigenId,
      elementoOrigenId: this.elementoOrigenId,
      scope: { ...this.scope },
      revisionConfiguracion: this.revisionConfiguracion,
      estadoInicial: this.estadoInicial,
      inversion: this.inversion,
      retardoCambioSegundos: this.retardoCambioSegundos,
      politicaPerdidaEnFallo: this.politicaPerdidaEnFallo,
      politicaPerdidaEnCorrecto: this.politicaPerdidaEnCorrecto,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export class RepositorioEntradasFederadasMonitoresLogicosSql {
  constructor(clienteSql, { epocaObservacion = EPOCA_PROCESO_MONITORES_LOGICOS } = {}) {
    if (typeof clienteSql?.consultar !== 'function' ||
        typeof clienteSql?.ejecutar !== 'function') {
      throw new Error('Las entradas federadas lógicas requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.epocaObservacion = normalizarEpocaObservacion(
      epocaObservacion || EPOCA_PROCESO_MONITORES_LOGICOS
    );
    this.frontera = typeof clienteSql.obtenerConexion === 'function'
      ? new FronteraTransaccionalLocal(clienteSql)
      : null;
  }

  async vincular({ monitorId, variable: nombreVariable, proyeccionId, ...configuracion } = {}, {
    conexion = null
  } = {}) {
    if (conexion === null) {
      return this.#ejecutarAtomico((conexionTransaccional) => this.vincular(
        { monitorId, variable: nombreVariable, proyeccionId, ...configuracion },
        { conexion: conexionTransaccional }
      ));
    }
    const entrada = {
      monitorId: enteroPositivo(monitorId, 'monitorId'),
      variable: variable(nombreVariable),
      proyeccionId: proyeccion(proyeccionId),
      ...normalizarConfiguracion(configuracion)
    };
    try {
      const [resultado] = await ejecutar(
        conexion || this.clienteSql,
         `INSERT INTO vinculos_entradas_federadas_monitores_logicos (
           monitor_id,monitor_tipo,variable,proyeccion_id,
           estado_inicial,inversion,retardo_cambio_segundos,politica_perdida_en_fallo,
           politica_perdida_en_correcto
         )
         SELECT m.id,m.tipo,?,p.proyeccion_id,?,?,?,?,?
           FROM monitores m
           JOIN proyecciones_federacion p
             ON p.proyeccion_id=? AND p.familia='monitores'
          WHERE m.id=? AND m.tipo='booleano'`,
        [
          entrada.variable,
          entrada.estadoInicial,
          entrada.inversion ? 1 : 0,
          entrada.retardoCambioSegundos,
          entrada.politicaPerdidaEnFallo,
          entrada.politicaPerdidaEnCorrecto,
          entrada.proyeccionId,
          entrada.monitorId
        ]
      );
      if (Number(resultado?.affectedRows || 0) !== 1) {
        throw new ErrorEntradaFederadaMonitorLogico(
          'El monitor lógico y la proyección remota deben existir y pertenecer a los tipos compatibles.',
          CODIGOS_ERROR_ENTRADA_FEDERADA_MONITOR_LOGICO.OBJETIVO_INCOMPATIBLE
        );
      }
    } catch (error) {
      if (error instanceof ErrorEntradaFederadaMonitorLogico) throw error;
      if (error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062) {
        throw new ErrorEntradaFederadaMonitorLogico(
          'La variable ya está vinculada al monitor lógico.',
          CODIGOS_ERROR_ENTRADA_FEDERADA_MONITOR_LOGICO.DUPLICADA
        );
      }
      throw error;
    }
    const vinculada = await this.buscarPorMonitorYVariable(
      entrada.monitorId,
      entrada.variable,
      { conexion }
    );
    if (!vinculada) {
      throw new ErrorEntradaFederadaMonitorLogico(
        'La entrada federada se creó, pero no pudo recuperarse.',
        CODIGOS_ERROR_ENTRADA_FEDERADA_MONITOR_LOGICO.ESTADO_INCONSISTENTE
      );
    }
    await this.#registrarRevision(vinculada, { conexion });
    return vinculada;
  }

  async buscarPorMonitorYVariable(monitorId, nombreVariable, { conexion = null } = {}) {
    const filas = await this.#consultar(
      'v.monitor_id=? AND v.variable=?',
      [enteroPositivo(monitorId, 'monitorId'), variable(nombreVariable)],
      { conexion }
    );
    return filas[0] || null;
  }

  listarPorMonitorId(monitorId, { conexion = null } = {}) {
    return this.#consultar(
      'v.monitor_id=?',
      [enteroPositivo(monitorId, 'monitorId')],
      { conexion }
    );
  }

  listarPorMonitorIds(monitorIds = [], { conexion = null } = {}) {
    const ids = [...new Set((Array.isArray(monitorIds) ? monitorIds : [])
      .map((id) => enteroPositivo(id, 'monitorId')))];
    if (ids.length === 0) return Object.freeze([]);
    return this.#consultar(
      `v.monitor_id IN (${ids.map(() => '?').join(',')})`,
      ids,
      { conexion }
    );
  }

  listarPorProyeccionId(proyeccionId, { conexion = null } = {}) {
    return this.#consultar(
      'v.proyeccion_id=?',
      [proyeccion(proyeccionId)],
      { conexion }
    );
  }

  async listarMonitorIdsPorProyeccionIds(proyeccionIds = []) {
    const ids = [...new Set((Array.isArray(proyeccionIds) ? proyeccionIds : [])
      .map(proyeccion))];
    if (ids.length === 0) return Object.freeze([]);
    const filas = await this.clienteSql.consultar(
      `SELECT DISTINCT monitor_id
         FROM vinculos_entradas_federadas_monitores_logicos
        WHERE proyeccion_id IN (${ids.map(() => '?').join(',')})
        ORDER BY monitor_id`,
      ids
    );
    return Object.freeze(filas.map((fila) => enteroPositivo(
      fila.monitor_id,
      'monitorId'
    )));
  }

  async resolverEntradasOperativasPorMonitorId(monitorId, { conexion = null } = {}) {
    const filas = await consultar(conexion || this.clienteSql,
      `SELECT v.entrada_id,v.monitor_id,v.variable,v.proyeccion_id,
              v.revision_configuracion,v.estado_inicial,v.inversion,
              v.retardo_cambio_segundos,
              v.politica_perdida_en_fallo,v.politica_perdida_en_correcto,
              CASE
                WHEN a.generacion_actual_id IS NOT NULL
                  THEN a.generacion_actual_id
                WHEN t.condicion='retirada' THEN t.generacion_id
                ELSE NULL
              END AS generacion_operativa_id,
              pv.estado_vigencia,pv.estado_soporte,
              pv.estado_autorizacion,pv.estado_coherencia,
              t.condicion AS condicion_temporal,t.secuencia_estado,
              t.vigente_hasta_efectiva_utc,t.efectivo_en_utc,
              t.materializado_en_utc,t.ultima_transicion_id,
              r.ocurrencia_origen_id,r.estado_operativo,
              JSON_EXTRACT(
                r.representacion_canonica,'$.ejecutadoTodavia'
              ) AS remoto_ejecutado_todavia,
              (
                SELECT r2.estado_operativo
                  FROM registros_monitores_remotos r2
                 WHERE r2.proyeccion_id=v.proyeccion_id
                   AND r2.generacion_id=a.generacion_actual_id
                   AND r2.estado_registro='presente'
                   AND r2.tipo_registro='estadoActual'
                   AND JSON_EXTRACT(
                     r2.representacion_canonica,'$.ejecutadoTodavia'
                   )=TRUE
                   AND r2.secuencia_elemento<=pv.ultima_secuencia_evaluada
                   AND (
                     t.secuencia_estado IS NULL
                     OR r2.secuencia_elemento<=t.secuencia_estado
                   )
                   AND r2.estado_operativo IN (
                     'vivo','correcto','normal','disponible',
                     'fallo','indisponible'
                   )
                 ORDER BY r2.secuencia_elemento DESC
                 LIMIT 1
              ) AS ultimo_estado_estable
         FROM vinculos_entradas_federadas_monitores_logicos v
         LEFT JOIN estados_actuales_proyecciones_federacion a
           ON a.proyeccion_id=v.proyeccion_id
         LEFT JOIN estados_temporales_fotografias_remotas t
           ON t.proyeccion_id=v.proyeccion_id
          AND (
            a.generacion_actual_id IS NULL
            OR t.generacion_id=a.generacion_actual_id
          )
         LEFT JOIN versiones_proyecciones_federacion pv
           ON pv.proyeccion_id=v.proyeccion_id
          AND (
            (a.generacion_actual_id IS NOT NULL
              AND pv.generacion_id=a.generacion_actual_id
              AND pv.estado_publicacion='actual')
            OR (a.generacion_actual_id IS NULL
              AND t.condicion='retirada'
              AND pv.generacion_id=t.generacion_id
              AND pv.estado_vigencia='retirada'
              AND pv.estado_publicacion='preparando')
          )
         LEFT JOIN registros_monitores_remotos r
           ON r.proyeccion_id=t.proyeccion_id
          AND r.generacion_id=t.generacion_id
          AND r.secuencia_elemento=t.secuencia_estado
        WHERE v.monitor_id=?
        ORDER BY v.variable`,
      [enteroPositivo(monitorId, 'monitorId')]
    );
    return Object.freeze(filas.map(proyectarEntradaOperativa));
  }

  async observarEntradasOperativasPorMonitorId(monitorId, {
    observadoEnUtc = new Date().toISOString()
  } = {}) {
    if (!this.frontera) {
      throw new Error('La observación durable requiere una frontera SQL transaccional.');
    }
    const idMonitor = enteroPositivo(monitorId, 'monitorId');
    return this.frontera.ejecutar(async (conexion) => {
      const monitores = await consultar(
        conexion,
        `SELECT id FROM monitores
          WHERE id=? AND tipo='booleano' FOR UPDATE`,
        [idMonitor]
      );
      if (monitores.length !== 1) {
        throw new ErrorEntradaFederadaMonitorLogico(
          'La observación completa requiere un monitor lógico vigente.',
          CODIGOS_ERROR_ENTRADA_FEDERADA_MONITOR_LOGICO.OBJETIVO_INCOMPATIBLE
        );
      }
      await consultar(
        conexion,
        `SELECT entrada_id FROM vinculos_entradas_federadas_monitores_logicos
          WHERE monitor_id=? ORDER BY entrada_id FOR UPDATE`,
        [idMonitor]
      );
      const entradas = await this.resolverEntradasOperativasPorMonitorId(
        idMonitor,
        { conexion }
      );
      const filasEstado = await consultar(
        conexion,
        `SELECT * FROM estados_entradas_federadas_monitores_logicos
          WHERE monitor_id=? FOR UPDATE`,
        [idMonitor]
      );
      const estados = new Map(filasEstado.map((fila) => [
        Number(fila.entrada_id), hidratarEstadoEntrada(fila)
      ]));
      const observacion = [];
      for (const entrada of entradas) {
        const objetivo = interpretarEntradaFederadaMonitorLogico({
          variable: entrada.variable,
          fuente: 'monitor_federado',
          proyeccionId: entrada.proyeccionId
        }, entrada);
        const resuelta = resolverTransicionEntradaFederadaMonitorLogico({
          objetivo,
          estadoPersistido: estados.get(entrada.entradaId) || null,
          observadoEnUtc,
          epocaObservacion: this.epocaObservacion
        });
        await persistirEstadoEntrada(conexion, entrada, resuelta);
        observacion.push(Object.freeze({
          ...entrada,
          ...resuelta,
          fuente: objetivo.fuente,
          referencia: objetivo.referencia,
          valor: resuelta.valorBinarioEfectivo,
          interpretacionDurable: true,
          bloqueaEvaluacion: objetivo.bloqueaEvaluacion,
          motivoBloqueo: objetivo.motivoBloqueo,
          accionAplicada: objetivo.accionAplicada,
          causa: objetivo.causa
        }));
      }
      return Object.freeze(observacion);
    });
  }

  async listarHistorialPorEntradaId(entradaId, { conexion = null } = {}) {
    const filas = await consultar(
      conexion || this.clienteSql,
      `SELECT entrada_id,revision_configuracion,monitor_id,variable,
              proyeccion_id,estado_inicial,inversion,
              retardo_cambio_segundos,
              politica_perdida_en_fallo,politica_perdida_en_correcto,
              vigente_desde_utc,vigente_hasta_utc,causa_cierre
         FROM historial_configuracion_entradas_federadas_logicas
        WHERE entrada_id=?
        ORDER BY revision_configuracion`,
      [enteroPositivo(entradaId, 'entradaId')]
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      entradaId: enteroPositivo(fila.entrada_id, 'entradaId'),
      revisionConfiguracion: enteroPositivo(
        fila.revision_configuracion,
        'revisionConfiguracion'
      ),
      monitorId: enteroPositivo(fila.monitor_id, 'monitorId'),
      variable: variable(fila.variable),
      proyeccionId: proyeccion(fila.proyeccion_id),
      estadoInicial: estadoInicial(fila.estado_inicial),
      inversion: Boolean(fila.inversion),
      retardoCambioSegundos: retardoCambio(fila.retardo_cambio_segundos),
      politicaPerdidaEnFallo: politicaPerdida(
        fila.politica_perdida_en_fallo,
        'politicaPerdidaEnFallo'
      ),
      politicaPerdidaEnCorrecto: politicaPerdida(
        fila.politica_perdida_en_correcto,
        'politicaPerdidaEnCorrecto'
      ),
      vigenteDesdeUtc: fechaIso(fila.vigente_desde_utc),
      vigenteHastaUtc: fila.vigente_hasta_utc
        ? fechaIso(fila.vigente_hasta_utc)
        : null,
      causaCierre: fila.causa_cierre || null
    })));
  }

  async listarHistorialPorReferencias(referencias = [], { conexion = null } = {}) {
    const pares = [...new Map((Array.isArray(referencias) ? referencias : [])
      .map((referencia) => {
        const entradaId = enteroPositivo(referencia?.entradaId, 'entradaId');
        const revisionConfiguracion = enteroPositivo(
          referencia?.revisionConfiguracion,
          'revisionConfiguracion'
        );
        return [`${entradaId}:${revisionConfiguracion}`, {
          entradaId, revisionConfiguracion
        }];
      })).values()];
    if (pares.length === 0) return Object.freeze([]);
    const filas = await consultar(
      conexion || this.clienteSql,
      `SELECT h.entrada_id,h.revision_configuracion,h.monitor_id,h.variable,
              h.proyeccion_id,p.installation_origen_id,p.elemento_origen_id
         FROM historial_configuracion_entradas_federadas_logicas h
         JOIN proyecciones_federacion p ON p.proyeccion_id=h.proyeccion_id
        WHERE ${pares.map(() =>
          '(h.entrada_id=? AND h.revision_configuracion=?)'
        ).join(' OR ')}
        ORDER BY h.entrada_id,h.revision_configuracion`,
      pares.flatMap((par) => [par.entradaId, par.revisionConfiguracion])
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      entradaId: enteroPositivo(fila.entrada_id, 'entradaId'),
      revisionConfiguracion: enteroPositivo(
        fila.revision_configuracion,
        'revisionConfiguracion'
      ),
      monitorId: enteroPositivo(fila.monitor_id, 'monitorId'),
      variable: variable(fila.variable),
      proyeccionId: proyeccion(fila.proyeccion_id),
      installationOrigenId: identidad(
        fila.installation_origen_id,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
        'installationOrigenId'
      ),
      elementoOrigenId: identidad(
        fila.elemento_origen_id,
        TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
        'elementoOrigenId'
      )
    })));
  }

  async reemplazarPorMonitor(monitorId, entradas = [], { conexion = null } = {}) {
    if (conexion === null) {
      return this.#ejecutarAtomico((conexionTransaccional) =>
        this.reemplazarPorMonitor(monitorId, entradas, {
          conexion: conexionTransaccional
        })
      );
    }
    const idMonitor = enteroPositivo(monitorId, 'monitorId');
    const objetivo = entradas.map((entrada) => ({
      monitorId: idMonitor,
      variable: variable(entrada.variable),
      proyeccionId: proyeccion(entrada.proyeccionId),
      ...normalizarConfiguracion(entrada)
    }));
    const actuales = await this.listarPorMonitorId(idMonitor, { conexion });
    const objetivoPorVariable = new Map(
      objetivo.map((entrada) => [entrada.variable, entrada])
    );
    const actualesPorVariable = new Map(
      actuales.map((entrada) => [entrada.variable, entrada])
    );

    for (const actual of actuales) {
      const siguiente = objetivoPorVariable.get(actual.variable);
      if (!siguiente || siguiente.proyeccionId !== actual.proyeccionId) {
        await this.#cerrarRevision(actual, {
          conexion,
          causa: siguiente ? 'fuente_sustituida' : 'entrada_eliminada'
        });
        await ejecutar(
          conexion || this.clienteSql,
          `DELETE FROM vinculos_entradas_federadas_monitores_logicos
            WHERE monitor_id=? AND variable=?`,
          [idMonitor, actual.variable]
        );
      }
    }

    for (const siguiente of objetivo) {
      const actual = actualesPorVariable.get(siguiente.variable);
      if (!actual || actual.proyeccionId !== siguiente.proyeccionId) {
        await this.vincular(siguiente, { conexion });
        continue;
      }
      if (!mismaConfiguracion(actual, siguiente)) {
        await this.#cerrarRevision(actual, {
          conexion,
          causa: 'configuracion_sustituida'
        });
        await ejecutar(
          conexion || this.clienteSql,
          `UPDATE vinculos_entradas_federadas_monitores_logicos
              SET revision_configuracion=revision_configuracion+1,
                  estado_inicial=?,inversion=?,politica_perdida_en_fallo=?,
                  politica_perdida_en_correcto=?,retardo_cambio_segundos=?
            WHERE monitor_id=? AND variable=?`,
          [
            siguiente.estadoInicial,
            siguiente.inversion ? 1 : 0,
            siguiente.politicaPerdidaEnFallo,
            siguiente.politicaPerdidaEnCorrecto,
            siguiente.retardoCambioSegundos,
            idMonitor,
            siguiente.variable
          ]
        );
        const revisada = await this.buscarPorMonitorYVariable(
          idMonitor,
          siguiente.variable,
          { conexion }
        );
        await this.#registrarRevision(revisada, { conexion });
      }
    }

    return this.listarPorMonitorId(idMonitor, { conexion });
  }

  async listarProyeccionesVisibles(contextoUsuarioActual, proyeccionIds = []) {
    const ids = [...new Set(proyeccionIds.map(proyeccion))];
    if (ids.length === 0) return Object.freeze([]);
    const filtro = filtroScope(contextoUsuarioActual);
    const placeholders = ids.map(() => '?').join(',');
    const filas = await this.clienteSql.consultar(
      `SELECT p.proyeccion_id
         FROM proyecciones_federacion p
        WHERE p.familia='monitores'
          AND p.proyeccion_id IN (${placeholders})
          ${filtro.sql}
        ORDER BY p.proyeccion_id`,
      [...ids, ...filtro.parametros]
    );
    return Object.freeze(filas.map((fila) => fila.proyeccion_id));
  }

  async listarProyeccionesPublicadasVisibles(
    contextoUsuarioActual,
    proyeccionIds = []
  ) {
    const ids = [...new Set(proyeccionIds.map(proyeccion))];
    if (ids.length === 0) return Object.freeze([]);
    const filtro = filtroScope(contextoUsuarioActual);
    const filas = await this.clienteSql.consultar(
      `SELECT p.proyeccion_id
         FROM proyecciones_federacion p
         JOIN estados_actuales_proyecciones_federacion a
           ON a.proyeccion_id=p.proyeccion_id
         JOIN versiones_proyecciones_federacion pv
           ON pv.proyeccion_id=a.proyeccion_id
          AND pv.generacion_id=a.generacion_actual_id
          AND pv.estado_publicacion='actual'
        WHERE p.familia='monitores'
          AND p.proyeccion_id IN (${ids.map(() => '?').join(',')})
          ${filtro.sql}
        ORDER BY p.proyeccion_id`,
      [...ids, ...filtro.parametros]
    );
    return Object.freeze(filas.map((fila) => fila.proyeccion_id));
  }

  async eliminarPorMonitorId(monitorId, {
    conexion = null,
    causaCierre = 'monitor_eliminado'
  } = {}) {
    if (conexion === null) {
      return this.#ejecutarAtomico((conexionTransaccional) =>
        this.eliminarPorMonitorId(monitorId, {
          conexion: conexionTransaccional,
          causaCierre
        })
      );
    }
    const idMonitor = enteroPositivo(monitorId, 'monitorId');
    const actuales = await this.listarPorMonitorId(idMonitor, { conexion });
    for (const actual of actuales) {
      await this.#cerrarRevision(actual, { conexion, causa: causaCierre });
    }
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      'DELETE FROM vinculos_entradas_federadas_monitores_logicos WHERE monitor_id=?',
      [idMonitor]
    );
    return Number(resultado?.affectedRows || 0);
  }

  async #registrarRevision(entrada, { conexion }) {
    await ejecutar(
      conexion || this.clienteSql,
      `INSERT INTO historial_configuracion_entradas_federadas_logicas (
         entrada_id,revision_configuracion,monitor_id,variable,proyeccion_id,
         estado_inicial,inversion,politica_perdida_en_fallo,
         politica_perdida_en_correcto,retardo_cambio_segundos
       ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        entrada.entradaId,
        entrada.revisionConfiguracion,
        entrada.monitorId,
        entrada.variable,
        entrada.proyeccionId,
        entrada.estadoInicial,
        entrada.inversion ? 1 : 0,
        entrada.politicaPerdidaEnFallo,
        entrada.politicaPerdidaEnCorrecto,
        entrada.retardoCambioSegundos
      ]
    );
  }

  async #cerrarRevision(entrada, { conexion, causa }) {
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `UPDATE historial_configuracion_entradas_federadas_logicas
          SET vigente_hasta_utc=UTC_TIMESTAMP(3),causa_cierre=?
        WHERE entrada_id=? AND revision_configuracion=?
          AND vigente_hasta_utc IS NULL`,
      [causa, entrada.entradaId, entrada.revisionConfiguracion]
    );
    if (Number(resultado?.affectedRows || 0) !== 1) {
      throw new ErrorEntradaFederadaMonitorLogico(
        'La revisión vigente de la entrada federada no pudo cerrarse de forma única.',
        CODIGOS_ERROR_ENTRADA_FEDERADA_MONITOR_LOGICO.ESTADO_INCONSISTENTE
      );
    }
  }

  #ejecutarAtomico(operacion) {
    if (!this.frontera) {
      throw new Error(
        'La escritura de entradas federadas requiere una frontera SQL transaccional.'
      );
    }
    return this.frontera.ejecutar(operacion);
  }

  async #consultar(condicion, parametros, { conexion }) {
    const filas = await consultar(
      conexion || this.clienteSql,
      `SELECT v.entrada_id,v.monitor_id,v.variable,v.proyeccion_id,
              v.revision_configuracion,v.estado_inicial,v.inversion,
              v.retardo_cambio_segundos,
              v.politica_perdida_en_fallo,v.politica_perdida_en_correcto,
              v.fecha_creacion,v.fecha_actualizacion,
              p.installation_origen_id,p.elemento_origen_id,
              p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id
         FROM vinculos_entradas_federadas_monitores_logicos v
         JOIN proyecciones_federacion p ON p.proyeccion_id=v.proyeccion_id
        WHERE ${condicion}
        ORDER BY v.monitor_id,v.variable`,
      parametros
    );
    return Object.freeze(filas.map((fila) =>
      new EntradaFederadaMonitorLogicoPersistida(fila)
    ));
  }
}

function variable(valor) {
  const texto = String(valor || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,15}$/u.test(texto)) {
    throw new Error('La variable de la entrada federada no es válida.');
  }
  return texto;
}

function normalizarEpocaObservacion(valor) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > 64 || !/^[\x21-\x7e]+$/u.test(texto)) {
    throw new Error(
      'epocaObservacion debe ser una identidad ASCII no vacía de hasta 64 caracteres.'
    );
  }
  return texto;
}

function proyeccion(valor) {
  return identidad(valor, TIPOS_IDENTIDAD_FEDERADA.PROYECCION, 'proyeccionId');
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    throw new Error(`${campo} no es una identidad federada válida.`);
  }
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }
  return numero;
}

function decimal(valor) {
  return valor == null ? null : String(valor);
}

function fechaIso(valor) {
  return valor instanceof Date
    ? valor.toISOString()
    : `${String(valor).replace(' ', 'T').replace(/Z$/u, '')}Z`;
}

function normalizarConfiguracion(valor = {}) {
  return {
    estadoInicial: estadoInicial(valor.estadoInicial),
    inversion: booleano(valor.inversion, 'inversion'),
    retardoCambioSegundos: retardoCambio(valor.retardoCambioSegundos),
    politicaPerdidaEnFallo: politicaPerdida(
      valor.politicaPerdidaEnFallo,
      'politicaPerdidaEnFallo'
    ),
    politicaPerdidaEnCorrecto: politicaPerdida(
      valor.politicaPerdidaEnCorrecto,
      'politicaPerdidaEnCorrecto'
    )
  };
}

function estadoInicial(valor) {
  const texto = String(valor ?? 'correcto').trim().toLowerCase();
  if (!['correcto', 'fallo'].includes(texto)) {
    throw new Error('estadoInicial debe ser correcto o fallo.');
  }
  return texto;
}

function retardoCambio(valor) {
  const numero = Number(valor ?? 0);
  if (!Number.isSafeInteger(numero) || numero < 0 || numero > 86400) {
    throw new Error('retardoCambioSegundos debe estar entre 0 y 86400.');
  }
  return numero;
}

function politicaPerdida(valor, campo) {
  const texto = String(valor ?? 'conservar').trim().toLowerCase();
  if (!['forzar_fallo', 'forzar_correcto', 'conservar'].includes(texto)) {
    throw new Error(`${campo} no es una política de pérdida válida.`);
  }
  return texto;
}

function booleano(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return false;
  if (valor === true || valor === 1 || valor === '1' || valor === 'true') return true;
  if (valor === false || valor === 0 || valor === '0' || valor === 'false') return false;
  throw new Error(`${campo} debe ser booleano.`);
}

function mismaConfiguracion(actual, siguiente) {
  return actual.estadoInicial === siguiente.estadoInicial &&
    actual.inversion === siguiente.inversion &&
    actual.retardoCambioSegundos === siguiente.retardoCambioSegundos &&
    actual.politicaPerdidaEnFallo === siguiente.politicaPerdidaEnFallo &&
    actual.politicaPerdidaEnCorrecto === siguiente.politicaPerdidaEnCorrecto;
}

function hidratarEstadoEntrada(fila) {
  return {
    revisionConfiguracionAplicada: Number(fila.revision_configuracion_aplicada),
    valorBinarioEfectivo: Boolean(fila.valor_binario_efectivo),
    condicionFuente: fila.condicion_fuente,
    ultimoEstadoRemotoEstable: fila.ultimo_estado_remoto_estable || null,
    candidatoValor: fila.candidato_valor == null ? null : Boolean(fila.candidato_valor),
    candidatoCondicion: fila.candidato_condicion || null,
    candidatoIniciadoEnUtc: fechaIsoOpcional(fila.candidato_iniciado_en_utc),
    candidatoVenceEnUtc: fechaIsoOpcional(fila.candidato_vence_en_utc),
    candidatoRevisionConfiguracion: fila.candidato_revision_configuracion == null
      ? null : Number(fila.candidato_revision_configuracion),
    evidenciaEfectiva: jsonObjeto(fila.evidencia_efectiva_json),
    evidenciaCandidata: jsonObjeto(fila.evidencia_candidata_json),
    epocaObservacion: fila.epoca_observacion,
    requiereObservacionCompleta: Boolean(fila.requiere_observacion_completa),
    versionEstado: Number(fila.version_estado)
  };
}

async function persistirEstadoEntrada(conexion, entrada, estado) {
  await ejecutar(
    conexion,
    `INSERT INTO estados_entradas_federadas_monitores_logicos (
       entrada_id,monitor_id,revision_configuracion_aplicada,
       valor_binario_efectivo,condicion_fuente,ultimo_estado_remoto_estable,
       candidato_valor,candidato_condicion,candidato_iniciado_en_utc,
       candidato_vence_en_utc,candidato_revision_configuracion,
       evidencia_efectiva_json,evidencia_candidata_json,epoca_observacion,
       requiere_observacion_completa,version_estado,
       observada_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       revision_configuracion_aplicada=VALUES(revision_configuracion_aplicada),
       valor_binario_efectivo=VALUES(valor_binario_efectivo),
       condicion_fuente=VALUES(condicion_fuente),
       ultimo_estado_remoto_estable=VALUES(ultimo_estado_remoto_estable),
       candidato_valor=VALUES(candidato_valor),
       candidato_condicion=VALUES(candidato_condicion),
       candidato_iniciado_en_utc=VALUES(candidato_iniciado_en_utc),
       candidato_vence_en_utc=VALUES(candidato_vence_en_utc),
       candidato_revision_configuracion=VALUES(candidato_revision_configuracion),
       evidencia_efectiva_json=VALUES(evidencia_efectiva_json),
       evidencia_candidata_json=VALUES(evidencia_candidata_json),
       epoca_observacion=VALUES(epoca_observacion),
       requiere_observacion_completa=VALUES(requiere_observacion_completa),
       version_estado=VALUES(version_estado),observada_en_utc=VALUES(observada_en_utc)`,
    [
      entrada.entradaId,
      entrada.monitorId,
      estado.revisionConfiguracionAplicada,
      estado.valorBinarioEfectivo ? 1 : 0,
      estado.condicionFuente,
      estado.ultimoEstadoRemotoEstable,
      estado.candidatoValor == null ? null : (estado.candidatoValor ? 1 : 0),
      estado.candidatoCondicion,
      fechaSqlOpcional(estado.candidatoIniciadoEnUtc),
      fechaSqlOpcional(estado.candidatoVenceEnUtc),
      estado.candidatoRevisionConfiguracion,
      jsonTexto(estado.evidenciaEfectiva),
      jsonTexto(estado.evidenciaCandidata),
      estado.epocaObservacion,
      estado.requiereObservacionCompleta ? 1 : 0,
      estado.versionEstado,
      fechaSqlOpcional(estado.observadoEnUtc)
    ]
  );
}

function jsonTexto(valor) {
  return valor == null ? null : JSON.stringify(valor);
}

function jsonObjeto(valor) {
  if (valor == null) return null;
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch { return null; }
}

function fechaSqlOpcional(valor) {
  if (valor == null) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error('La fecha durable no es válida.');
  return fecha;
}

function proyectarEntradaOperativa(fila) {
  return Object.freeze({
    entradaId: enteroPositivo(fila.entrada_id, 'entradaId'),
    monitorId: enteroPositivo(fila.monitor_id, 'monitorId'),
    variable: variable(fila.variable),
    proyeccionId: proyeccion(fila.proyeccion_id),
    revisionConfiguracion: enteroPositivo(
      fila.revision_configuracion,
      'revisionConfiguracion'
    ),
    estadoInicial: estadoInicial(fila.estado_inicial),
    inversion: Boolean(fila.inversion),
    retardoCambioSegundos: retardoCambio(fila.retardo_cambio_segundos),
    politicaPerdidaEnFallo: politicaPerdida(
      fila.politica_perdida_en_fallo,
      'politicaPerdidaEnFallo'
    ),
    politicaPerdidaEnCorrecto: politicaPerdida(
      fila.politica_perdida_en_correcto,
      'politicaPerdidaEnCorrecto'
    ),
    generacionId: fila.generacion_operativa_id || null,
    estadoVigencia: fila.estado_vigencia || null,
    estadoSoporte: fila.estado_soporte || null,
    estadoAutorizacion: fila.estado_autorizacion || null,
    estadoCoherencia: fila.estado_coherencia || null,
    condicionTemporal: fila.condicion_temporal || null,
    secuenciaElemento: fila.secuencia_estado == null
      ? null
      : String(fila.secuencia_estado),
    estadoOperativoRemoto: fila.estado_operativo || null,
    remotoEjecutadoTodavia: booleanoSql(fila.remoto_ejecutado_todavia),
    ultimoEstadoRemotoEstable: normalizarEstadoRemotoEstable(
      fila.ultimo_estado_estable
    ),
    ocurrenciaOrigenId: fila.ocurrencia_origen_id || null,
    vigenteHastaEfectivaUtc: fechaIsoOpcional(
      fila.vigente_hasta_efectiva_utc
    ),
    efectivoEnUtc: fechaIsoOpcional(fila.efectivo_en_utc),
    materializadoEnUtc: fechaIsoOpcional(fila.materializado_en_utc),
    transicionTemporalId: fila.ultima_transicion_id || null
  });
}

function normalizarEstadoRemotoEstable(valor) {
  const texto = String(valor || '').trim().toLowerCase();
  if (['vivo', 'correcto', 'normal', 'disponible'].includes(texto)) {
    return 'correcto';
  }
  if (['fallo', 'indisponible'].includes(texto)) return 'fallo';
  return null;
}

function fechaIsoOpcional(valor) {
  return valor === null || valor === undefined ? null : fechaIso(valor);
}

function booleanoSql(valor) {
  return valor === true || valor === 1 || valor === '1' || valor === 'true';
}

function filtroScope(contexto) {
  if (contexto?.nivelScope === 'portal') return { sql: '', parametros: [] };
  if (contexto?.nivelScope === 'tenant') {
    return { sql: 'AND p.scope_tenant_id=?', parametros: [contexto.tenantId] };
  }
  if (contexto?.nivelScope === 'empresa') {
    return {
      sql: 'AND p.scope_tenant_id=? AND p.scope_empresa_id=?',
      parametros: [contexto.tenantId, contexto.empresaId]
    };
  }
  if (contexto?.nivelScope === 'sitio') {
    return {
      sql: `AND p.scope_tenant_id=? AND p.scope_empresa_id=?
        AND p.scope_sitio_id=?`,
      parametros: [contexto.tenantId, contexto.empresaId, contexto.sitioId]
    };
  }
  return { sql: 'AND 1=0', parametros: [] };
}

async function ejecutar(ejecutor, sql, parametros) {
  return typeof ejecutor.ejecutar === 'function'
    ? ejecutor.ejecutar(sql, parametros)
    : ejecutor.execute(sql, parametros);
}

async function consultar(ejecutor, sql, parametros) {
  if (typeof ejecutor.consultar === 'function') {
    return ejecutor.consultar(sql, parametros);
  }
  const [filas] = await ejecutor.execute(sql, parametros);
  return filas;
}
