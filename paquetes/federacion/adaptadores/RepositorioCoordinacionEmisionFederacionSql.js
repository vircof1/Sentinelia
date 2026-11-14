import {
  ERRORES_TEMPORALES_FEDERACION,
  ERRORES_TERMINALES_FEDERACION,
  RESULTADOS_OCURRENCIA_FEDERACION
} from '../src/CatalogosFederacion.js';
import { TIPOS_IDENTIDAD_FEDERADA, crearIdentidadFederada } from '../src/IdentidadFederada.js';
import {
  promoverProgresoGeneracionFederacionEnTransaccion
} from './promoverProgresoGeneracionFederacionSql.js';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;

export class ErrorCoordinacionEmisionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorCoordinacionEmisionFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioCoordinacionEmisionFederacionSql {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La coordinación emisora requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async reclamarSiguiente({ instanciaId, leaseToken, ttlSegundos = 30 } = {}) {
    const instancia = textoAscii(instanciaId, 128, 'instanciaId');
    const token = tokenLease(leaseToken);
    const ttl = enteroAcotado(ttlSegundos, 5, 3600, 'ttlSegundos');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(`
        SELECT p.id,p.flujo_id,
               g.generacion_id AS generacion_trabajo_id,
               p.fencing_token,p.intentos_lease,
               f.relacion_id,f.familia,f.version_familia
          FROM propietarios_emision_flujos_federacion p
          JOIN flujos_federacion f
            ON f.flujo_id=p.flujo_id
           AND f.generacion_activa_id=p.generacion_id
          JOIN generaciones_flujos_federacion g
            ON g.flujo_id=p.flujo_id
           AND g.rol_generacion IN ('activa','candidata')
          LEFT JOIN control_generaciones_emision_federacion c
            ON c.flujo_id=p.flujo_id AND c.generacion_id=g.generacion_id
         WHERE p.estado='vigente' AND f.direccion='emision'
           AND g.estado IN (
             'transfiriendo','fronteraOperativaValidada','completa','degradada'
           )
           AND (p.lease_expira_utc IS NULL
             OR p.lease_expira_utc<=UTC_TIMESTAMP(3))
           AND (c.pausa_hasta_utc IS NULL
             OR c.pausa_hasta_utc<=UTC_TIMESTAMP(3))
           AND EXISTS (
             SELECT 1 FROM outbox_federacion o
              WHERE o.flujo_id=p.flujo_id
                AND o.generacion_id=g.generacion_id
                AND o.estado IN ('pendiente','reintentable')
                AND o.disponible_desde_utc<=UTC_TIMESTAMP(3)
           )
         ORDER BY COALESCE(c.actualizado_en_utc,g.creada_en_utc),
                  p.flujo_id,g.ordinal
         LIMIT 1 FOR UPDATE SKIP LOCKED
      `);
      const fila = filas[0];
      if (!fila) {
        await conexion.commit();
        return null;
      }
      const fencing = BigInt(fila.fencing_token);
      if (fencing >= MAX_BIGINT_UNSIGNED) {
        throw new ErrorCoordinacionEmisionFederacion(
          'fencing_emision_agotado',
          'El flujo agotó su contador de fencing y requiere intervención.'
        );
      }
      const siguienteFencing = String(fencing + 1n);
      const [actualizacion] = await conexion.execute(`
        UPDATE propietarios_emision_flujos_federacion
           SET instancia_lease_id=?,lease_token=?,
               lease_expira_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
               fencing_token=?,intentos_lease=intentos_lease+1,
               generacion_trabajo_id=?
         WHERE id=? AND estado='vigente'
           AND (lease_expira_utc IS NULL OR lease_expira_utc<=UTC_TIMESTAMP(3))
      `, [
        instancia,
        token,
        ttl,
        siguienteFencing,
        fila.generacion_trabajo_id,
        fila.id
      ]);
      if (Number(actualizacion.affectedRows) !== 1) {
        await conexion.rollback();
        return null;
      }
      await conexion.commit();
      return Object.freeze({
        lease: Object.freeze({
          propietarioId: String(fila.id),
          instanciaId: instancia,
          leaseToken: token.toString('hex'),
          fencingToken: siguienteFencing
        }),
        intentos: Number(fila.intentos_lease) + 1,
        flujo: Object.freeze({
          flujoId: fila.flujo_id,
          generacionId: fila.generacion_trabajo_id,
          relacionId: fila.relacion_id,
          familia: fila.familia,
          versionFamilia: Number(fila.version_familia)
        })
      });
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }

