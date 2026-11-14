import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  calcularHuellaObjetivoObligacionPostcommitEliminacionAgenteSha256,
  canonicalizarObjetivoObligacionPostcommitEliminacionAgente,
  crearObligacionPostcommitEliminacionAgente,
  crearReferenciaObligacionEliminacionAgente,
  PERFIL_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE
} from './ContratoEliminacionAdministrativaAgente.js';

export class RepositorioObligacionesPostcommitOperacionesAdministrativasSql {
  constructor(clienteSql, { finalizadorConvergencia = null } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('Las obligaciones postcommit administrativas requieren ClienteSql.');
    }
    this.clienteSql = clienteSql;
    if (finalizadorConvergencia !== null &&
        typeof finalizadorConvergencia?.finalizarEnTransaccion !== 'function') {
      throw new Error('El finalizador postcommit no cumple su puerto transaccional.');
    }
    this.finalizadorConvergencia = finalizadorConvergencia;
  }

  async crearORecuperarVariasEnTransaccion(
    { obligaciones = [], creadaEnUtc, retenerHastaUtc } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    if (!Array.isArray(obligaciones)) {
      throw new TypeError('obligaciones debe ser una colección.');
    }
    const creada = fechaSql(creadaEnUtc, 'creadaEnUtc');
    const retencion = fechaSql(retenerHastaUtc, 'retenerHastaUtc');
    if (Date.parse(retenerHastaUtc) <= Date.parse(creadaEnUtc)) {
      throw new TypeError('retenerHastaUtc debe ser posterior a creadaEnUtc.');
    }
    const referencias = [];
    for (const entrada of obligaciones) {
      const obligacion = crearObligacionPostcommitEliminacionAgente(entrada);
      const objetivoCanonico =
        canonicalizarObjetivoObligacionPostcommitEliminacionAgente(obligacion);
      const huellaHex =
        calcularHuellaObjetivoObligacionPostcommitEliminacionAgenteSha256(obligacion);
      const huella = Buffer.from(huellaHex, 'hex');
      const [existentes] = await conexion.execute(
        `SELECT obligacion_id,objetivo_canonico
           FROM obligaciones_postcommit_operaciones_administrativas
          WHERE operacion_id=? AND tipo=? AND huella_objetivo=?
          ORDER BY obligacion_id FOR UPDATE`,
        [uuidV7AuditoriaABytes(obligacion.operacionId), obligacion.tipo, huella]
      );
      if (existentes.length > 1) {
        throw new Error(
          'La operación conserva obligaciones duplicadas para el mismo objetivo.'
        );
      }
      if (existentes[0]) {
        if (String(existentes[0].objetivo_canonico) !== objetivoCanonico) {
          throw new Error('La huella de obligación colisionó con otro objetivo.');
        }
        referencias.push(referencia({
          obligacionId: bytesAUuidV7Auditoria(existentes[0].obligacion_id),
          tipo: obligacion.tipo
        }));
        continue;
      }
      const objetivo = obligacion.objetivo;
      await conexion.execute(
        `INSERT INTO obligaciones_postcommit_operaciones_administrativas (
           obligacion_id,operacion_id,tipo,version_contrato,objetivo_tipo,
           objetivo_id,agente_id,
           operacion_sesion_id,generacion_perfil,destinatario_usuario_id,
           objetivo_canonico,huella_objetivo,proximo_intento_utc,
           creada_en_utc,actualizada_en_utc,retener_hasta_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uuidV7AuditoriaABytes(obligacion.obligacionId),
          uuidV7AuditoriaABytes(obligacion.operacionId),
          obligacion.tipo,
          obligacion.version,
          objetivo.destinatarioUsuarioId ? 'usuario' : 'agente',
          objetivo.destinatarioUsuarioId ?? objetivo.agenteId,
          objetivo.agenteId ?? null,
          objetivo.operacionSesionId
            ? uuidV7AuditoriaABytes(objetivo.operacionSesionId)
            : null,
          objetivo.generacionPerfil ?? null,
          objetivo.destinatarioUsuarioId ?? null,
          objetivoCanonico,
          huella,
          creada,
          creada,
          creada,
          retencion
        ]
      );
      referencias.push(referencia({
        obligacionId: obligacion.obligacionId,
        tipo: obligacion.tipo
      }));
    }
    return Object.freeze(referencias);
  }

  async listarReferenciasPorOperacionEnTransaccion(
    { operacionId } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const [filas] = await conexion.execute(
      `SELECT obligacion_id,tipo
         FROM obligaciones_postcommit_operaciones_administrativas
        WHERE operacion_id=? ORDER BY obligacion_id FOR UPDATE`,
      [uuidV7AuditoriaABytes(operacionId)]
    );
    return Object.freeze(filas.map((fila) =>
      crearReferenciaObligacionEliminacionAgente({
        obligacionId: bytesAUuidV7Auditoria(fila.obligacion_id),
        tipo: String(fila.tipo),
        estado: 'pendiente'
      })
    ));
  }

  async reclamarSiguiente({ instanciaId, leaseToken, ttlSegundos } = {}) {
    const instancia = ascii(instanciaId, 128, 'instanciaId');
    const token = tokenLease(leaseToken);
    const ttl = entero(ttlSegundos, 1, 3600, 'ttlSegundos');
    return this.#transaccion(async (conexion) => {
      await cerrarLeaseAgotado(conexion);
      const [filas] = await conexion.execute(
        `${SELECCION_OBLIGACION}
          WHERE intentos < max_intentos
            AND (
              (estado IN ('pendiente','reintentable')
                AND proximo_intento_utc<=UTC_TIMESTAMP(3))
              OR (estado='procesando' AND lease_expira_utc<=UTC_TIMESTAMP(3))
            )
          ORDER BY COALESCE(proximo_intento_utc,lease_expira_utc),
                   creada_en_utc,obligacion_id
          LIMIT 1 FOR UPDATE SKIP LOCKED`
      );
      if (!filas[0]) return null;
      const obligacionId = bytesAUuidV7Auditoria(filas[0].obligacion_id);
      const [actualizacion] = await conexion.execute(
        `UPDATE obligaciones_postcommit_operaciones_administrativas
            SET estado='procesando',intentos=intentos+1,proximo_intento_utc=NULL,
                instancia_id=?,lease_token=?,
                lease_expira_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
                fencing_token=fencing_token+1,ultimo_codigo_error=NULL,
                ultimo_mensaje_error=NULL,terminada_en_utc=NULL,
                actualizada_en_utc=UTC_TIMESTAMP(3)
          WHERE obligacion_id=?`,
        [instancia, token, ttl, uuidV7AuditoriaABytes(obligacionId)]
      );
      if (Number(actualizacion.affectedRows) !== 1) {
        throw new Error('No se pudo materializar el lease postcommit bloqueado.');
      }
      const fila = await seleccionarPorId(conexion, obligacionId, { bloquear: false });
      const obligacion = rehidratar(fila);
      return Object.freeze({
        operacionId: obligacionId,
        fencingToken: obligacion.fencingToken,
        intentos: obligacion.intentos,
        operacion: obligacion
      });
    });
  }

  async renovarLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    ttlSegundos
  } = {}) {
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE obligaciones_postcommit_operaciones_administrativas
          SET lease_expira_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
              actualizada_en_utc=UTC_TIMESTAMP(3)
        ${CONDICION_LEASE_VIGENTE}`,
      parametrosLease(
        { operacionId, instanciaId, leaseToken, fencingToken },
        [entero(ttlSegundos, 1, 3600, 'ttlSegundos')]
      )
    );
    return Object.freeze({ actualizada: Number(resultado.affectedRows) === 1 });
  }

  async avanzarConLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    transicion,
    datos = null
  } = {}) {
    if (transicion !== 'efecto_aplicado' || datos !== null) {
      throw new Error('La obligación postcommit solo admite la transición efecto_aplicado.');
    }
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE obligaciones_postcommit_operaciones_administrativas
          SET actualizada_en_utc=UTC_TIMESTAMP(3)
        ${CONDICION_LEASE_VIGENTE}`,
      parametrosLease({ operacionId, instanciaId, leaseToken, fencingToken })
    );
    return Object.freeze({ actualizada: Number(resultado.affectedRows) === 1 });
  }

  async consolidarConLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    resultado = null
  } = {}) {
    if (resultado !== null) {
      throw new Error('La obligación postcommit no persiste resultados externos.');
    }
    return this.#transaccion(async (conexion) => {
      const fila = await seleccionarLeaseVigente(
        conexion,
        { operacionId, instanciaId, leaseToken, fencingToken }
      );
      if (!fila) return Object.freeze({ actualizada: false });
      const obligacion = rehidratar(fila);
      const [actualizacion] = await conexion.execute(
        `UPDATE obligaciones_postcommit_operaciones_administrativas
            SET estado='completada',proximo_intento_utc=NULL,instancia_id=NULL,
                lease_token=NULL,lease_expira_utc=NULL,ultimo_codigo_error=NULL,
                ultimo_mensaje_error=NULL,terminada_en_utc=UTC_TIMESTAMP(3),
                actualizada_en_utc=UTC_TIMESTAMP(3)
          ${CONDICION_LEASE_VIGENTE}`,
        parametrosLease({ operacionId, instanciaId, leaseToken, fencingToken })
      );
      if (Number(actualizacion.affectedRows) !== 1) {
        return Object.freeze({ actualizada: false });
      }
      const situacion = await consultarSituacion(
        conexion,
        obligacion.eliminacionOperacionId,
        { bloquear: true }
      );
      let convergencia = Object.freeze({
        completada: situacion.pendientes === 0 && situacion.bloqueadas === 0,
        notificacion: null,
        motivo: 'obligaciones_pendientes'
      });
      if (situacion.total > 0 && convergencia.completada) {
        if (!this.finalizadorConvergencia) {
          throw new Error('La convergencia final exige un finalizador transaccional.');
        }
        convergencia = await this.finalizadorConvergencia.finalizarEnTransaccion({
          operacionId: obligacion.eliminacionOperacionId
        }, { conexion });
      }
      return Object.freeze({
        actualizada: true,
        estado: 'completada',
        obligacion,
        situacion,
        convergencia
      });
    });
  }

  async registrarFalloConLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    diagnostico,
    permanente = false,
    demoraReintentoSegundos = 5,
    resumen = null
  } = {}) {
    if (resumen !== null) {
      throw new Error('La obligación postcommit no persiste resúmenes arbitrarios.');
    }
    const codigo = codigoDiagnostico(diagnostico?.codigo);
    const mensaje = mensajeDiagnostico(diagnostico?.mensaje);
    const demora = entero(
      demoraReintentoSegundos,
      1,
      86_400,
      'demoraReintentoSegundos'
    );
    return this.#transaccion(async (conexion) => {
      const fila = await seleccionarLeaseVigente(
        conexion,
        { operacionId, instanciaId, leaseToken, fencingToken }
      );
      if (!fila) return Object.freeze({ actualizada: false });
      const terminal = Boolean(permanente) ||
        Number(fila.intentos) >= Number(fila.max_intentos);
      const estado = terminal ? 'bloqueo_permanente' : 'reintentable';
      const [actualizacion] = await conexion.execute(
        `UPDATE obligaciones_postcommit_operaciones_administrativas
            SET estado=?,proximo_intento_utc=${terminal
              ? 'NULL'
              : 'TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3))'},
                instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
                ultimo_codigo_error=?,ultimo_mensaje_error=?,
                terminada_en_utc=${terminal ? 'UTC_TIMESTAMP(3)' : 'NULL'},
                actualizada_en_utc=UTC_TIMESTAMP(3)
          ${CONDICION_LEASE_VIGENTE}`,
        parametrosLease(
          { operacionId, instanciaId, leaseToken, fencingToken },
          terminal ? [estado, codigo, mensaje] : [estado, demora, codigo, mensaje]
        )
      );
      return Object.freeze({
        actualizada: Number(actualizacion.affectedRows) === 1,
        estado
      });
    });
  }

  async obtenerSituacionPorOperacion(operacionId) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      return consultarSituacion(conexion, operacionId, { bloquear: false });
    } finally {
      conexion.release();
    }
  }

  async purgarTerminadasVencidas({ limite = 100 } = {}) {
    const maximo = entero(limite, 1, 1000, 'limite');
    const [resultado] = await this.clienteSql.ejecutar(
      `DELETE FROM obligaciones_postcommit_operaciones_administrativas
        WHERE estado IN ('completada','bloqueo_permanente')
          AND retener_hasta_utc<=UTC_TIMESTAMP(3)
        ORDER BY retener_hasta_utc,obligacion_id LIMIT ${maximo}`
    );
    return Number(resultado.affectedRows || 0);
  }

  async #transaccion(trabajo) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
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

export class RepositorioObligacionesPostcommitEliminacionAgentesSql
  extends RepositorioObligacionesPostcommitOperacionesAdministrativasSql {}

const SELECCION_OBLIGACION = `SELECT
  obligacion_id,operacion_id,tipo,version_contrato,objetivo_tipo,
  CAST(objetivo_id AS CHAR) objetivo_id,objetivo_canonico,
  estado,intentos,max_intentos,proximo_intento_utc,instancia_id,
  lease_expira_utc,CAST(fencing_token AS CHAR) AS fencing_token,
  ultimo_codigo_error,ultimo_mensaje_error,creada_en_utc,
  actualizada_en_utc,terminada_en_utc,retener_hasta_utc
FROM obligaciones_postcommit_operaciones_administrativas`;

const CONDICION_LEASE_VIGENTE = `WHERE obligacion_id=? AND estado='procesando'
  AND instancia_id=? AND lease_token=? AND fencing_token=?
  AND lease_expira_utc>UTC_TIMESTAMP(3)`;

function referencia({ obligacionId, tipo }) {
  return crearReferenciaObligacionEliminacionAgente({
    obligacionId,
    tipo,
    estado: 'pendiente'
  });
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function' || typeof conexion?.query !== 'function') {
    throw new Error('Las obligaciones postcommit exigen una conexión SQL prestada.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('Las obligaciones postcommit exigen una transacción activa.');
  }
}

function fechaSql(valor, campo) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new TypeError(`${campo} no es una fecha válida.`);
  return fecha.toISOString().slice(0, 23).replace('T', ' ');
}

async function seleccionarPorId(conexion, obligacionId, { bloquear }) {
  const [filas] = await conexion.execute(
    `${SELECCION_OBLIGACION} WHERE obligacion_id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [uuidV7AuditoriaABytes(obligacionId)]
  );
  return filas[0] || null;
}

