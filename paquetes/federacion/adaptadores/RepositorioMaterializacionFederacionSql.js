import { randomBytes } from 'node:crypto';

import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

const MAX_BIGINT_UNSIGNED = 18446744073709551615n;
const generadorProyecciones = new GeneradorIdentidadesFederadas({
  fuenteEntropia: Object.freeze({
    entropiaBitsPorIdentidad: 128,
    generarBytes: ({ cantidadBytes }) => randomBytes(cantidadBytes)
  })
});

export class ErrorMaterializacionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorMaterializacionFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioMaterializacionFederacionSql {
  constructor(clienteSql, {
    generarProyeccionId = generarProyeccionIdSeguro,
    repositorioContribuciones = null,
    repositorioSoporteCampos = null,
    repositorioEstadoProyecciones = null,
    servicioRefederacion = null
  } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La materialización federada requiere SQL operativo.');
    }
    if (typeof generarProyeccionId !== 'function') {
      throw new Error('La materialización federada requiere generarProyeccionId().');
    }
    if (repositorioEstadoProyecciones !== null && (
      typeof repositorioEstadoProyecciones?.prepararEnTransaccion !== 'function' ||
      typeof repositorioEstadoProyecciones?.registrarResultadoEnTransaccion !== 'function'
    )) {
      throw new Error('El estado de proyecciones no implementa sus puertos transaccionales.');
    }
    if (servicioRefederacion !== null &&
        typeof servicioRefederacion?.registrarDesdeRecepcionEnTransaccion !== 'function') {
      throw new Error('La refederación no implementa su puerto transaccional de recepción.');
    }
    this.clienteSql = clienteSql;
    this.generarProyeccionId = generarProyeccionId;
    this.repositorioContribuciones = repositorioContribuciones;
    this.repositorioSoporteCampos = repositorioSoporteCampos;
    this.repositorioEstadoProyecciones = repositorioEstadoProyecciones;
    this.servicioRefederacion = servicioRefederacion;
  }

  async registrarTrabajoEnTransaccion({ lote, entrega, inboxId } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const ocurrencia = entrega?.ocurrencia;
    if (!inboxId || !ocurrencia) {
      throw new ErrorMaterializacionFederacion(
        'entrada_materializacion_incompleta',
        'El trabajo durable exige entrega aceptada e identidad de inbox.'
      );
    }
    const ahora = await ahoraSql(conexion);
    const clave = {
      relacionId: lote.relacionId,
      flujoId: lote.flujoId,
      generacionId: lote.generacionId,
      installationOrigenId: ocurrencia.installationOrigenId,
      familia: ocurrencia.familia,
      elementoOrigenId: ocurrencia.elementoOrigenId
    };
    const proyeccion = await resolverProyeccionBloqueada(conexion, {
      lote,
      ocurrencia,
      generarProyeccionId: this.generarProyeccionId,
      ahora
    });
    if (this.repositorioEstadoProyecciones) {
      await this.repositorioEstadoProyecciones.prepararEnTransaccion({
        proyeccionId: proyeccion.proyeccion_id,
        generacionId: lote.generacionId
      }, { conexion });
    }
    const contribucion = this.repositorioContribuciones
      ? await this.repositorioContribuciones.registrarEnTransaccion({
        lote,
        entrega,
        inboxId,
        proyeccionId: proyeccion.proyeccion_id
      }, { conexion })
      : null;
    const retiradaOrigenExistente = await obtenerRetiradaOrigen(
      conexion,
      proyeccion.proyeccion_id
    );
    const salidaContribucionExistente = contribucion
      ? await obtenerSalidaContribucion(conexion, contribucion.contribucionId)
      : null;
    const bloqueadaPorRetirada = Boolean(retiradaOrigenExistente);
    const bloqueadaPorSalida = Boolean(salidaContribucionExistente);
    const soporteCampos = contribucion && this.repositorioSoporteCampos &&
      ocurrencia.operacion === 'actualizacion' &&
      !bloqueadaPorRetirada && !bloqueadaPorSalida
      ? await this.repositorioSoporteCampos.aplicarEnTransaccion({
        contribucionId: contribucion.contribucionId,
        proyeccionId: proyeccion.proyeccion_id,
        generacionId: lote.generacionId,
        revisionConcesionId: lote.revisionConcesionEfectiva,
        inboxId,
        ocurrencia
      }, { conexion })
      : null;
    await avanzarWatermarkObservado(conexion, {
      ...clave,
      secuencia: ocurrencia.secuenciaElemento,
      ahora
    });
    const tombstoneExistente = await obtenerTombstone(conexion, clave);
    let tombstoneGobernante = tombstoneExistente;
    let retiradaOrigenGobernante = retiradaOrigenExistente;
    let salidaContribucionGobernante = salidaContribucionExistente;
    if (ocurrencia.operacion === 'retirada' && !retiradaOrigenExistente) {
      await conexion.execute(
        `INSERT INTO retiradas_origen_proyecciones_federacion (
           proyeccion_id,ocurrencia_origen_id,secuencia_retirada,
           relacion_observadora_id,flujo_observador_id,
           generacion_observadora_id,creada_en_utc
         ) VALUES (?,?,?,?,?,?,?)`,
        [
          proyeccion.proyeccion_id,
          ocurrencia.ocurrenciaOrigenId,
          ocurrencia.secuenciaElemento,
          lote.relacionId,
          lote.flujoId,
          lote.generacionId,
          ahora
        ]
      );
      retiradaOrigenGobernante = {
        ocurrencia_origen_id: ocurrencia.ocurrenciaOrigenId
      };
    }
    if (ocurrencia.operacion === 'salidaProyeccion' && contribucion &&
        !salidaContribucionExistente) {
      await conexion.execute(
        `INSERT INTO salidas_contribuciones_federacion (
           contribucion_id,ocurrencia_origen_id,secuencia_salida,creada_en_utc
         ) VALUES (?,?,?,?)`,
        [
          contribucion.contribucionId,
          ocurrencia.ocurrenciaOrigenId,
          ocurrencia.secuenciaElemento,
          ahora
        ]
      );
      salidaContribucionGobernante = {
        ocurrencia_origen_id: ocurrencia.ocurrenciaOrigenId
      };
    }
    if (ocurrencia.operacion === 'retirada' &&
        !tombstoneExistente) {
      await conexion.execute(
        `INSERT INTO tombstones_elementos_federacion (
           relacion_id,flujo_id,generacion_id,installation_origen_id,
           familia,elemento_origen_id,ocurrencia_origen_id,
           secuencia_retirada,operacion,creada_en_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          ...parametrosClave(clave), ocurrencia.ocurrenciaOrigenId,
          ocurrencia.secuenciaElemento, ocurrencia.operacion, ahora
        ]
      );
      tombstoneGobernante = {
        ocurrencia_origen_id: ocurrencia.ocurrenciaOrigenId
      };
      await suprimirTrabajosGobernadosPorTombstone(conexion, {
        ...clave,
        ocurrenciaTombstoneId: ocurrencia.ocurrenciaOrigenId,
        ahora
      });
    }
    if (this.repositorioSoporteCampos && contribucion) {
      if (retiradaOrigenGobernante &&
          retiradaOrigenGobernante.ocurrencia_origen_id ===
            ocurrencia.ocurrenciaOrigenId) {
        await retirarContribucionesProyeccion(conexion, {
          proyeccionId: proyeccion.proyeccion_id,
          repositorioSoporteCampos: this.repositorioSoporteCampos,
          causa: 'retiradaOrigen'
        });
        await suprimirTrabajosProyeccion(conexion, {
          proyeccionId: proyeccion.proyeccion_id,
          ocurrenciaGobernanteId: ocurrencia.ocurrenciaOrigenId,
          causa: 'retiradaOrigen',
          ahora
        });
      } else if (salidaContribucionGobernante &&
          salidaContribucionGobernante.ocurrencia_origen_id ===
            ocurrencia.ocurrenciaOrigenId) {
        await this.repositorioSoporteCampos.retirarContribucionEnTransaccion({
          contribucionId: contribucion.contribucionId,
          causa: 'salidaProyeccion'
        }, { conexion });
        await suprimirTrabajosContribucion(conexion, {
          contribucionId: contribucion.contribucionId,
          ocurrenciaGobernanteId: ocurrencia.ocurrenciaOrigenId,
          causa: 'salidaProyeccion',
          ahora
        });
      } else if (bloqueadaPorRetirada || bloqueadaPorSalida) {
        await this.repositorioSoporteCampos.retirarContribucionEnTransaccion({
          contribucionId: contribucion.contribucionId,
          causa: bloqueadaPorRetirada ? 'retiradaOrigen' : 'salidaProyeccion'
        }, { conexion });
      }
    }
    const esTombstoneGobernante = tombstoneGobernante &&
      tombstoneGobernante.ocurrencia_origen_id === ocurrencia.ocurrenciaOrigenId;
    const esRetiradaGobernante = retiradaOrigenGobernante &&
      retiradaOrigenGobernante.ocurrencia_origen_id === ocurrencia.ocurrenciaOrigenId;
    const esSalidaGobernante = salidaContribucionGobernante &&
      salidaContribucionGobernante.ocurrencia_origen_id === ocurrencia.ocurrenciaOrigenId;
    const suprimida = Boolean(
      (retiradaOrigenGobernante && !esRetiradaGobernante) ||
      (salidaContribucionGobernante && !esSalidaGobernante) ||
      (tombstoneGobernante && tombstoneGobernante.operacion === 'retirada' &&
        !esTombstoneGobernante)
    );
    const causaSupresion = retiradaOrigenGobernante && !esRetiradaGobernante
      ? 'retiradaOrigen'
      : salidaContribucionGobernante && !esSalidaGobernante
        ? 'salidaProyeccion'
        : suprimida ? 'tombstoneVigente' : 'ninguna';
    const prioridad = ocurrencia.operacion !== 'actualizacion' ||
      ocurrencia.vigenciaRestanteMs !== null
      ? 'operativaActual'
      : 'reconstruccion';
    const refederacion = this.servicioRefederacion && contribucion
      ? await this.servicioRefederacion.registrarDesdeRecepcionEnTransaccion({
        lote,
        entrega,
        inboxId,
        proyeccionId: proyeccion.proyeccion_id,
        contribucionId: contribucion.contribucionId
      }, { conexion })
      : null;
    const aplicacionExistente = await obtenerAplicacionProyeccion(
      conexion,
      proyeccion.proyeccion_id,
      inboxId,
      true
    );
    let claseTrabajo = 'aplicacion';
    if (aplicacionExistente) {
      await conexion.execute(
        `UPDATE aplicaciones_ocurrencias_proyecciones_federacion
            SET veces_observada=veces_observada+1,
                ultima_observacion_utc=GREATEST(ultima_observacion_utc,?)
          WHERE proyeccion_id=? AND inbox_ocurrencia_id=?`,
        [ahora, proyeccion.proyeccion_id, inboxId]
      );
      const cambioConsolidable = Boolean(
        contribucion?.contribucionNueva ||
        contribucion?.aporteNuevo ||
        soporteCampos?.aportados ||
        soporteCampos?.actualizados ||
        soporteCampos?.retirados
      );
      const generacionesPuedenCompartirTrabajo =
        aplicacionExistente.generacion_id === lote.generacionId || (
          aplicacionExistente.rol_generacion === 'activa' &&
          await esGeneracionActiva(conexion, lote.flujoId, lote.generacionId)
        );
      const trabajoOriginalPuedeAbsorber = ['pendiente', 'fallida'].includes(
        aplicacionExistente.estado
      ) && generacionesPuedenCompartirTrabajo;
      if (!cambioConsolidable || trabajoOriginalPuedeAbsorber || suprimida) {
        return Object.freeze({
          entregaId: aplicacionExistente.trabajo_entrega_id,
          proyeccionId: proyeccion.proyeccion_id,
          claseTrabajo: aplicacionExistente.clase_trabajo,
          estado: aplicacionExistente.estado,
          causaSupresion: aplicacionExistente.causa_supresion === 'ninguna'
            ? null
            : aplicacionExistente.causa_supresion,
          aplicacionNueva: false,
          reconsolidacionProgramada: false,
          contribucion,
          soporteCampos,
          refederacion
        });
      }
      claseTrabajo = 'consolidacion';
    }
    let trabajoExistente = null;
    try {
      await conexion.execute(
        `INSERT INTO trabajos_materializacion_federacion (
           entrega_id,inbox_ocurrencia_id,contribucion_id,
           proyeccion_id,clase_trabajo,
           relacion_id,flujo_id,generacion_id,
           posicion_flujo,installation_origen_id,familia,elemento_origen_id,
           ocurrencia_origen_id,secuencia_elemento,operacion,prioridad,
           estado,causa_supresion,intentos,fencing_token,propietario_lease,
           lease_hasta_utc,disponible_desde_utc,ultimo_error_codigo,
           creado_en_utc,actualizado_en_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,NULL,NULL,?,NULL,?,?)`,
        [
          entrega.entregaId, inboxId, contribucion?.contribucionId ?? null,
          proyeccion.proyeccion_id, claseTrabajo,
          lote.relacionId, lote.flujoId,
          lote.generacionId, entrega.posicionFlujo, ocurrencia.installationOrigenId,
          ocurrencia.familia, ocurrencia.elementoOrigenId,
          ocurrencia.ocurrenciaOrigenId, ocurrencia.secuenciaElemento,
          ocurrencia.operacion, prioridad,
          suprimida ? 'suprimida' : 'pendiente',
          causaSupresion,
          ahora, ahora, ahora
        ]
      );
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      trabajoExistente = await obtenerTrabajo(conexion, entrega.entregaId, true);
      if (!trabajoExistente ||
          !mismoTrabajo(trabajoExistente, {
            lote,
            entrega,
            inboxId,
            proyeccionId: proyeccion.proyeccion_id,
            claseTrabajo
          })) {
        throw new ErrorMaterializacionFederacion(
          'trabajo_materializacion_divergente',
          'La entrega ya identifica otro trabajo de materialización.'
        );
      }
    }
    if (!aplicacionExistente) {
      await conexion.execute(
        `INSERT INTO aplicaciones_ocurrencias_proyecciones_federacion (
           proyeccion_id,inbox_ocurrencia_id,trabajo_entrega_id,
           veces_observada,primera_observacion_utc,ultima_observacion_utc
         ) VALUES (?,?,?,1,?,?)`,
        [proyeccion.proyeccion_id, inboxId, entrega.entregaId, ahora, ahora]
      );
    }
    return Object.freeze({
      entregaId: entrega.entregaId,
      proyeccionId: proyeccion.proyeccion_id,
      claseTrabajo,
      estado: trabajoExistente?.estado ?? (suprimida ? 'suprimida' : 'pendiente'),
      causaSupresion: (trabajoExistente?.causa_supresion ?? (
          causaSupresion
      )) === 'ninguna'
        ? null
        : (trabajoExistente?.causa_supresion ?? causaSupresion),
      aplicacionNueva: !aplicacionExistente,
      reconsolidacionProgramada: Boolean(aplicacionExistente),
      contribucion,
      soporteCampos,
      refederacion
    });
  }

  async reclamarPendientes({ propietario, limite = 100, leaseMs = 30_000 } = {}) {
    validarPropietario(propietario);
    validarLimite(limite);
    validarLease(leaseMs);
    return this.#transaccion(async (conexion) => {
      const [filas] = await conexion.execute(
        `SELECT t.*
           FROM trabajos_materializacion_federacion t
           JOIN generaciones_flujos_federacion g
             ON g.flujo_id=t.flujo_id
            AND g.generacion_id=t.generacion_id
            AND g.rol_generacion='activa'
          WHERE (t.estado IN ('pendiente','fallida')
            OR (t.estado='procesando' AND t.lease_hasta_utc<=UTC_TIMESTAMP(3)))
            AND t.disponible_desde_utc<=UTC_TIMESTAMP(3)
          ORDER BY FIELD(t.prioridad,'operativaActual','reconstruccion'),
                   t.disponible_desde_utc,t.entrega_id
          LIMIT ? FOR UPDATE`,
        [limite]
      );
      const reclamados = [];
      for (const fila of filas) {
        const fencing = siguienteFencing(fila.fencing_token);
        await conexion.execute(
          `UPDATE trabajos_materializacion_federacion
              SET estado='procesando',intentos=intentos+1,fencing_token=?,
                  propietario_lease=?,
                  lease_hasta_utc=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MICROSECOND),
                  ultimo_error_codigo=NULL,actualizado_en_utc=UTC_TIMESTAMP(3)
            WHERE entrega_id=?`,
          [fencing, propietario, leaseMs * 1000, fila.entrega_id]
        );
        reclamados.push(mapearTrabajo({
          ...fila,
          estado: 'procesando',
          intentos: Number(fila.intentos) + 1,
          fencing_token: fencing,
          propietario_lease: propietario
        }));
      }
      return Object.freeze(reclamados);
    });
  }

  async completar({
    entregaId,
    propietario,
    fencingToken,
    requisitosPorCapacidad = null,
    cierreOperativoValidado = false
  } = {}) {
    return this.#cerrarTrabajo({
      entregaId,
      propietario,
      fencingToken,
      estado: 'materializada',
      errorCodigo: null,
      requisitosPorCapacidad,
      cierreOperativoValidado
    });
  }

  async completarEnTransaccion({
    entregaId,
    propietario,
    fencingToken,
    requisitosPorCapacidad = null,
    cierreOperativoValidado = false
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    return this.#cerrarTrabajoEnTransaccion({
      entregaId,
      propietario,
      fencingToken,
      estado: 'materializada',
      errorCodigo: null,
      requisitosPorCapacidad,
      cierreOperativoValidado
    }, conexion);
  }

  async fallar({
    entregaId,
    propietario,
    fencingToken,
    errorCodigo,
    reintentarDesdeUtc = null
  } = {}) {
    validarCodigoError(errorCodigo);
    return this.#cerrarTrabajo({
      entregaId,
      propietario,
      fencingToken,
      estado: 'fallida',
      errorCodigo,
      reintentarDesdeUtc
    });
  }

  async bloquear({
    entregaId,
    propietario,
    fencingToken,
    errorCodigo
  } = {}) {
    validarCodigoError(errorCodigo);
    return this.#cerrarTrabajo({
      entregaId,
      propietario,
      fencingToken,
      estado: 'bloqueada',
      errorCodigo
    });
  }

  async #cerrarTrabajo(entrada) {
    validarPropietario(entrada.propietario);
    validarFencing(entrada.fencingToken);
    return this.#transaccion((conexion) =>
      this.#cerrarTrabajoEnTransaccion(entrada, conexion));
  }

  async #cerrarTrabajoEnTransaccion(entrada, conexion) {
    validarPropietario(entrada.propietario);
    const fencing = validarFencing(entrada.fencingToken);
    const trabajo = await obtenerTrabajo(conexion, entrada.entregaId, true);
    if (!trabajo || trabajo.estado !== 'procesando' ||
        trabajo.propietario_lease !== entrada.propietario ||
        String(trabajo.fencing_token) !== fencing) {
      throw new ErrorMaterializacionFederacion(
        'fencing_materializacion_obsoleto',
        'El worker ya no gobierna este trabajo de materialización.'
      );
    }
    const disponible = entrada.reintentarDesdeUtc || await ahoraSql(conexion);
    await conexion.execute(
      `UPDATE trabajos_materializacion_federacion
          SET estado=?,causa_supresion='ninguna',propietario_lease=NULL,
              lease_hasta_utc=NULL,disponible_desde_utc=?,
              ultimo_error_codigo=?,actualizado_en_utc=UTC_TIMESTAMP(3)
        WHERE entrega_id=?`,
      [entrada.estado, disponible, entrada.errorCodigo, entrada.entregaId]
    );
    if (entrada.estado === 'materializada') {
      await conexion.execute(
        `UPDATE watermarks_elementos_federacion
            SET maxima_secuencia_materializada=GREATEST(
                  COALESCE(maxima_secuencia_materializada,0),?
                ),actualizada_en_utc=UTC_TIMESTAMP(3)
          WHERE relacion_id=? AND flujo_id=? AND generacion_id=?
            AND installation_origen_id=? AND familia=? AND elemento_origen_id=?`,
        [trabajo.secuencia_elemento, ...parametrosClaveFila(trabajo)]
      );
    }
    const estadoProyeccion = this.repositorioEstadoProyecciones
      ? await this.repositorioEstadoProyecciones.registrarResultadoEnTransaccion({
        entregaId: entrada.entregaId,
        estadoMaterializacion: entrada.estado === 'bloqueada'
          ? 'fallida'
          : entrada.estado,
        requisitosPorCapacidad: entrada.requisitosPorCapacidad ?? null,
        cierreOperativoValidado: entrada.cierreOperativoValidado ?? false
      }, { conexion })
      : null;
    return Object.freeze({
      entregaId: entrada.entregaId,
      estado: entrada.estado,
      ...(estadoProyeccion ? { estadoProyeccion } : {})
    });
  }

  async #transaccion(operacion) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await operacion(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function obtenerRetiradaOrigen(conexion, proyeccionId) {
  const [filas] = await conexion.execute(
    `SELECT ocurrencia_origen_id,secuencia_retirada
       FROM retiradas_origen_proyecciones_federacion
      WHERE proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  return filas[0] || null;
}

async function obtenerSalidaContribucion(conexion, contribucionId) {
  const [filas] = await conexion.execute(
    `SELECT ocurrencia_origen_id,secuencia_salida
       FROM salidas_contribuciones_federacion
      WHERE contribucion_id=? FOR UPDATE`,
    [contribucionId]
  );
  return filas[0] || null;
}

async function retirarContribucionesProyeccion(conexion, {
  proyeccionId,
  repositorioSoporteCampos,
  causa
}) {
  const [filas] = await conexion.execute(
    `SELECT contribucion_id
       FROM contribuciones_proyecciones_federacion
      WHERE proyeccion_id=? AND estado_soporte='activa'
      ORDER BY contribucion_id FOR UPDATE`,
    [proyeccionId]
  );
  for (const fila of filas) {
    await repositorioSoporteCampos.retirarContribucionEnTransaccion({
      contribucionId: fila.contribucion_id,
      causa
    }, { conexion });
  }
}

async function suprimirTrabajosProyeccion(conexion, entrada) {
  await exigirFencingRevocable(conexion, {
    join: '',
    predicado: 't.proyeccion_id=?',
    parametros: [entrada.proyeccionId]
  });
  await conexion.execute(
    `UPDATE trabajos_materializacion_federacion t
       SET t.fencing_token=CASE
              WHEN t.estado='procesando' THEN t.fencing_token+1
              ELSE t.fencing_token
            END,
            t.estado='suprimida',t.causa_supresion=?,
            t.propietario_lease=NULL,t.lease_hasta_utc=NULL,
            t.ultimo_error_codigo=NULL,t.actualizado_en_utc=?
      WHERE t.proyeccion_id=? AND t.ocurrencia_origen_id<>?
        AND t.estado IN ('pendiente','fallida','procesando')`,
    [
      entrada.causa,
      entrada.ahora,
      entrada.proyeccionId,
      entrada.ocurrenciaGobernanteId
    ]
  );
}

async function suprimirTrabajosContribucion(conexion, entrada) {
  await exigirFencingRevocable(conexion, {
    join: '',
    predicado: 't.contribucion_id=?',
    parametros: [entrada.contribucionId]
  });
  await conexion.execute(
    `UPDATE trabajos_materializacion_federacion t
        SET t.fencing_token=CASE
              WHEN t.estado='procesando' THEN t.fencing_token+1
              ELSE t.fencing_token
            END,
            t.estado='suprimida',t.causa_supresion=?,
            t.propietario_lease=NULL,t.lease_hasta_utc=NULL,
            t.ultimo_error_codigo=NULL,t.actualizado_en_utc=?
      WHERE t.contribucion_id=? AND t.ocurrencia_origen_id<>?
        AND t.estado IN ('pendiente','fallida','procesando')`,
    [
      entrada.causa,
      entrada.ahora,
      entrada.contribucionId,
      entrada.ocurrenciaGobernanteId
    ]
  );
}

async function exigirFencingRevocable(conexion, { join, predicado, parametros }) {
  const [filas] = await conexion.execute(
    `SELECT t.entrega_id FROM trabajos_materializacion_federacion t
       ${join}
      WHERE ${predicado} AND t.estado='procesando' AND t.fencing_token=?
      LIMIT 1 FOR UPDATE`,
    [...parametros, MAX_BIGINT_UNSIGNED.toString()]
  );
  if (filas[0]) {
    throw new ErrorMaterializacionFederacion(
      'fencing_materializacion_agotado',
      'La retirada no puede revocar un trabajo cuyo fencing agotó BIGINT UNSIGNED.'
    );
  }
}

async function suprimirTrabajosGobernadosPorTombstone(conexion, entrada) {
  const [fencingAgotado] = await conexion.execute(
    `SELECT entrega_id FROM trabajos_materializacion_federacion
      WHERE relacion_id=? AND flujo_id=? AND generacion_id=?
        AND installation_origen_id=? AND familia=? AND elemento_origen_id=?
        AND ocurrencia_origen_id<>? AND estado='procesando'
        AND fencing_token=?
      LIMIT 1 FOR UPDATE`,
    [
      ...parametrosClave(entrada), entrada.ocurrenciaTombstoneId,
      MAX_BIGINT_UNSIGNED.toString()
    ]
  );
  if (fencingAgotado[0]) {
    throw new ErrorMaterializacionFederacion(
      'fencing_materializacion_agotado',
      'La retirada no puede revocar un trabajo cuyo fencing agotó BIGINT UNSIGNED.'
    );
  }
  await conexion.execute(
    `UPDATE trabajos_materializacion_federacion
        SET fencing_token=CASE
              WHEN estado='procesando' THEN fencing_token+1
              ELSE fencing_token
            END,
            estado='suprimida',causa_supresion='tombstoneVigente',
            propietario_lease=NULL,lease_hasta_utc=NULL,
            ultimo_error_codigo=NULL,actualizado_en_utc=?
      WHERE relacion_id=? AND flujo_id=? AND generacion_id=?
        AND installation_origen_id=? AND familia=? AND elemento_origen_id=?
        AND ocurrencia_origen_id<>?
        AND estado IN ('pendiente','fallida','procesando')`,
    [
      entrada.ahora, ...parametrosClave(entrada),
      entrada.ocurrenciaTombstoneId
    ]
  );
}

async function avanzarWatermarkObservado(conexion, entrada) {
  await conexion.execute(
    `INSERT INTO watermarks_elementos_federacion (
       relacion_id,flujo_id,generacion_id,installation_origen_id,familia,
       elemento_origen_id,maxima_secuencia_observada,
       maxima_secuencia_materializada,actualizada_en_utc
     ) VALUES (?,?,?,?,?,?,?,NULL,?)
     ON DUPLICATE KEY UPDATE
       maxima_secuencia_observada=GREATEST(maxima_secuencia_observada,VALUES(maxima_secuencia_observada)),
       actualizada_en_utc=GREATEST(actualizada_en_utc,VALUES(actualizada_en_utc))`,
    [...parametrosClave(entrada), entrada.secuencia, entrada.ahora]
  );
}

async function obtenerTombstone(conexion, clave) {
  const [filas] = await conexion.execute(
    `SELECT ocurrencia_origen_id,secuencia_retirada,operacion
       FROM tombstones_elementos_federacion
      WHERE relacion_id=? AND flujo_id=? AND generacion_id=?
        AND installation_origen_id=? AND familia=? AND elemento_origen_id=?
      FOR UPDATE`,
    parametrosClave(clave)
  );
  return filas[0] || null;
}

async function obtenerTrabajo(conexion, entregaId, bloquear = false) {
  const [filas] = await conexion.execute(
    `SELECT t.*
       FROM trabajos_materializacion_federacion t
      WHERE t.entrega_id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [entregaId]
  );
  return filas[0] || null;
}

function mismoTrabajo(fila, {
  lote,
  entrega,
  inboxId,
  proyeccionId,
  claseTrabajo
}) {
  const ocurrencia = entrega.ocurrencia;
  return String(fila.inbox_ocurrencia_id) === String(inboxId) &&
    fila.proyeccion_id === proyeccionId && fila.clase_trabajo === claseTrabajo &&
    fila.relacion_id === lote.relacionId && fila.flujo_id === lote.flujoId &&
    fila.generacion_id === lote.generacionId &&
    String(fila.posicion_flujo) === entrega.posicionFlujo &&
    fila.installation_origen_id === ocurrencia.installationOrigenId &&
    fila.familia === ocurrencia.familia &&
    fila.elemento_origen_id === ocurrencia.elementoOrigenId &&
    fila.ocurrencia_origen_id === ocurrencia.ocurrenciaOrigenId;
}

function mapearTrabajo(fila) {
  return Object.freeze({
    entregaId: fila.entrega_id,
    proyeccionId: fila.proyeccion_id,
    inboxId: String(fila.inbox_ocurrencia_id),
    relacionId: fila.relacion_id,
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_id,
    familia: fila.familia,
    operacion: fila.operacion,
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    ocurrenciaOrigenId: fila.ocurrencia_origen_id,
    secuenciaElemento: String(fila.secuencia_elemento),
    posicionFlujo: String(fila.posicion_flujo),
    prioridad: fila.prioridad,
    claseTrabajo: fila.clase_trabajo,
    estado: fila.estado,
    intentos: Number(fila.intentos),
    fencingToken: String(fila.fencing_token),
    propietario: fila.propietario_lease
  });
}

async function resolverProyeccionBloqueada(conexion, {
  lote,
  ocurrencia,
  generarProyeccionId,
  ahora
}) {
  const [flujos] = await conexion.execute(
    `SELECT f.direccion,f.familia,f.scope_nivel,f.scope_tenant_id,
            f.scope_empresa_id,f.scope_sitio_id
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
      WHERE f.flujo_id=? AND f.relacion_id=? FOR UPDATE`,
    [lote.generacionId, lote.flujoId, lote.relacionId]
  );
  const flujo = flujos[0];
  if (!flujo || flujo.direccion !== 'recepcion' || flujo.familia !== ocurrencia.familia) {
    throw new ErrorMaterializacionFederacion(
      'contexto_proyeccion_incompatible',
      'La entrega no pertenece a un flujo receptor de la misma familia.'
    );
  }
  const clave = [
    ocurrencia.installationOrigenId,
    ocurrencia.familia,
    ocurrencia.elementoOrigenId,
    flujo.scope_nivel,
    flujo.scope_tenant_id,
    flujo.scope_empresa_id,
    flujo.scope_sitio_id
  ];
  let proyeccion = await buscarProyeccionPorContexto(conexion, clave, true);
  if (proyeccion) return proyeccion;
  for (let intento = 1; intento <= 4; intento += 1) {
    const proyeccionId = normalizarProyeccionId(generarProyeccionId());
    try {
      await conexion.execute(
        `INSERT INTO proyecciones_federacion (
           proyeccion_id,installation_origen_id,familia,elemento_origen_id,
           scope_nivel,scope_tenant_id,scope_empresa_id,scope_sitio_id,
           creada_en_utc
         ) VALUES (?,?,?,?,?,?,?,?,?)`,
        [proyeccionId, ...clave, ahora]
      );
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
    }
    proyeccion = await buscarProyeccionPorContexto(conexion, clave, true);
    if (proyeccion) return proyeccion;
    if (intento === 4) {
      throw new ErrorMaterializacionFederacion(
        'identidad_proyeccion_agotada',
        'No fue posible reservar una identidad opaca única para la proyección.'
      );
    }
  }
  throw new Error('Estado inalcanzable al resolver una proyección federada.');
}

async function buscarProyeccionPorContexto(conexion, clave, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT * FROM proyecciones_federacion
      WHERE installation_origen_id=? AND familia=? AND elemento_origen_id=?
        AND scope_nivel=? AND scope_tenant_id<=>?
        AND scope_empresa_id<=>? AND scope_sitio_id<=>?
      LIMIT 1${bloquear ? ' FOR UPDATE' : ''}`,
    clave
  );
  return filas[0] || null;
}

async function obtenerAplicacionProyeccion(
  conexion,
  proyeccionId,
  inboxId,
  bloquear
) {
  const [filas] = await conexion.execute(
    `SELECT a.*,t.estado,t.causa_supresion,t.clase_trabajo,t.generacion_id,
            g.rol_generacion
       FROM aplicaciones_ocurrencias_proyecciones_federacion a
       JOIN trabajos_materializacion_federacion t
         ON t.entrega_id=a.trabajo_entrega_id
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=t.flujo_id AND g.generacion_id=t.generacion_id
      WHERE a.proyeccion_id=? AND a.inbox_ocurrencia_id=?
      LIMIT 1${bloquear ? ' FOR UPDATE' : ''}`,
    [proyeccionId, inboxId]
  );
  return filas[0] || null;
}

async function esGeneracionActiva(conexion, flujoId, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT COUNT(*) AS total
       FROM flujos_federacion
      WHERE flujo_id=? AND generacion_activa_id=?`,
    [flujoId, generacionId]
  );
  return Number(filas[0].total) === 1;
}

function normalizarProyeccionId(valor) {
  return String(crearIdentidadFederada({
    tipo: TIPOS_IDENTIDAD_FEDERADA.PROYECCION,
    valor: String(valor ?? '')
  }));
}

function generarProyeccionIdSeguro() {
  return generadorProyecciones.generar(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
}

function parametrosClave(clave) {
  return [
    clave.relacionId, clave.flujoId, clave.generacionId,
    clave.installationOrigenId, clave.familia, clave.elementoOrigenId
  ];
}

function parametrosClaveFila(fila) {
  return [
    fila.relacion_id, fila.flujo_id, fila.generacion_id,
    fila.installation_origen_id, fila.familia, fila.elemento_origen_id
  ];
}

function siguienteFencing(valor) {
  const actual = BigInt(valor);
  if (actual >= MAX_BIGINT_UNSIGNED) {
    throw new ErrorMaterializacionFederacion(
      'fencing_materializacion_agotado',
      'El fencing de materialización agotó BIGINT UNSIGNED.'
    );
  }
  return String(actual + 1n);
}

function validarPropietario(valor) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(valor)) {
    throw new ErrorMaterializacionFederacion(
      'propietario_materializacion_invalido',
      'El propietario del trabajo no es canónico.'
    );
  }
}

function validarLimite(valor) {
  if (!Number.isInteger(valor) || valor < 1 || valor > 1000) throw new Error('limite inválido.');
}

function validarLease(valor) {
  if (!Number.isSafeInteger(valor) || valor < 1000 || valor > 3_600_000) {
    throw new Error('leaseMs inválido.');
  }
}

function validarFencing(valor) {
  if (!/^[1-9][0-9]*$/u.test(String(valor ?? '')) || BigInt(valor) > MAX_BIGINT_UNSIGNED) {
    throw new ErrorMaterializacionFederacion('fencing_invalido', 'fencingToken no es válido.');
  }
  return String(valor);
}

function validarCodigoError(valor) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_.:-]{1,96}$/u.test(valor)) {
    throw new ErrorMaterializacionFederacion('error_materializacion_invalido', 'errorCodigo no es válido.');
  }
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) throw new Error('Se requiere conexión SQL prestada.');
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) throw new Error('Se requiere una transacción SQL activa.');
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}