  async renovarLease(leaseEntrada, { ttlSegundos = 30 } = {}) {
    const lease = normalizarLease(leaseEntrada);
    const ttl = enteroAcotado(ttlSegundos, 5, 3600, 'ttlSegundos');
    const [resultado] = await this.clienteSql.ejecutar(`
      UPDATE propietarios_emision_flujos_federacion
         SET lease_expira_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3))
       WHERE id=? AND estado='vigente' AND instancia_lease_id=?
         AND lease_token=UNHEX(?) AND fencing_token=?
         AND lease_expira_utc>UTC_TIMESTAMP(3)
    `, [ttl, lease.propietarioId, lease.instanciaId,
      lease.leaseToken, lease.fencingToken]);
    return Number(resultado.affectedRows) === 1;
  }

  async comprobarLeaseVigente(leaseEntrada) {
    const lease = normalizarLease(leaseEntrada);
    const filas = await this.clienteSql.consultar(`
      SELECT id FROM propietarios_emision_flujos_federacion
       WHERE id=? AND estado='vigente' AND instancia_lease_id=?
         AND lease_token=UNHEX(?) AND fencing_token=?
         AND lease_expira_utc>UTC_TIMESTAMP(3)
       LIMIT 1
    `, [lease.propietarioId, lease.instanciaId,
      lease.leaseToken, lease.fencingToken]);
    return filas.length === 1;
  }

  async liberarLease(leaseEntrada) {
    const lease = normalizarLease(leaseEntrada);
    const [resultado] = await this.clienteSql.ejecutar(`
      UPDATE propietarios_emision_flujos_federacion
         SET instancia_lease_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
             generacion_trabajo_id=NULL
       WHERE id=? AND estado='vigente' AND instancia_lease_id=?
         AND lease_token=UNHEX(?) AND fencing_token=?
         AND lease_expira_utc>UTC_TIMESTAMP(3)
    `, [lease.propietarioId, lease.instanciaId,
      lease.leaseToken, lease.fencingToken]);
    return Number(resultado.affectedRows) === 1;
  }