async function seleccionarLeaseVigente(conexion, lease) {
  const [filas] = await conexion.execute(
    `${SELECCION_OBLIGACION} ${CONDICION_LEASE_VIGENTE} FOR UPDATE`,
    parametrosLease(lease)
  );
  return filas[0] || null;
}

async function cerrarLeaseAgotado(conexion) {
  const [filas] = await conexion.execute(
    `${SELECCION_OBLIGACION}
      WHERE estado='procesando' AND intentos>=max_intentos
        AND lease_expira_utc<=UTC_TIMESTAMP(3)
      ORDER BY lease_expira_utc,creada_en_utc,obligacion_id
      LIMIT 1 FOR UPDATE SKIP LOCKED`
  );
  if (!filas[0]) return false;
  const obligacionId = bytesAUuidV7Auditoria(filas[0].obligacion_id);
  const [resultado] = await conexion.execute(
    `UPDATE obligaciones_postcommit_operaciones_administrativas
        SET estado='bloqueo_permanente',proximo_intento_utc=NULL,
            instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
            ultimo_codigo_error='obligacion_postcommit_intentos_agotados',
            ultimo_mensaje_error='La obligación agotó sus intentos tras perder el último lease.',
            terminada_en_utc=UTC_TIMESTAMP(3),
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE obligacion_id=? AND estado='procesando'
        AND intentos>=max_intentos AND lease_expira_utc<=UTC_TIMESTAMP(3)`,
    [uuidV7AuditoriaABytes(obligacionId)]
  );
  return Number(resultado.affectedRows) === 1;
}

