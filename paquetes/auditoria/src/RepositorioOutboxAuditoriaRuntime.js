import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from './UuidV7Auditoria.js';
import { prepararIntencionAuditoriaV1 } from './HuellaIntencionAuditoria.js';

const PRODUCTORES_RUNTIME = new Set([
  'runtime_alertas',
  'runtime_automatizacion',
  'runtime_agentes',
  'runtime_dns',
  'runtime_federacion'
]);
const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;

export class ConflictoOutboxAuditoriaRuntime extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ConflictoOutboxAuditoriaRuntime';
    this.codigo = 'conflicto_outbox_auditoria_runtime';
  }
}

export class LeaseOutboxAuditoriaPerdido extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'LeaseOutboxAuditoriaPerdido';
    this.codigo = 'lease_outbox_auditoria_perdido';
  }
}

export class RepositorioOutboxAuditoriaRuntime {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La outbox de auditoría requiere un cliente SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async encolarAtomico(intenciones = [], opciones = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await this.encolarEnTransaccion(intenciones, {
        ...opciones,
        conexion
      });
      await conexion.commit();
      return resultado;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async encolarEnTransaccion(
    intenciones = [],
    { conexion, maxIntentos = 8 } = {}
  ) {
    exigirConexion(conexion);
    const limiteIntentos = enteroAcotado(
      maxIntentos,
      1,
      100,
      'maxIntentos debe estar entre 1 y 100.'
    );
    const preparadas = prepararLote(intenciones);
    const claves = ordenarBinarioUnico(
      preparadas.map(({ intencion }) => intencion.claveCadena)
    );
    const cabeceras = new Map();

    for (const claveCadena of claves) {
      const muestra = preparadas.find(
        ({ intencion }) => intencion.claveCadena === claveCadena
      ).intencion;
      await conexion.execute(
        `
          INSERT IGNORE INTO cabeceras_outbox_auditoria_runtime (
            clave_cadena, flujo, tenant_id, ultimo_orden,
            creada_en_utc, actualizada_en_utc
          ) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        `,
        [claveCadena, muestra.flujo, muestra.scope.tenantId]
      );
      const [filas] = await conexion.execute(
        `
          SELECT
            id, clave_cadena, flujo,
            CAST(tenant_id AS CHAR) AS tenant_id,
            CAST(ultimo_orden AS CHAR) AS ultimo_orden
          FROM cabeceras_outbox_auditoria_runtime
          WHERE clave_cadena = ?
          LIMIT 1
          FOR UPDATE
        `,
        [claveCadena]
      );
      if (filas.length !== 1) {
        throw new Error(`No se pudo bloquear la cabecera outbox ${claveCadena}.`);
      }
      const cabecera = {
        id: filas[0].id,
        claveCadena: filas[0].clave_cadena,
        flujo: filas[0].flujo,
        tenantId: filas[0].tenant_id,
        ultimoOrden: BigInt(filas[0].ultimo_orden)
      };
      if (
        cabecera.flujo !== muestra.flujo ||
        cabecera.tenantId !== muestra.scope.tenantId
      ) {
        throw new ConflictoOutboxAuditoriaRuntime(
          `La cabecera ${claveCadena} contradice el flujo o tenant de la obligación.`
        );
      }
      cabeceras.set(claveCadena, cabecera);
    }

    const resultados = [];
    for (const preparada of ordenarObligaciones(preparadas)) {
      const existente = await buscarObligacionPorIdentidad(
        conexion,
        preparada.intencion
      );
      if (existente) {
        if (
          !Buffer.from(existente.huella_intencion).equals(preparada.huella) ||
          !Buffer.from(existente.evento_id).equals(
            uuidV7AuditoriaABytes(preparada.intencion.eventoId)
          )
        ) {
          throw new ConflictoOutboxAuditoriaRuntime(
            'La identidad outbox ya protege otra intención causal.'
          );
        }
        resultados.push(serializarObligacion(existente, 'existente'));
        continue;
      }
      const conflictoEvento = await buscarObligacionPorEvento(
        conexion,
        preparada.intencion.eventoId
      );
      if (conflictoEvento) {
        throw new ConflictoOutboxAuditoriaRuntime(
          `El eventoId ${preparada.intencion.eventoId} ya pertenece a otra obligación.`
        );
      }
      const cabecera = cabeceras.get(preparada.intencion.claveCadena);
      const orden = cabecera.ultimoOrden + 1n;
      if (orden > MAX_BIGINT_UNSIGNED) {
        throw new ConflictoOutboxAuditoriaRuntime(
          `La cabecera outbox ${cabecera.claveCadena} agotó su orden causal.`
        );
      }
      const [insercion] = await conexion.execute(
        construirSqlInsercion(),
        construirParametrosInsercion({
          preparada,
          cabecera,
          orden,
          maxIntentos: limiteIntentos
        })
      );
      cabecera.ultimoOrden = orden;
      cabecera.modificada = true;
      resultados.push({
        id: String(insercion.insertId),
        eventoId: preparada.intencion.eventoId,
        claveCadena: cabecera.claveCadena,
        ordenObligacion: String(orden),
        estado: 'pendiente',
        resultadoAlta: 'creada'
      });
    }

    for (const cabecera of cabeceras.values()) {
      if (!cabecera.modificada) continue;
      await conexion.execute(
        `
          UPDATE cabeceras_outbox_auditoria_runtime
          SET ultimo_orden = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE id = ?
        `,
        [String(cabecera.ultimoOrden), cabecera.id]
      );
    }
    return Object.freeze(resultados.map((resultado) => Object.freeze(resultado)));
  }

  async reclamarSiguienteConLease({
    instanciaId,
    leaseToken,
    ttlSegundos = 30
  } = {}) {
    const instancia = textoAscii(
      instanciaId,
      128,
      'instanciaId es obligatorio para reclamar la outbox.'
    );
    const token = normalizarLeaseTokenBuffer(leaseToken);
    const ttl = enteroAcotado(ttlSegundos, 5, 3600, 'El TTL debe estar entre 5 y 3600 segundos.');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conexion.beginTransaction();
      while (true) {
        const [candidatos] = await conexion.execute(`
          SELECT
            o.id,
            o.clave_cadena,
            CAST(o.orden_obligacion AS CHAR) AS orden_obligacion,
            CAST(o.intentos AS UNSIGNED) AS intentos,
            CAST(o.max_intentos AS UNSIGNED) AS max_intentos,
            CAST(o.fencing_token AS CHAR) AS fencing_token
          FROM outbox_auditoria_runtime o
          INNER JOIN (
            SELECT clave_cadena, MIN(orden_obligacion) AS primer_orden
            FROM outbox_auditoria_runtime
            WHERE estado <> 'completada'
            GROUP BY clave_cadena
          ) primera
            ON primera.clave_cadena = o.clave_cadena
           AND primera.primer_orden = o.orden_obligacion
          WHERE (
              o.estado IN ('pendiente', 'reintentable')
              AND o.proximo_intento_utc <= UTC_TIMESTAMP(3)
            ) OR (
              o.estado = 'procesando'
              AND o.lease_expira_utc <= UTC_TIMESTAMP(3)
          )
          ORDER BY o.clave_cadena ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);
        const candidato = candidatos[0];
        if (!candidato) {
          await conexion.commit();
          return null;
        }
        const [primera] = await conexion.execute(
          `
            SELECT id
            FROM outbox_auditoria_runtime
            WHERE clave_cadena = ? AND estado <> 'completada'
            ORDER BY orden_obligacion ASC
            LIMIT 1
            FOR UPDATE
          `,
          [candidato.clave_cadena]
        );
        if (String(primera[0]?.id) !== String(candidato.id)) {
          await conexion.commit();
          return null;
        }
        const intentos = Number(candidato.intentos);
        const maxIntentos = Number(candidato.max_intentos);
        const fencing = BigInt(candidato.fencing_token);
        if (intentos >= maxIntentos || fencing >= MAX_BIGINT_UNSIGNED) {
          await bloquearPorAgotamiento(conexion, candidato.id, {
            codigo: fencing >= MAX_BIGINT_UNSIGNED
              ? 'fencing_agotado'
              : 'intentos_agotados',
            mensaje: fencing >= MAX_BIGINT_UNSIGNED
              ? 'La obligación agotó su contador de fencing.'
              : 'La obligación agotó sus intentos configurados.'
          });
          continue;
        }
        const siguienteFencing = fencing + 1n;
        const [actualizacion] = await conexion.execute(
          `
            UPDATE outbox_auditoria_runtime
            SET
              estado = 'procesando',
              intentos = intentos + 1,
              instancia_id = ?,
              lease_token = ?,
              lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
              fencing_token = ?,
              ultimo_codigo_error = NULL,
              ultimo_mensaje_error = NULL,
              actualizada_en_utc = UTC_TIMESTAMP(3)
            WHERE id = ?
              AND (
                (estado IN ('pendiente', 'reintentable') AND proximo_intento_utc <= UTC_TIMESTAMP(3))
                OR (estado = 'procesando' AND lease_expira_utc <= UTC_TIMESTAMP(3))
              )
          `,
          [instancia, token, ttl, String(siguienteFencing), candidato.id]
        );
        if (Number(actualizacion.affectedRows) !== 1) continue;
        const fila = await buscarObligacionPorId(conexion, candidato.id);
        await conexion.commit();
        return Object.freeze(serializarObligacion(fila, null));
      }
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async renovarLease(datos, { ttlSegundos = 30 } = {}) {
    const lease = normalizarLease(datos);
    const ttl = enteroAcotado(ttlSegundos, 5, 3600, 'El TTL debe estar entre 5 y 3600 segundos.');
    const [resultado] = await this.clienteSql.ejecutar(
      `
        UPDATE outbox_auditoria_runtime
        SET lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
            actualizada_en_utc = UTC_TIMESTAMP(3)
        WHERE id = ? AND estado = 'procesando'
          AND instancia_id = ? AND lease_token = ? AND fencing_token = ?
          AND lease_expira_utc > UTC_TIMESTAMP(3)
      `,
      [ttl, lease.id, lease.instanciaId, lease.leaseToken, lease.fencingToken]
    );
    return Number(resultado.affectedRows) === 1;
  }

  async comprobarLeaseVigente(datos) {
    const lease = normalizarLease(datos);
    const filas = await this.clienteSql.consultar(
      `
        SELECT id FROM outbox_auditoria_runtime
        WHERE id = ? AND estado = 'procesando'
          AND instancia_id = ? AND lease_token = ? AND fencing_token = ?
          AND lease_expira_utc > UTC_TIMESTAMP(3)
        LIMIT 1
      `,
      [lease.id, lease.instanciaId, lease.leaseToken, lease.fencingToken]
    );
    return filas.length === 1;
  }

  async bloquearLeaseVigente(datos, { conexion } = {}) {
    exigirConexion(conexion);
    const lease = normalizarLease(datos);
    const [filas] = await conexion.execute(
      `
        SELECT ${columnasObligacion('o')}
        FROM outbox_auditoria_runtime o
        WHERE o.id = ?
          AND o.estado = 'procesando'
          AND o.instancia_id = ?
          AND o.lease_token = ?
          AND o.fencing_token = ?
          AND o.lease_expira_utc > UTC_TIMESTAMP(3)
        LIMIT 1
        FOR UPDATE
      `,
      [lease.id, lease.instanciaId, lease.leaseToken, lease.fencingToken]
    );
    if (filas.length !== 1) {
      throw new LeaseOutboxAuditoriaPerdido(
        'La obligación ya no conserva el lease y fencing presentados.'
      );
    }
    return serializarObligacion(filas[0], null);
  }

  async marcarCompletada(datos, { conexion } = {}) {
    exigirConexion(conexion);
    const lease = normalizarLease(datos);
    const eventoId = uuidV7AuditoriaABytes(datos.eventoId, 'eventoId incorporado');
    const [resultado] = await conexion.execute(
      `
        UPDATE outbox_auditoria_runtime
        SET
          estado = 'completada',
          instancia_id = NULL,
          lease_token = NULL,
          lease_expira_utc = NULL,
          ultimo_codigo_error = NULL,
          ultimo_mensaje_error = NULL,
          evento_incorporado_id = ?,
          completada_en_utc = UTC_TIMESTAMP(3),
          actualizada_en_utc = UTC_TIMESTAMP(3)
        WHERE id = ?
          AND estado = 'procesando'
          AND instancia_id = ?
          AND lease_token = ?
          AND fencing_token = ?
          AND lease_expira_utc > UTC_TIMESTAMP(3)
          AND evento_id = ?
      `,
      [
        eventoId,
        lease.id,
        lease.instanciaId,
        lease.leaseToken,
        lease.fencingToken,
        eventoId
      ]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new LeaseOutboxAuditoriaPerdido(
        'La obligación perdió su lease antes de consolidar el evento.'
      );
    }
  }

  async registrarFallo({
    id,
    instanciaId,
    leaseToken,
    fencingToken,
    permanente = false,
    codigoError = 'error_outbox',
    mensajeError = 'No se pudo incorporar la obligación auditable.',
    demoraReintentoSegundos = 5
  } = {}) {
    const lease = normalizarLease({ id, instanciaId, leaseToken, fencingToken });
    const demora = enteroAcotado(
      demoraReintentoSegundos,
      1,
      86400,
      'La demora de reintento debe estar entre 1 y 86400 segundos.'
    );
    const diagnostico = sanearDiagnostico(codigoError, mensajeError);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(
        `
          SELECT intentos, max_intentos
          FROM outbox_auditoria_runtime
          WHERE id = ?
            AND estado = 'procesando'
            AND instancia_id = ?
            AND lease_token = ?
            AND fencing_token = ?
            AND lease_expira_utc > UTC_TIMESTAMP(3)
          LIMIT 1
          FOR UPDATE
        `,
        [lease.id, lease.instanciaId, lease.leaseToken, lease.fencingToken]
      );
      if (filas.length !== 1) {
        throw new LeaseOutboxAuditoriaPerdido(
          'No puede registrarse el fallo con un lease vencido o sustituido.'
        );
      }
      const bloquear = permanente || Number(filas[0].intentos) >= Number(filas[0].max_intentos);
      await conexion.execute(
        `
          UPDATE outbox_auditoria_runtime
          SET
            estado = ?,
            proximo_intento_utc = CASE
              WHEN ? = 'reintentable' THEN TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
              ELSE proximo_intento_utc
            END,
            instancia_id = NULL,
            lease_token = NULL,
            lease_expira_utc = NULL,
            ultimo_codigo_error = ?,
            ultimo_mensaje_error = ?,
            actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE id = ?
        `,
        [
          bloquear ? 'bloqueo_permanente' : 'reintentable',
          bloquear ? 'bloqueo_permanente' : 'reintentable',
          demora,
          diagnostico.codigo,
          diagnostico.mensaje,
          lease.id
        ]
      );
      await conexion.commit();
      return Object.freeze({
        estado: bloquear ? 'bloqueo_permanente' : 'reintentable',
        intentos: Number(filas[0].intentos),
        maxIntentos: Number(filas[0].max_intentos)
      });
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async listarBloqueadas({ limite = 100 } = {}) {
    const maximo = enteroAcotado(limite, 1, 500, 'El límite debe estar entre 1 y 500.');
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${columnasObligacion('o')}
        FROM outbox_auditoria_runtime o
        WHERE o.estado = 'bloqueo_permanente'
        ORDER BY o.clave_cadena, o.orden_obligacion
        LIMIT ?
      `,
      [maximo]
    );
    return filas.map((fila) => serializarObligacion(fila, null));
  }

  async rehabilitarBloqueada(id) {
    const obligacionId = idDecimal(id, 'La obligación bloqueada no es válida.');
    const [resultado] = await this.clienteSql.ejecutar(
      `
        UPDATE outbox_auditoria_runtime
        SET
          estado = 'reintentable',
          intentos = 0,
          proximo_intento_utc = UTC_TIMESTAMP(3),
          ultimo_codigo_error = NULL,
          ultimo_mensaje_error = NULL,
          actualizada_en_utc = UTC_TIMESTAMP(3)
        WHERE id = ? AND estado = 'bloqueo_permanente'
      `,
      [obligacionId]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('La obligación no está bloqueada o ya fue rehabilitada.');
    }
    return Object.freeze({ id: obligacionId, estado: 'reintentable' });
  }

  async limpiarCompletadas({ diasGracia = 30, limite = 500 } = {}) {
    const dias = enteroAcotado(diasGracia, 1, 3650, 'La gracia debe estar entre 1 y 3650 días.');
    const maximo = enteroAcotado(limite, 1, 5000, 'El lote debe estar entre 1 y 5000.');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(
        `
          SELECT id
          FROM outbox_auditoria_runtime
          WHERE estado = 'completada'
            AND completada_en_utc < TIMESTAMPADD(DAY, -?, UTC_TIMESTAMP(3))
          ORDER BY completada_en_utc, id
          LIMIT ?
          FOR UPDATE SKIP LOCKED
        `,
        [dias, maximo]
      );
      if (filas.length > 0) {
        const ids = filas.map(({ id }) => id);
        await conexion.execute(
          `DELETE FROM outbox_auditoria_runtime WHERE id IN (${marcadores(ids)})`,
          ids
        );
      }
      await conexion.commit();
      return Object.freeze({ eliminadas: filas.length, diasGracia: dias });
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }
}

function prepararLote(intenciones) {
  if (!Array.isArray(intenciones) || intenciones.length === 0) {
    throw new Error('La outbox requiere al menos una intención runtime.');
  }
  const preparadas = intenciones.map((entrada, indice) => {
    const preparada = prepararIntencionAuditoriaV1(entrada);
    if (!PRODUCTORES_RUNTIME.has(preparada.intencion.productor)) {
      throw new Error('La outbox está reservada a productores runtime.');
    }
    if (preparada.intencion.actorReal.tipo !== 'runtime') {
      throw new Error('Una obligación runtime exige actor real runtime.');
    }
    return { ...preparada, indice };
  });
  for (let a = 0; a < preparadas.length; a += 1) {
    for (let b = a + 1; b < preparadas.length; b += 1) {
      const izquierda = preparadas[a].intencion;
      const derecha = preparadas[b].intencion;
      if (izquierda.eventoId === derecha.eventoId) {
        throw new Error('El lote outbox repite eventoId.');
      }
      if (
        izquierda.productor === derecha.productor &&
        izquierda.claveOperacion === derecha.claveOperacion &&
        izquierda.rolEvento === derecha.rolEvento
      ) {
        throw new Error('El lote outbox repite identidad idempotente.');
      }
    }
  }
  return preparadas;
}

function ordenarObligaciones(preparadas) {
  return [...preparadas].sort((a, b) => {
    const cadena = Buffer.compare(
      Buffer.from(a.intencion.claveCadena, 'ascii'),
      Buffer.from(b.intencion.claveCadena, 'ascii')
    );
    return cadena || a.indice - b.indice;
  });
}

async function buscarObligacionPorIdentidad(conexion, intencion) {
  const [filas] = await conexion.execute(
    `
      SELECT ${columnasObligacion('o')}
      FROM outbox_auditoria_runtime o
      WHERE o.productor = ? AND o.clave_operacion = ? AND o.rol_evento = ?
      LIMIT 1
      FOR UPDATE
    `,
    [
      intencion.productor,
      Buffer.from(intencion.claveOperacion, 'ascii'),
      intencion.rolEvento
    ]
  );
  return filas[0] || null;
}

async function buscarObligacionPorEvento(conexion, eventoId) {
  const [filas] = await conexion.execute(
    `
      SELECT ${columnasObligacion('o')}
      FROM outbox_auditoria_runtime o
      WHERE o.evento_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [uuidV7AuditoriaABytes(eventoId)]
  );
  return filas[0] || null;
}

async function buscarObligacionPorId(conexion, id) {
  const [filas] = await conexion.execute(
    `SELECT ${columnasObligacion('o')} FROM outbox_auditoria_runtime o WHERE o.id = ? LIMIT 1`,
    [id]
  );
  if (filas.length !== 1) throw new Error('La obligación reclamada desapareció.');
  return filas[0];
}

function construirSqlInsercion() {
  return `
    INSERT INTO outbox_auditoria_runtime (
      cabecera_id, clave_cadena, orden_obligacion, evento_id, tipo_evento,
      version_contrato, flujo, actor_real_tipo, actor_real_id,
      actor_efectivo_tipo, actor_efectivo_id, modo_actuacion, sujeto_tipo,
      sujeto_id, origen, scope_tenant_id, scope_empresa_id, scope_sitio_id,
      correlacion_id, causalidad_tipo, causalidad_id, productor, clave_operacion,
      rol_evento, efectivo_en_utc, version_canonicalizador, version_encadenado,
      payload, huella_intencion, estado, intentos, max_intentos,
      proximo_intento_utc, fencing_token, creada_en_utc, actualizada_en_utc
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, 'pendiente', 0, ?, UTC_TIMESTAMP(3), 0,
      UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
    )
  `;
}

function construirParametrosInsercion({ preparada, cabecera, orden, maxIntentos }) {
  const i = preparada.intencion;
  return [
    cabecera.id,
    i.claveCadena,
    String(orden),
    uuidV7AuditoriaABytes(i.eventoId),
    i.tipo,
    i.versionContrato,
    i.flujo,
    i.actorReal.tipo,
    i.actorReal.id,
    i.actorEfectivo?.tipo ?? null,
    i.actorEfectivo?.id ?? null,
    i.modoActuacion,
    i.sujeto.tipo,
    i.sujeto.id,
    i.origen,
    i.scope.tenantId,
    i.scope.empresaId,
    i.scope.sitioId,
    uuidV7AuditoriaABytes(i.correlacionId),
    i.causalidad?.tipo ?? null,
    i.causalidad?.id ?? null,
    i.productor,
    Buffer.from(i.claveOperacion, 'ascii'),
    i.rolEvento,
    fechaUtcASql(i.efectivoEnUtc),
    i.versionCanonicalizador,
    i.versionEncadenado,
    JSON.stringify(i.payload),
    preparada.huella,
    maxIntentos
  ];
}

function columnasObligacion(alias) {
  return `
    CAST(${alias}.id AS CHAR) AS id,
    CAST(${alias}.cabecera_id AS CHAR) AS cabecera_id,
    ${alias}.clave_cadena,
    CAST(${alias}.orden_obligacion AS CHAR) AS orden_obligacion,
    ${alias}.evento_id,
    ${alias}.tipo_evento,
    ${alias}.version_contrato,
    ${alias}.flujo,
    ${alias}.actor_real_tipo,
    ${alias}.actor_real_id,
    ${alias}.actor_efectivo_tipo,
    ${alias}.actor_efectivo_id,
    ${alias}.modo_actuacion,
    ${alias}.sujeto_tipo,
    ${alias}.sujeto_id,
    ${alias}.origen,
    CAST(${alias}.scope_tenant_id AS CHAR) AS scope_tenant_id,
    CAST(${alias}.scope_empresa_id AS CHAR) AS scope_empresa_id,
    CAST(${alias}.scope_sitio_id AS CHAR) AS scope_sitio_id,
    ${alias}.correlacion_id,
    ${alias}.causalidad_tipo,
    ${alias}.causalidad_id,
    ${alias}.productor,
    ${alias}.clave_operacion,
    ${alias}.rol_evento,
    DATE_FORMAT(${alias}.efectivo_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS efectivo_en_utc,
    ${alias}.version_canonicalizador,
    ${alias}.version_encadenado,
    ${alias}.payload,
    ${alias}.huella_intencion,
    ${alias}.estado,
    CAST(${alias}.intentos AS UNSIGNED) AS intentos,
    CAST(${alias}.max_intentos AS UNSIGNED) AS max_intentos,
    DATE_FORMAT(${alias}.proximo_intento_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS proximo_intento_utc,
    ${alias}.instancia_id,
    ${alias}.lease_token,
    DATE_FORMAT(${alias}.lease_expira_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS lease_expira_utc,
    CAST(${alias}.fencing_token AS CHAR) AS fencing_token,
    ${alias}.ultimo_codigo_error,
    ${alias}.ultimo_mensaje_error,
    ${alias}.evento_incorporado_id,
    DATE_FORMAT(${alias}.creada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS creada_en_utc,
    DATE_FORMAT(${alias}.actualizada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS actualizada_en_utc,
    DATE_FORMAT(${alias}.completada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS completada_en_utc
  `;
}

function serializarObligacion(fila, resultadoAlta) {
  const leaseToken = fila.lease_token
    ? Buffer.from(fila.lease_token).toString('hex')
    : null;
  return {
    id: String(fila.id),
    cabeceraId: String(fila.cabecera_id),
    claveCadena: fila.clave_cadena,
    ordenObligacion: String(fila.orden_obligacion),
    eventoId: bytesAUuidV7Auditoria(fila.evento_id),
    estado: fila.estado,
    intentos: Number(fila.intentos),
    maxIntentos: Number(fila.max_intentos),
    proximoIntentoUtc: normalizarFecha(fila.proximo_intento_utc),
    instanciaId: fila.instancia_id || null,
    leaseToken,
    leaseExpiraUtc: normalizarFecha(fila.lease_expira_utc),
    fencingToken: String(fila.fencing_token),
    ultimoCodigoError: fila.ultimo_codigo_error || null,
    ultimoMensajeError: fila.ultimo_mensaje_error || null,
    eventoIncorporadoId: fila.evento_incorporado_id
      ? bytesAUuidV7Auditoria(fila.evento_incorporado_id)
      : null,
    creadaEnUtc: normalizarFecha(fila.creada_en_utc),
    actualizadaEnUtc: normalizarFecha(fila.actualizada_en_utc),
    completadaEnUtc: normalizarFecha(fila.completada_en_utc),
    intencion: construirIntencionDesdeFila(fila),
    ...(resultadoAlta ? { resultadoAlta } : {})
  };
}

function construirIntencionDesdeFila(fila) {
  return {
    eventoId: bytesAUuidV7Auditoria(fila.evento_id),
    tipo: fila.tipo_evento,
    versionContrato: Number(fila.version_contrato),
    flujo: fila.flujo,
    claveCadena: fila.clave_cadena,
    actorReal: { tipo: fila.actor_real_tipo, id: fila.actor_real_id },
    actorEfectivo: fila.actor_efectivo_tipo
      ? { tipo: fila.actor_efectivo_tipo, id: fila.actor_efectivo_id }
      : null,
    modoActuacion: fila.modo_actuacion,
    sujeto: { tipo: fila.sujeto_tipo, id: fila.sujeto_id },
    origen: fila.origen,
    scope: {
      tenantId: fila.scope_tenant_id,
      empresaId: fila.scope_empresa_id,
      sitioId: fila.scope_sitio_id
    },
    correlacionId: bytesAUuidV7Auditoria(fila.correlacion_id),
    causalidad: fila.causalidad_tipo
      ? { tipo: fila.causalidad_tipo, id: fila.causalidad_id }
      : null,
    productor: fila.productor,
    claveOperacion: Buffer.from(fila.clave_operacion).toString('ascii'),
    rolEvento: fila.rol_evento,
    efectivoEnUtc: normalizarFecha(fila.efectivo_en_utc),
    versionCanonicalizador: fila.version_canonicalizador,
    versionEncadenado: fila.version_encadenado,
    payload: typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload
  };
}

async function bloquearPorAgotamiento(conexion, id, diagnostico) {
  await conexion.execute(
    `
      UPDATE outbox_auditoria_runtime
      SET
        estado = 'bloqueo_permanente',
        instancia_id = NULL,
        lease_token = NULL,
        lease_expira_utc = NULL,
        ultimo_codigo_error = ?,
        ultimo_mensaje_error = ?,
        actualizada_en_utc = UTC_TIMESTAMP(3)
      WHERE id = ?
    `,
    [diagnostico.codigo, diagnostico.mensaje, id]
  );
}

function normalizarLease({ id, instanciaId, leaseToken, fencingToken } = {}) {
  const token = String(leaseToken || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error('leaseToken debe contener 32 bytes hexadecimales.');
  }
  const fencing = String(fencingToken || '');
  if (!/^[1-9][0-9]*$/.test(fencing) || BigInt(fencing) > MAX_BIGINT_UNSIGNED) {
    throw new Error('fencingToken debe ser un entero decimal positivo válido.');
  }
  return {
    id: idDecimal(id, 'La obligación del lease no es válida.'),
    instanciaId: textoAscii(instanciaId, 128, 'instanciaId es obligatorio.'),
    leaseToken: Buffer.from(token, 'hex'),
    fencingToken: fencing
  };
}

function normalizarLeaseTokenBuffer(leaseToken) {
  const token = Buffer.isBuffer(leaseToken)
    ? Buffer.from(leaseToken)
    : Buffer.from(String(leaseToken || ''), 'hex');
  if (token.length !== 32) {
    throw new Error('leaseToken debe contener exactamente 32 bytes.');
  }
  return token;
}

function sanearDiagnostico(codigo, mensaje) {
  const codigoSeguro = String(codigo || 'error_outbox')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .slice(0, 64) || 'error_outbox';
  const mensajeSeguro = String(mensaje || 'Error técnico de outbox.')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, '[dato_sensible]')
    .replace(/\b(authorization|password|contraseña|cookie|csrf|secret|token)\b\s*[:=]?\s*[^,;\s]+/gi, '[dato_sensible]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512) || 'Error técnico de outbox.';
  return { codigo: codigoSeguro, mensaje: mensajeSeguro };
}

function normalizarFecha(valor) {
  if (valor == null) return null;
  const texto = String(valor);
  const coincidencia = texto.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})\d{3}Z$/
  );
  if (!coincidencia) throw new Error(`Fecha SQL UTC no canónica: ${texto}.`);
  return `${coincidencia[1]}.${coincidencia[2]}Z`;
}

function fechaUtcASql(fecha) {
  return fecha.slice(0, -1).replace('T', ' ');
}

function ordenarBinarioUnico(valores) {
  return [...new Set(valores)].sort((a, b) =>
    Buffer.compare(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii'))
  );
}

function idDecimal(valor, mensaje) {
  const texto = String(valor || '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error(mensaje);
  return texto;
}

function textoAscii(valor, maximo, mensaje) {
  const texto = String(valor || '').trim();
  if (
    !texto ||
    Buffer.byteLength(texto, 'ascii') !== texto.length ||
    Buffer.byteLength(texto, 'ascii') > maximo
  ) {
    throw new Error(mensaje);
  }
  return texto;
}

function enteroAcotado(valor, minimo, maximo, mensaje) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(mensaje);
  }
  return numero;
}

function exigirConexion(conexion) {
  if (!conexion?.execute) {
    throw new Error('La operación outbox requiere una conexión SQL explícita.');
  }
}

function marcadores(valores) {
  return valores.map(() => '?').join(', ');
}