  async prepararCandidatos(leaseEntrada, {
    limite = 1000,
    generarEntregaId
  } = {}) {
    const lease = normalizarLease(leaseEntrada);
    const maximo = enteroAcotado(limite, 1, 5000, 'limite');
    if (typeof generarEntregaId !== 'function') {
      throw new Error('La preparación exige generarEntregaId().');
    }
    return this.#conLeaseBloqueado(lease, async (conexion, propietario) => {
      const [filas] = await conexion.execute(`
        SELECT o.id,o.entrega_id,o.posicion_flujo,o.prioridad,o.intentos,
               p.installation_origen_id,p.familia,p.elemento_origen_id,
               p.ocurrencia_origen_id
          FROM outbox_federacion o
          JOIN posiciones_ocurrencias_flujos_federacion p
            ON p.flujo_id=o.flujo_id AND p.generacion_id=o.generacion_id
           AND p.posicion_flujo=o.posicion_flujo
         WHERE o.flujo_id=? AND o.generacion_id=?
           AND o.estado IN ('pendiente','reintentable')
           AND o.disponible_desde_utc<=UTC_TIMESTAMP(3)
         ORDER BY FIELD(o.prioridad,'operativaActual','reconstruccion'),
                  o.posicion_flujo
         LIMIT ? FOR UPDATE
      `, [propietario.flujo_id, propietario.generacion_id, maximo]);
      const candidatos = [];
      for (const fila of filas) {
        let entregaId = fila.entrega_id;
        if (!entregaId) {
          entregaId = identidad(
            generarEntregaId(), TIPOS_IDENTIDAD_FEDERADA.ENTREGA, 'entregaId'
          );
          const [asignacion] = await conexion.execute(
            `UPDATE outbox_federacion SET entrega_id=?,actualizada_en_utc=UTC_TIMESTAMP(3)
              WHERE id=? AND entrega_id IS NULL`,
            [entregaId, fila.id]
          );
          if (Number(asignacion.affectedRows) !== 1) {
            throw new ErrorCoordinacionEmisionFederacion(
              'identidad_entrega_concurrente',
              'La entrega no pudo adquirir una identidad durable única.'
            );
          }
        }
        candidatos.push(Object.freeze({
          outboxId: String(fila.id),
          entregaId,
          posicionFlujo: String(fila.posicion_flujo),
          prioridad: fila.prioridad,
          intentos: Number(fila.intentos),
          identidadOcurrencia: Object.freeze({
            installationOrigenId: fila.installation_origen_id,
            familia: fila.familia,
            elementoOrigenId: fila.elemento_origen_id,
            ocurrenciaOrigenId: fila.ocurrencia_origen_id
          })
        }));
      }
      return Object.freeze(candidatos);
    });
  }

  async aplicarResultados(leaseEntrada, {
    resultados,
    progreso = null,
    demoraReintentoSegundos = 5
  } = {}) {
    const lease = normalizarLease(leaseEntrada);
    if (!Array.isArray(resultados) || resultados.length === 0) {
      throw new Error('La consolidación exige resultados individuales.');
    }
    const normalizados = resultados.map(normalizarResultadoEmision);
    const demora = enteroAcotado(
      demoraReintentoSegundos, 1, 86400, 'demoraReintentoSegundos'
    );
    if (new Set(normalizados.map((r) => r.entregaId)).size !== normalizados.length) {
      throw new Error('La consolidación repite una entrega.');
    }
    return this.#conLeaseBloqueado(lease, async (conexion, propietario) => {
      const control = await asegurarControl(conexion, propietario);
      const aplicados = [];
      for (const resultado of normalizados) {
        const estado = resultado.clasificacion === 'temporal'
          ? 'reintentable'
          : resultado.bloqueadaLocalmente ? 'bloqueada' : 'confirmada';
        const [actualizacion] = await conexion.execute(`
          UPDATE outbox_federacion
             SET estado=?,intentos=intentos+?,ultimo_resultado=?,
                 ultimo_error_terminal=?,ultimo_error_temporal=?,
                 ultimo_error_transporte=NULL,
                 disponible_desde_utc=IF(?='temporal',
                   TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3)),
                 actualizada_en_utc=UTC_TIMESTAMP(3),
                 finalizada_en_utc=IF(? IN ('confirmada','bloqueada'),UTC_TIMESTAMP(3),NULL)
           WHERE flujo_id=? AND generacion_id=? AND entrega_id=?
             AND estado IN ('pendiente','reintentable')
        `, [
          estado, resultado.intentadaRemotamente ? 1 : 0,
          resultado.resultado, resultado.errorTerminal, resultado.errorTemporal,
          resultado.clasificacion, demora,
          estado, propietario.flujo_id, propietario.generacion_id,
          resultado.entregaId
        ]);
        if (Number(actualizacion.affectedRows) !== 1) {
          throw new ErrorCoordinacionEmisionFederacion(
            'resultado_emision_concurrente',
            'La entrega dejó de estar disponible bajo el lease vigente.'
          );
        }
        aplicados.push(Object.freeze({ entregaId: resultado.entregaId, estado }));
      }
      const cursorLocal = await avanzarCursorLocal(conexion, propietario, control);
      const cursorRemoto = progreso === null
        ? null
        : await guardarCursorRemoto(conexion, propietario, control, progreso);
      const promocion = progreso === null
        ? null
        : await promoverProgresoGeneracionFederacionEnTransaccion({
            conexion,
            flujoId: propietario.flujo_id,
            generacionId: propietario.generacion_id,
            posicionTerminalContigua: cursorRemoto.posicionTerminalContigua,
            fronteraInicialRecorrida: progreso.fronteraInicialRecorrida,
            fronteraInicialDegradada: progreso.fronteraInicialDegradada,
            prefijoDegradado: progreso.prefijoDegradado
          });
      if (normalizados.some((resultado) => resultado.clasificacion === 'temporal')) {
        await actualizarPausa(conexion, propietario, {
          causa: 'backpressure_remoto', demoraSegundos: demora
        });
      } else {
        await limpiarPausaSiVencida(conexion, propietario);
      }
      return Object.freeze({
        resultados: Object.freeze(aplicados),
        cursorLocal,
        cursorRemoto,
        promocion
      });
    });
  }

  async aplazarEntregas(leaseEntrada, {
    entregaIds,
    codigoTransporte,
    demoraReintentoSegundos = 5
  } = {}) {
    const lease = normalizarLease(leaseEntrada);
    const entregas = normalizarEntregas(entregaIds);
    const codigo = codigoTecnico(codigoTransporte, 'codigoTransporte');
    const demora = enteroAcotado(
      demoraReintentoSegundos, 1, 86400, 'demoraReintentoSegundos'
    );
    return this.#conLeaseBloqueado(lease, async (conexion, propietario) => {
      await asegurarControl(conexion, propietario);
      for (const entregaId of entregas) {
        const [resultado] = await conexion.execute(`
          UPDATE outbox_federacion
             SET estado='reintentable',intentos=intentos+1,
                 ultimo_error_transporte=?,
                 disponible_desde_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
                 actualizada_en_utc=UTC_TIMESTAMP(3),finalizada_en_utc=NULL
           WHERE flujo_id=? AND generacion_id=? AND entrega_id=?
             AND estado IN ('pendiente','reintentable')
        `, [codigo, demora, propietario.flujo_id,
          propietario.generacion_id, entregaId]);
        if (Number(resultado.affectedRows) !== 1) {
          throw new ErrorCoordinacionEmisionFederacion(
            'aplazamiento_emision_concurrente',
            'La entrega dejó de estar disponible bajo el lease vigente.'
          );
        }
      }
      await actualizarPausa(conexion, propietario, {
        causa: codigo, demoraSegundos: demora
      });
      return Object.freeze({ aplazadas: entregas.length, demoraSegundos: demora });
    });
  }

  async pausarFlujo(leaseEntrada, {
    causa,
    demoraReintentoSegundos = 5
  } = {}) {
    const lease = normalizarLease(leaseEntrada);
    const demora = enteroAcotado(
      demoraReintentoSegundos, 1, 86400, 'demoraReintentoSegundos'
    );
    const causaNormalizada = codigoTecnico(causa, 'causa');
    return this.#conLeaseBloqueado(lease, async (conexion, propietario) => {
      await asegurarControl(conexion, propietario);
      await actualizarPausa(conexion, propietario, {
        causa: causaNormalizada, demoraSegundos: demora
      });
      return Object.freeze({ pausado: true, demoraSegundos: demora });
    });
  }

  async registrarReagrupacionPorCapacidad(leaseEntrada, { entregaIds } = {}) {
    const lease = normalizarLease(leaseEntrada);
    const entregas = normalizarEntregas(entregaIds);
    return this.#conLeaseBloqueado(lease, async (conexion, propietario) => {
      for (const entregaId of entregas) {
        const [resultado] = await conexion.execute(`
          UPDATE outbox_federacion
             SET intentos=intentos+1,
                 ultimo_error_transporte='http_413_lote_excede_limites',
                 actualizada_en_utc=UTC_TIMESTAMP(3)
           WHERE flujo_id=? AND generacion_id=? AND entrega_id=?
             AND estado IN ('pendiente','reintentable')
        `, [propietario.flujo_id, propietario.generacion_id, entregaId]);
        if (Number(resultado.affectedRows) !== 1) {
          throw new ErrorCoordinacionEmisionFederacion(
            'reagrupacion_emision_concurrente',
            'La entrega dejó de estar disponible al registrar el rechazo 413.'
          );
        }
      }
      return Object.freeze({ registradas: entregas.length });
    });
  }

  async registrarReagrupacionPorRespuesta(leaseEntrada, {
    entregaIds,
    codigoTransporte
  } = {}) {
    const lease = normalizarLease(leaseEntrada);
    const entregas = normalizarEntregas(entregaIds);
    const codigo = codigoTecnico(codigoTransporte, 'codigoTransporte');
    return this.#conLeaseBloqueado(lease, async (conexion, propietario) => {
      for (const entregaId of entregas) {
        const [resultado] = await conexion.execute(`
          UPDATE outbox_federacion
             SET intentos=intentos+1,ultimo_error_transporte=?,
                 actualizada_en_utc=UTC_TIMESTAMP(3)
           WHERE flujo_id=? AND generacion_id=? AND entrega_id=?
             AND estado IN ('pendiente','reintentable')
        `, [codigo, propietario.flujo_id, propietario.generacion_id, entregaId]);
        if (Number(resultado.affectedRows) !== 1) {
          throw new ErrorCoordinacionEmisionFederacion(
            'reagrupacion_respuesta_emision_concurrente',
            'La entrega dejó de estar disponible al reducir el lote sin respuesta válida.'
          );
        }
      }
      return Object.freeze({ registradas: entregas.length });
    });
  }

  async obtenerControl({ flujoId, generacionId } = {}) {
    const filas = await this.clienteSql.consultar(`
      SELECT * FROM control_generaciones_emision_federacion
       WHERE flujo_id=? AND generacion_id=? LIMIT 1
    `, [flujoId, generacionId]);
    return filas[0] ? hidratarControl(filas[0]) : null;
  }

  async #conLeaseBloqueado(lease, operacion) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(`
        SELECT id,flujo_id,generacion_trabajo_id AS generacion_id
          FROM propietarios_emision_flujos_federacion
         WHERE id=? AND estado='vigente' AND instancia_lease_id=?
           AND lease_token=UNHEX(?) AND fencing_token=?
           AND lease_expira_utc>UTC_TIMESTAMP(3)
           AND generacion_trabajo_id IS NOT NULL
         FOR UPDATE
      `, [lease.propietarioId, lease.instanciaId,
        lease.leaseToken, lease.fencingToken]);
      if (filas.length !== 1) {
        throw new ErrorCoordinacionEmisionFederacion(
          'lease_emision_perdido',
          'El escritor ya no puede consolidar el flujo.'
        );
      }
      const resultado = await operacion(conexion, filas[0]);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function asegurarControl(conexion, propietario) {
  await conexion.execute(`
    INSERT IGNORE INTO control_generaciones_emision_federacion (
      generacion_id,flujo_id,posicion_terminal_contigua,
      posicion_terminal_remota,version_cursor_remoto,pausa_hasta_utc,
      causa_pausa,pausas_consecutivas,actualizado_en_utc
    )
    SELECT ?,?,COALESCE(GREATEST(MIN(posicion_flujo)-1,0),0),0,0,
           NULL,NULL,0,UTC_TIMESTAMP(3)
      FROM outbox_federacion
     WHERE flujo_id=? AND generacion_id=?
  `, [propietario.generacion_id, propietario.flujo_id,
    propietario.flujo_id, propietario.generacion_id]);
  const [filas] = await conexion.execute(`
    SELECT * FROM control_generaciones_emision_federacion
     WHERE flujo_id=? AND generacion_id=? FOR UPDATE
  `, [propietario.flujo_id, propietario.generacion_id]);
  if (!filas[0]) {
    throw new ErrorCoordinacionEmisionFederacion(
      'control_emision_ausente',
      'No pudo crearse el control durable de la generación emisora.'
    );
  }
  return filas[0];
}

async function avanzarCursorLocal(conexion, propietario, control) {
  let posicion = BigInt(control.posicion_terminal_contigua);
  const [filas] = await conexion.execute(`
    SELECT posicion_flujo,estado FROM outbox_federacion
     WHERE flujo_id=? AND generacion_id=? AND posicion_flujo>?
     ORDER BY posicion_flujo FOR UPDATE
  `, [propietario.flujo_id, propietario.generacion_id, posicion.toString()]);
  for (const fila of filas) {
    const observada = BigInt(fila.posicion_flujo);
    if (observada !== posicion + 1n ||
        !['confirmada', 'bloqueada'].includes(fila.estado)) break;
    posicion = observada;
  }
  if (posicion !== BigInt(control.posicion_terminal_contigua)) {
    await conexion.execute(`
      UPDATE control_generaciones_emision_federacion
         SET posicion_terminal_contigua=?,actualizado_en_utc=UTC_TIMESTAMP(3)
       WHERE generacion_id=?
    `, [posicion.toString(), propietario.generacion_id]);
  }
  return posicion.toString();
}

async function guardarCursorRemoto(conexion, propietario, control, entrada) {
  if (!entrada || entrada.flujoId !== propietario.flujo_id ||
      entrada.generacionId !== propietario.generacion_id) {
    throw new ErrorCoordinacionEmisionFederacion(
      'cursor_remoto_incompatible',
      'El cursor remoto no pertenece al flujo y generación emisores.'
    );
  }
  const posicion = decimalNoNegativo(
    entrada.posicionTerminalContigua, 'posicionTerminalContigua'
  );
  const version = decimalPositivo(entrada.version, 'versionCursorRemoto');
  const posicionAnterior = BigInt(control.posicion_terminal_remota);
  const versionAnterior = BigInt(control.version_cursor_remoto);
  if (BigInt(posicion) < posicionAnterior || BigInt(version) < versionAnterior ||
      (BigInt(version) === versionAnterior && BigInt(posicion) !== posicionAnterior)) {
    throw new ErrorCoordinacionEmisionFederacion(
      'cursor_remoto_regresivo',
      'El receptor publicó un cursor que retrocede o reinterpreta su versión.'
    );
  }
  await conexion.execute(`
    UPDATE control_generaciones_emision_federacion
       SET posicion_terminal_remota=?,version_cursor_remoto=?,
           actualizado_en_utc=UTC_TIMESTAMP(3)
     WHERE generacion_id=?
  `, [posicion, version, propietario.generacion_id]);
  return Object.freeze({ posicionTerminalContigua: posicion, version });
}

async function actualizarPausa(conexion, propietario, {
  causa,
  demoraSegundos
}) {
  await conexion.execute(`
    UPDATE control_generaciones_emision_federacion
       SET pausa_hasta_utc=GREATEST(
             COALESCE(pausa_hasta_utc,UTC_TIMESTAMP(3)),
             TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3))
           ),
           causa_pausa=?,pausas_consecutivas=pausas_consecutivas+1,
           actualizado_en_utc=UTC_TIMESTAMP(3)
     WHERE flujo_id=? AND generacion_id=?
  `, [demoraSegundos, causa, propietario.flujo_id, propietario.generacion_id]);
}

async function limpiarPausaSiVencida(conexion, propietario) {
  await conexion.execute(`
    UPDATE control_generaciones_emision_federacion
       SET pausa_hasta_utc=NULL,causa_pausa=NULL,pausas_consecutivas=0,
           actualizado_en_utc=UTC_TIMESTAMP(3)
     WHERE flujo_id=? AND generacion_id=?
       AND pausa_hasta_utc IS NOT NULL AND pausa_hasta_utc<=UTC_TIMESTAMP(3)
  `, [propietario.flujo_id, propietario.generacion_id]);
}

function hidratarControl(fila) {
  return Object.freeze({
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_id,
    posicionTerminalContigua: String(fila.posicion_terminal_contigua),
    posicionTerminalRemota: String(fila.posicion_terminal_remota),
    versionCursorRemoto: String(fila.version_cursor_remoto),
    pausaHastaUtc: fila.pausa_hasta_utc,
    causaPausa: fila.causa_pausa,
    pausasConsecutivas: Number(fila.pausas_consecutivas)
  });
}

function normalizarEntregas(entradas) {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new Error('El aplazamiento exige entregas individuales.');
  }
  const normalizadas = entradas.map((entrada) => identidad(
    entrada, TIPOS_IDENTIDAD_FEDERADA.ENTREGA, 'entregaId'
  ));
  if (new Set(normalizadas).size !== normalizadas.length) {
    throw new Error('El aplazamiento repite una entrega.');
  }
  return normalizadas;
}

function codigoTecnico(valor, campo) {
  const codigo = String(valor || '').toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{0,63}$/u.test(codigo)) {
    throw new Error(`${campo} no es un código técnico válido.`);
  }
  return codigo;
}

function normalizarResultadoEmision(entrada = {}) {
  const entregaId = identidad(
    entrada.entregaId, TIPOS_IDENTIDAD_FEDERADA.ENTREGA, 'entregaId'
  );
  if (entrada.bloqueadaLocalmente === true) {
    return {
      entregaId,
      clasificacion: 'terminal',
      resultado: 'rechazadaDefinitiva',
      errorTerminal: ERRORES_TERMINALES_FEDERACION.exigir(entrada.errorTerminal),
      errorTemporal: null,
      bloqueadaLocalmente: true,
      intentadaRemotamente: false
    };
  }
  const clasificacion = entrada.clasificacion;
  if (!['terminal', 'temporal'].includes(clasificacion)) {
    throw new Error('La clasificación remota no es válida.');
  }
  const resultado = RESULTADOS_OCURRENCIA_FEDERACION.exigir(entrada.resultado);
  const errorTerminal = entrada.errorTerminal == null ? null :
    ERRORES_TERMINALES_FEDERACION.exigir(entrada.errorTerminal);
  const errorTemporal = entrada.errorTemporal == null ? null :
    ERRORES_TEMPORALES_FEDERACION.exigir(entrada.errorTemporal);
  if ((clasificacion === 'terminal' &&
        (errorTemporal !== null ||
          ['aplazadaCapacidad', 'aplazadaValidacion'].includes(resultado))) ||
      (clasificacion === 'temporal' &&
        (errorTerminal !== null || errorTemporal === null ||
          !['aplazadaCapacidad', 'aplazadaValidacion'].includes(resultado)))) {
    throw new Error('El resultado no coincide con su clasificación.');
  }
  return {
    entregaId,
    clasificacion,
    resultado,
    errorTerminal,
    errorTemporal,
    bloqueadaLocalmente: false,
    intentadaRemotamente: true
  };
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    throw new Error(`${campo} no es una identidad canónica.`);
  }
}

function normalizarLease(entrada = {}) {
  const token = String(entrada.leaseToken || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(token)) {
    throw new Error('leaseToken debe contener 32 bytes.');
  }
  const fencing = String(entrada.fencingToken ?? '');
  if (!/^[1-9][0-9]*$/u.test(fencing)) {
    throw new Error('fencingToken debe ser un entero positivo.');
  }
  return {
    propietarioId: decimalPositivo(entrada.propietarioId, 'propietarioId'),
    instanciaId: textoAscii(entrada.instanciaId, 128, 'instanciaId'),
    leaseToken: token,
    fencingToken: fencing
  };
}

function tokenLease(valor) {
  const token = Buffer.isBuffer(valor) ? Buffer.from(valor) : Buffer.alloc(0);
  if (token.length !== 32) throw new Error('leaseToken debe contener 32 bytes.');
  return token;
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto) || BigInt(texto) > MAX_BIGINT_UNSIGNED) {
    throw new Error(`${campo} no es válido.`);
  }
  return texto;
}

function decimalNoNegativo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto) || BigInt(texto) > MAX_BIGINT_UNSIGNED) {
    throw new Error(`${campo} no es válido.`);
  }
  return texto;
}

function textoAscii(valor, maximo, campo) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/u.test(texto)) {
    throw new Error(`${campo} debe ser texto ASCII válido.`);
  }
  return texto;
}

function enteroAcotado(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

async function rollbackSeguro(conexion) {
  try { await conexion.rollback(); } catch { /* conserva el error causal */ }
}