async function consultarSituacion(conexion, operacionId, { bloquear }) {
  const sufijoBloqueo = bloquear ? ' FOR UPDATE' : '';
  const [filas] = await conexion.execute(
    `SELECT estado
       FROM obligaciones_postcommit_operaciones_administrativas
      WHERE operacion_id=? ORDER BY obligacion_id${sufijoBloqueo}`,
    [uuidV7AuditoriaABytes(operacionId)]
  );
  const porEstado = {};
  for (const fila of filas) {
    const estado = String(fila.estado);
    porEstado[estado] = (porEstado[estado] || 0) + 1;
  }
  const total = filas.length;
  const completadas = porEstado.completada || 0;
  const bloqueadas = porEstado.bloqueo_permanente || 0;
  return Object.freeze({
    operacionId: String(operacionId),
    total,
    completadas,
    bloqueadas,
    pendientes: total - completadas - bloqueadas,
    convergida: total > 0 && completadas === total,
    estados: Object.freeze({ ...porEstado })
  });
}

function rehidratar(fila) {
  const objetivo = JSON.parse(String(fila.objetivo_canonico));
  const obligacion = rehidratarContrato(fila, objetivo);
  const objetivoTipado = validarObjetivoTipadoPersistido(fila, obligacion);
  return Object.freeze({
    obligacionId: obligacion.obligacionId,
    eliminacionOperacionId: obligacion.operacionId,
    tipo: obligacion.tipo,
    version: obligacion.version,
    objetivoTipado,
    objetivo: obligacion.objetivo,
    estado: String(fila.estado),
    intentos: Number(fila.intentos),
    maxIntentos: Number(fila.max_intentos),
    fencingToken: String(fila.fencing_token),
    ultimoError: fila.ultimo_codigo_error === null ? null : Object.freeze({
      codigo: String(fila.ultimo_codigo_error),
      mensaje: String(fila.ultimo_mensaje_error)
    }),
    creadaEnUtc: fechaIso(fila.creada_en_utc),
    actualizadaEnUtc: fechaIso(fila.actualizada_en_utc),
    terminadaEnUtc: fila.terminada_en_utc === null
      ? null
      : fechaIso(fila.terminada_en_utc),
    retenerHastaUtc: fechaIso(fila.retener_hasta_utc)
  });
}

function rehidratarContrato(fila, objetivo) {
  const objetivoTipo = String(fila.objetivo_tipo || '');
  const base = {
    version: Number(fila.version_contrato),
    obligacionId: bytesAUuidV7Auditoria(fila.obligacion_id),
    operacionId: bytesAUuidV7Auditoria(fila.operacion_id),
    tipo: String(fila.tipo),
    objetivo
  };
  if (['agente', 'usuario'].includes(objetivoTipo)) {
    return crearObligacionPostcommitEliminacionAgente({
      perfil: PERFIL_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE,
      ...base
    });
  }
  if (!['tenant', 'empresa', 'sitio'].includes(objetivoTipo) ||
      base.version !== 1 ||
      ![
        'invalidar_catalogo_monitores',
        'invalidar_sesiones_usuarios_redis',
        'retirar_estructura_organizacion_redis'
      ].includes(base.tipo)) {
    throw new Error('La obligación postcommit no pertenece a un contrato ejecutable.');
  }
  const claves = objetivo && typeof objetivo === 'object' &&
      !Array.isArray(objetivo)
    ? Object.keys(objetivo).sort()
    : [];
  if (claves.length !== 2 || claves[0] !== 'id' || claves[1] !== 'tipo' ||
      String(objetivo.tipo) !== objetivoTipo ||
      !/^[1-9][0-9]*$/u.test(String(objetivo.id ?? ''))) {
    throw new Error('El objetivo canónico organizativo no es válido.');
  }
  return Object.freeze({
    ...base,
    objetivo: Object.freeze({ tipo: objetivoTipo, id: String(objetivo.id) })
  });
}

function validarObjetivoTipadoPersistido(fila, obligacion) {
  const objetivo = obligacion.objetivo;
  const esperado = objetivo.destinatarioUsuarioId
    ? { tipo: 'usuario', id: String(objetivo.destinatarioUsuarioId) }
    : objetivo.agenteId
      ? { tipo: 'agente', id: String(objetivo.agenteId) }
      : { tipo: String(objetivo.tipo), id: String(objetivo.id) };
  const persistido = {
    tipo: String(fila.objetivo_tipo || ''),
    id: String(fila.objetivo_id || '')
  };
  if (persistido.tipo !== esperado.tipo || persistido.id !== esperado.id) {
    throw new Error(
      'El objetivo tipado no coincide con el contrato canónico postcommit.'
    );
  }
  return Object.freeze(esperado);
}

function parametrosLease(
  { operacionId, instanciaId, leaseToken, fencingToken },
  prefijo = []
) {
  return [
    ...prefijo,
    uuidV7AuditoriaABytes(operacionId),
    ascii(instanciaId, 128, 'instanciaId'),
    tokenLease(leaseToken),
    fencing(fencingToken)
  ];
}

function tokenLease(valor) {
  const token = Buffer.isBuffer(valor) ? Buffer.from(valor) : Buffer.alloc(0);
  if (token.length !== 32) throw new Error('leaseToken debe contener 32 bytes.');
  return token;
}

function fencing(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error('fencingToken debe ser un entero decimal positivo.');
  }
  return texto;
}

function ascii(valor, maximo, campo) {
  const texto = String(valor || '');
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/u.test(texto)) {
    throw new Error(`${campo} no es ASCII válido.`);
  }
  return texto;
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

function codigoDiagnostico(valor) {
  const codigo = String(valor || 'obligacion_postcommit_error')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^[^a-z]+/u, '')
    .slice(0, 64);
  return codigo || 'obligacion_postcommit_error';
}

function mensajeDiagnostico(valor) {
  return String(valor || 'No se pudo completar la obligación postcommit.')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/giu, '[dato_sensible]')
    .replace(
      /\b(authorization|password|contraseña|cookie|csrf|secret|token)\b\s*[:=]?\s*[^,;\s]+/giu,
      '[dato_sensible]'
    )
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 512) || 'Error técnico postcommit.';
}

function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(`${valor}Z`);
  return fecha.toISOString();
}
