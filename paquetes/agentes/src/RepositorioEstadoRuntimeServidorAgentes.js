import {
  ESTADOS_PERFIL_SERVIDOR_AGENTE
} from './ContratoPerfilServidorAgente.js';
import {
  crearEstadoRuntimeServidorAgenteDesdeFila,
  crearEvidenciaPolServidorAgenteDesdeFila,
  crearTransicionRuntimeServidorAgenteDesdeFila
} from './EstadoRuntimeServidorAgente.js';
import {
  crearPerfilServidorAgenteDesdeFila
} from './PerfilServidorAgente.js';

const CODIGOS_SENALES = new Set([
  'runtime.servidor.sin_pol',
  'runtime.servidor.reinicio_reciente'
]);

export class RepositorioEstadoRuntimeServidorAgentes {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async crearParaPerfilEnTransaccion({ perfil } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const agenteId = enteroPositivo(perfil?.agenteId, 'agenteId');
    const generacion = enteroPositivo(perfil?.generacion, 'generacion');

    await conexion.execute(
      `
        INSERT IGNORE INTO estados_runtime_servidor_agentes (
          agente_id,
          generacion,
          version_estado
        ) VALUES (?, ?, 1)
      `,
      [agenteId, generacion]
    );

    return this.buscarPorPerfil(
      { agenteId, generacion },
      { conexion, bloquear: true }
    );
  }

  async buscarPorPerfil({ agenteId, generacion } = {}, {
    conexion = null,
    bloquear = false
  } = {}) {
    if (bloquear) exigirConexion(conexion);
    const filas = await consultar(
      this.clienteSql,
      conexion,
      `
        SELECT ${columnasEstado('e')}
        FROM estados_runtime_servidor_agentes e
        WHERE e.agente_id = ? AND e.generacion = ?
        LIMIT 1${bloquear ? ' FOR UPDATE' : ''}
      `,
      [
        enteroPositivo(agenteId, 'agenteId'),
        enteroPositivo(generacion, 'generacion')
      ]
    );
    return crearEstadoRuntimeServidorAgenteDesdeFila(filas[0] || null);
  }

  async listarPorPerfiles(perfiles = []) {
    if (!Array.isArray(perfiles)) {
      throw new Error('Los perfiles runtime deben ser una lista.');
    }
    const identidades = [...new Map(perfiles.map((perfil) => {
      const agenteId = enteroPositivo(perfil?.agenteId, 'agenteId');
      const generacion = enteroPositivo(perfil?.generacion, 'generacion');
      return [`${agenteId}:${generacion}`, { agenteId, generacion }];
    })).values()];
    if (identidades.length === 0) return [];
    const condiciones = identidades
      .map(() => '(e.agente_id = ? AND e.generacion = ?)')
      .join(' OR ');
    const filas = await consultar(
      this.clienteSql,
      null,
      `
        SELECT ${columnasEstado('e')}
        FROM estados_runtime_servidor_agentes e
        WHERE ${condiciones}
        ORDER BY e.agente_id ASC, e.generacion ASC
      `,
      identidades.flatMap(({ agenteId, generacion }) => [agenteId, generacion])
    );
    return filas.map(crearEstadoRuntimeServidorAgenteDesdeFila);
  }

  async bloquearCandidatosEnTransaccion({
    ahoraUtc,
    limite = 50
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const fecha = fechaSql(ahoraUtc, 'ahoraUtc');
    const filas = await consultar(
      this.clienteSql,
      conexion,
      `
        SELECT
          ${columnasPerfil('p')},
          ${columnasEstado('e', 'runtime_')}
        FROM perfiles_servidor_agentes p
        INNER JOIN agentes_sentinelia a ON a.id = p.agente_id
        LEFT JOIN estados_runtime_servidor_agentes e
          ON e.agente_id = p.agente_id
          AND e.generacion = p.generacion
        WHERE p.estado IN (?, ?)
          AND (
            e.agente_id IS NULL
            OR (
              p.estado = ?
              AND (
                (e.vence_sin_pol_utc IS NOT NULL
                  AND e.vence_sin_pol_utc <= ?)
                OR (e.vence_reinicio_reciente_utc IS NOT NULL
                  AND e.vence_reinicio_reciente_utc <= ?)
              )
            )
          )
        ORDER BY
          COALESCE(
            LEAST(e.vence_sin_pol_utc, e.vence_reinicio_reciente_utc),
            e.vence_sin_pol_utc,
            e.vence_reinicio_reciente_utc,
            p.generada_en_utc
          ) ASC,
          p.agente_id ASC,
          p.generacion ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      `,
      [
        ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO,
        fecha,
        fecha,
        enteroAcotado(limite, 1, 250, 'limite')
      ]
    );

    return filas.map((fila) => Object.freeze({
      perfil: crearPerfilServidorAgenteDesdeFila(fila),
      estado: fila.runtime_agente_id === null ||
        fila.runtime_agente_id === undefined
        ? null
        : crearEstadoRuntimeServidorAgenteDesdeFila(
            extraerEstadoPrefijado(fila, 'runtime_')
          )
    }));
  }

  async bloquearCandidatosPolEnTransaccion({
    limite = 50
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const filas = await consultar(
      this.clienteSql,
      conexion,
      `
        SELECT
          ${columnasPerfil('p')},
          ${columnasEstado('e', 'runtime_')},
          ${columnasPeriodoPol('pol', 'pol_')}
        FROM perfiles_servidor_agentes p
        INNER JOIN agentes_sentinelia a ON a.id = p.agente_id
        LEFT JOIN estados_runtime_servidor_agentes e
          ON e.agente_id = p.agente_id
          AND e.generacion = p.generacion
        INNER JOIN periodos_vida_pol_agentes pol
          ON pol.id = (
            SELECT pol_candidato.id
            FROM periodos_vida_pol_agentes pol_candidato
            WHERE pol_candidato.agente_id = p.agente_id
              AND pol_candidato.boot_id IS NOT NULL
              AND TRIM(pol_candidato.boot_id) <> ''
              AND (
                pol_candidato.inicio_utc > p.generada_en_utc
                OR pol_candidato.ultimo_heartbeat_utc > p.generada_en_utc
              )
              AND (
                e.agente_id IS NULL
                OR e.ultimo_periodo_pol_id IS NULL
                OR pol_candidato.id > e.ultimo_periodo_pol_id
                OR (
                  pol_candidato.id = e.ultimo_periodo_pol_id
                  AND (
                    (
                      pol_candidato.ultimo_seq IS NOT NULL
                      AND (
                        e.ultimo_seq IS NULL
                        OR pol_candidato.ultimo_seq > e.ultimo_seq
                      )
                    )
                    OR (
                      p.estado = ?
                      AND (
                        e.boot_id_referencia IS NULL
                        OR TRIM(e.boot_id_referencia) <>
                          TRIM(pol_candidato.boot_id)
                      )
                    )
                  )
                )
              )
            ORDER BY pol_candidato.id ASC
            LIMIT 1
          )
        WHERE p.estado IN (?, ?)
        ORDER BY
          pol.id ASC,
          p.agente_id ASC,
          p.generacion ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      `,
      [
        ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO,
        enteroAcotado(limite, 1, 250, 'limite')
      ]
    );

    return filas.map((fila) => Object.freeze({
      perfil: crearPerfilServidorAgenteDesdeFila(fila),
      estado: fila.runtime_agente_id === null ||
        fila.runtime_agente_id === undefined
        ? null
        : crearEstadoRuntimeServidorAgenteDesdeFila(
            extraerEstadoPrefijado(fila, 'runtime_')
          ),
      evidencia: crearEvidenciaPolServidorAgenteDesdeFila(
        extraerEstadoPrefijado(fila, 'pol_')
      )
    }));
  }

  async bloquearCandidatosIncompatiblesEnTransaccion({
    limite = 50
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const filas = await consultar(
      this.clienteSql,
      conexion,
      `
        SELECT
          ${columnasPerfil('p')},
          ${columnasEstado('e', 'runtime_')},
          a.id AS scope_agente_id,
          a.tenant_id AS scope_tenant_id,
          a.empresa_id AS scope_empresa_id,
          a.sitio_id AS scope_sitio_id,
          pol.id AS incompatible_periodo_id,
          pol.inicio_utc AS incompatible_inicio_utc,
          pol.ultimo_heartbeat_utc AS incompatible_heartbeat_utc,
          CASE
            WHEN pol.boot_id IS NULL OR TRIM(pol.boot_id) = ''
              THEN 'pol_boot_id_ausente'
            WHEN pol.heartbeats_recibidos > 0
              AND (pol.ultimo_heartbeat_utc IS NULL OR pol.ultimo_seq IS NULL)
              THEN 'pol_heartbeat_incompleto'
            WHEN pol.heartbeats_recibidos = 0
              AND (pol.ultimo_heartbeat_utc IS NOT NULL OR pol.ultimo_seq IS NOT NULL)
              THEN 'pol_login_incoherente'
            WHEN pol.ultimo_heartbeat_utc < pol.inicio_utc
              THEN 'pol_cronologia_incompatible'
          END AS codigo_incompatibilidad
        FROM perfiles_servidor_agentes p
        INNER JOIN agentes_sentinelia a ON a.id = p.agente_id
        LEFT JOIN estados_runtime_servidor_agentes e
          ON e.agente_id = p.agente_id
          AND e.generacion = p.generacion
        INNER JOIN periodos_vida_pol_agentes pol
          ON pol.id = (
            SELECT candidato.id
            FROM periodos_vida_pol_agentes candidato
            WHERE candidato.agente_id = p.agente_id
              AND (
                candidato.inicio_utc > p.generada_en_utc
                OR candidato.ultimo_heartbeat_utc > p.generada_en_utc
              )
              AND (
                candidato.boot_id IS NULL
                OR TRIM(candidato.boot_id) = ''
                OR (
                  candidato.heartbeats_recibidos > 0
                  AND (
                    candidato.ultimo_heartbeat_utc IS NULL
                    OR candidato.ultimo_seq IS NULL
                  )
                )
                OR (
                  candidato.heartbeats_recibidos = 0
                  AND (
                    candidato.ultimo_heartbeat_utc IS NOT NULL
                    OR candidato.ultimo_seq IS NOT NULL
                  )
                )
                OR candidato.ultimo_heartbeat_utc < candidato.inicio_utc
              )
            ORDER BY candidato.id ASC
            LIMIT 1
          )
        WHERE p.estado IN (?, ?)
        ORDER BY pol.id ASC, p.agente_id ASC, p.generacion ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      `,
      [
        ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO,
        enteroAcotado(limite, 1, 250, 'limite')
      ]
    );

    return filas.map((fila) => Object.freeze({
      perfil: crearPerfilServidorAgenteDesdeFila(fila),
      agente: Object.freeze({
        id: Number(fila.scope_agente_id),
        tenantId: Number(fila.scope_tenant_id),
        empresaId: Number(fila.scope_empresa_id),
        sitioId: Number(fila.scope_sitio_id)
      }),
      estado: fila.runtime_agente_id === null ||
        fila.runtime_agente_id === undefined
        ? null
        : crearEstadoRuntimeServidorAgenteDesdeFila(
            extraerEstadoPrefijado(fila, 'runtime_')
          ),
      evidencia: Object.freeze({
        periodoVidaPolId: Number(fila.incompatible_periodo_id),
        codigo: String(fila.codigo_incompatibilidad),
        inicioUtc: fechaIso(fila.incompatible_inicio_utc),
        ultimoHeartbeatUtc: fechaIsoONulo(fila.incompatible_heartbeat_utc)
      })
    }));
  }

  async listarProyeccionesVigentes({
    despuesAgenteId = 0,
    despuesGeneracion = 0,
    limite = 250
  } = {}) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${columnasEstado('e')}
        FROM estados_runtime_servidor_agentes e
        INNER JOIN perfiles_servidor_agentes p
          ON p.agente_id = e.agente_id
          AND p.generacion = e.generacion
        WHERE p.estado IN (?, ?)
          AND (
            e.agente_id > ?
            OR (e.agente_id = ? AND e.generacion > ?)
          )
        ORDER BY e.agente_id ASC, e.generacion ASC
        LIMIT ?
      `,
      [
        ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO,
        enteroNoNegativo(despuesAgenteId, 'despuesAgenteId'),
        enteroNoNegativo(despuesAgenteId, 'despuesAgenteId'),
        enteroNoNegativo(despuesGeneracion, 'despuesGeneracion'),
        enteroAcotado(limite, 1, 1000, 'limite')
      ]
    );
    return filas.map(crearEstadoRuntimeServidorAgenteDesdeFila);
  }

  async registrarTransicionEnTransaccion({
    agenteId,
    generacion,
    claveCausal,
    codigoSenal,
    valor,
    causa,
    efectivaEnUtc,
    checkpointCausal
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const clave = validarClaveCausal(claveCausal);
    const codigo = String(codigoSenal || '').trim();
    if (!CODIGOS_SENALES.has(codigo)) {
      throw new Error('La transición no pertenece al catálogo runtime servidor.');
    }
    if (typeof valor !== 'boolean') {
      throw new TypeError('La transición runtime exige un valor booleano.');
    }
    const causaNormalizada = textoObligatorio(causa, 80, 'causa');
    const checkpoint = textoObligatorio(
      checkpointCausal,
      190,
      'checkpointCausal'
    );

    const [resultado] = await conexion.execute(
      `
        INSERT IGNORE INTO transiciones_runtime_servidor_agentes (
          agente_id,
          generacion,
          clave_causal,
          codigo_senal,
          valor_booleano,
          causa,
          efectiva_en_utc,
          checkpoint_causal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        enteroPositivo(agenteId, 'agenteId'),
        enteroPositivo(generacion, 'generacion'),
        clave,
        codigo,
        valor ? 1 : 0,
        causaNormalizada,
        fechaSql(efectivaEnUtc, 'efectivaEnUtc'),
        checkpoint
      ]
    );
    const transicion = await this.buscarTransicionPorClave(
      { agenteId, generacion, claveCausal: clave },
      { conexion, bloquear: true }
    );
    return Object.freeze({
      creada: Number(resultado.affectedRows || 0) > 0,
      transicion
    });
  }

  async buscarTransicionPorClave({
    agenteId,
    generacion,
    claveCausal
  } = {}, { conexion = null, bloquear = false } = {}) {
    if (bloquear) exigirConexion(conexion);
    const filas = await consultar(
      this.clienteSql,
      conexion,
      `
        SELECT ${columnasTransicion('t')}
        FROM transiciones_runtime_servidor_agentes t
        WHERE t.agente_id = ?
          AND t.generacion = ?
          AND t.clave_causal = ?
        LIMIT 1${bloquear ? ' FOR UPDATE' : ''}
      `,
      [
        enteroPositivo(agenteId, 'agenteId'),
        enteroPositivo(generacion, 'generacion'),
        validarClaveCausal(claveCausal)
      ]
    );
    return crearTransicionRuntimeServidorAgenteDesdeFila(filas[0] || null);
  }

  async confirmarTransicionEnTransaccion({
    transicionId,
    observacionTelemetriaId,
    materializadaEnUtc
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await conexion.execute(
      `
        UPDATE transiciones_runtime_servidor_agentes
        SET observacion_telemetria_id = ?,
            materializada_en_utc = ?
        WHERE id = ?
          AND observacion_telemetria_id IS NULL
          AND materializada_en_utc IS NULL
      `,
      [
        enteroPositivo(observacionTelemetriaId, 'observacionTelemetriaId'),
        fechaSql(materializadaEnUtc, 'materializadaEnUtc'),
        enteroPositivo(transicionId, 'transicionId')
      ]
    );
  }

  async resolverVencimientosEnTransaccion({
    agenteId,
    generacion,
    resolverSinPol = false,
    resolverReinicioReciente = false,
    checkpointCausal
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    if (!resolverSinPol && !resolverReinicioReciente) {
      throw new Error('No existe ningún vencimiento runtime que resolver.');
    }
    await conexion.execute(
      `
        UPDATE estados_runtime_servidor_agentes
        SET valor_sin_pol = CASE WHEN ? THEN 1 ELSE valor_sin_pol END,
            vence_sin_pol_utc = CASE WHEN ? THEN NULL ELSE vence_sin_pol_utc END,
            valor_reinicio_reciente = CASE
              WHEN ? THEN 0 ELSE valor_reinicio_reciente
            END,
            vence_reinicio_reciente_utc = CASE
              WHEN ? THEN NULL ELSE vence_reinicio_reciente_utc
            END,
            checkpoint_causal = ?,
            version_estado = version_estado + 1
        WHERE agente_id = ? AND generacion = ?
      `,
      [
        resolverSinPol,
        resolverSinPol,
        resolverReinicioReciente,
        resolverReinicioReciente,
        textoObligatorio(checkpointCausal, 190, 'checkpointCausal'),
        enteroPositivo(agenteId, 'agenteId'),
        enteroPositivo(generacion, 'generacion')
      ]
    );
    return this.buscarPorPerfil(
      { agenteId, generacion },
      { conexion, bloquear: true }
    );
  }

  async aplicarPolEnTransaccion({
    agenteId,
    generacion,
    armarPerfil = false,
    armadaEnUtc = null,
    bootIdReferencia,
    periodoVidaPolId,
    ultimoSeq = null,
    ultimoPolUtc,
    tipoUltimoPol,
    valorSinPol,
    venceSinPolUtc,
    histeresisSinPolCapturadaSegundos,
    valorReinicioReciente,
    reemplazarBootIdReferencia = false,
    venceReinicioRecienteUtc = null,
    duracionReinicioCapturadaSegundos = null,
    ultimoCambioBootIdUtc = null,
    checkpointCausal
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const id = enteroPositivo(agenteId, 'agenteId');
    const numeroGeneracion = enteroPositivo(generacion, 'generacion');
    const periodoId = enteroPositivo(periodoVidaPolId, 'periodoVidaPolId');
    const tipo = String(tipoUltimoPol || '').trim();
    if (!['login', 'heartbeat'].includes(tipo)) {
      throw new Error('El POL reducido debe proceder de login o heartbeat.');
    }
    if (typeof valorSinPol !== 'boolean' ||
        typeof valorReinicioReciente !== 'boolean') {
      throw new Error('La proyección armada exige sus dos valores booleanos.');
    }
    const seq = ultimoSeq === null || ultimoSeq === undefined
      ? null
      : enteroNoNegativo(ultimoSeq, 'ultimoSeq');
    const bootId = textoObligatorio(
      bootIdReferencia,
      120,
      'bootIdReferencia'
    );
    const reemplazarBoot = Boolean(reemplazarBootIdReferencia);
    const duracionReinicio = duracionReinicioCapturadaSegundos === null ||
      duracionReinicioCapturadaSegundos === undefined
      ? null
      : enteroPositivo(
          duracionReinicioCapturadaSegundos,
          'duracionReinicioCapturadaSegundos'
        );

    if (armarPerfil) {
      const [resultadoPerfil] = await conexion.execute(
        `
          UPDATE perfiles_servidor_agentes
          SET estado = ?,
              armada_en_utc = ?,
              version_estado = version_estado + 1
          WHERE agente_id = ?
            AND generacion = ?
            AND estado = ?
            AND armada_en_utc IS NULL
        `,
        [
          ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO,
          fechaSql(armadaEnUtc, 'armadaEnUtc'),
          id,
          numeroGeneracion,
          ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA
        ]
      );
      if (Number(resultadoPerfil.affectedRows || 0) !== 1) {
        throw new Error('La generación servidor ya no puede armarse con este POL.');
      }
    }

    const [resultadoEstado] = await conexion.execute(
      `
        UPDATE estados_runtime_servidor_agentes
        SET boot_id_referencia = CASE
              WHEN ? THEN ? ELSE COALESCE(boot_id_referencia, ?)
            END,
            ultimo_periodo_pol_id = ?,
            ultimo_seq = ?,
            ultimo_pol_utc = ?,
            tipo_ultimo_pol = ?,
            valor_sin_pol = ?,
            vence_sin_pol_utc = ?,
            histeresis_sin_pol_capturada_segundos = ?,
            valor_reinicio_reciente = ?,
            vence_reinicio_reciente_utc = ?,
            duracion_reinicio_capturada_segundos = ?,
            ultimo_cambio_boot_id_utc = ?,
            checkpoint_causal = ?,
            version_estado = version_estado + 1
        WHERE agente_id = ?
          AND generacion = ?
          AND (
            ultimo_periodo_pol_id IS NULL
            OR ultimo_periodo_pol_id < ?
            OR (
              ultimo_periodo_pol_id = ?
              AND ? IS NOT NULL
              AND (ultimo_seq IS NULL OR ultimo_seq < ?)
            )
            OR (
              ?
              AND ultimo_periodo_pol_id = ?
              AND (
                ? IS NULL
                OR ultimo_seq IS NULL
                OR ultimo_seq <= ?
              )
              AND (
                boot_id_referencia IS NULL
                OR TRIM(boot_id_referencia) <> TRIM(?)
              )
            )
          )
      `,
      [
        reemplazarBoot,
        bootId,
        bootId,
        periodoId,
        seq,
        fechaSql(ultimoPolUtc, 'ultimoPolUtc'),
        tipo,
        valorSinPol ? 1 : 0,
        fechaSqlONulo(venceSinPolUtc, 'venceSinPolUtc'),
        enteroPositivoONulo(
          histeresisSinPolCapturadaSegundos,
          'histeresisSinPolCapturadaSegundos'
        ),
        valorReinicioReciente ? 1 : 0,
        fechaSqlONulo(
          venceReinicioRecienteUtc,
          'venceReinicioRecienteUtc'
        ),
        duracionReinicio,
        fechaSqlONulo(ultimoCambioBootIdUtc, 'ultimoCambioBootIdUtc'),
        textoObligatorio(checkpointCausal, 190, 'checkpointCausal'),
        id,
        numeroGeneracion,
        periodoId,
        periodoId,
        seq,
        seq,
        reemplazarBoot,
        periodoId,
        seq,
        seq,
        bootId
      ]
    );
    if (Number(resultadoEstado.affectedRows || 0) !== 1) {
      throw new Error('El checkpoint POL no puede retroceder ni repetirse.');
    }

    return this.buscarPorPerfil(
      { agenteId: id, generacion: numeroGeneracion },
      { conexion, bloquear: true }
    );
  }
}

function columnasPerfil(alias) {
  return `
    ${alias}.agente_id,
    ${alias}.generacion,
    ${alias}.estado,
    ${alias}.histeresis_sin_pol_segundos,
    ${alias}.duracion_reinicio_reciente_segundos,
    ${alias}.generada_en_utc,
    ${alias}.armada_en_utc,
    ${alias}.cerrada_en_utc,
    ${alias}.codigo_cierre,
    ${alias}.detalle_cierre,
    ${alias}.version_estado,
    ${alias}.fecha_creacion,
    ${alias}.fecha_actualizacion
  `;
}

function columnasEstado(alias, prefijo = '') {
  return [
    'agente_id', 'generacion', 'boot_id_referencia', 'ultimo_periodo_pol_id',
    'ultimo_seq', 'ultimo_pol_utc', 'tipo_ultimo_pol', 'valor_sin_pol',
    'vence_sin_pol_utc', 'histeresis_sin_pol_capturada_segundos',
    'valor_reinicio_reciente', 'vence_reinicio_reciente_utc',
    'duracion_reinicio_capturada_segundos', 'ultimo_cambio_boot_id_utc',
    'checkpoint_causal', 'version_estado', 'fecha_creacion',
    'fecha_actualizacion'
  ].map((columna) => `${alias}.${columna} AS ${prefijo}${columna}`).join(',\n');
}

function columnasTransicion(alias) {
  return [
    'id', 'agente_id', 'generacion', 'clave_causal', 'codigo_senal',
    'valor_booleano', 'causa', 'efectiva_en_utc', 'materializada_en_utc',
    'checkpoint_causal', 'observacion_telemetria_id'
  ].map((columna) => `${alias}.${columna}`).join(',\n');
}

function columnasPeriodoPol(alias, prefijo = '') {
  return [
    'id', 'agente_id', 'boot_id', 'inicio_utc', 'ultimo_heartbeat_utc',
    'ultimo_seq', 'heartbeats_recibidos'
  ].map((columna) => `${alias}.${columna} AS ${prefijo}${columna}`).join(',\n');
}

function extraerEstadoPrefijado(fila, prefijo) {
  return Object.fromEntries(Object.entries(fila)
    .filter(([clave]) => clave.startsWith(prefijo))
    .map(([clave, valor]) => [clave.slice(prefijo.length), valor]));
}

async function consultar(clienteSql, conexion, sql, parametros) {
  if (conexion) {
    const [filas] = await conexion.execute(sql, parametros);
    return filas;
  }
  return clienteSql.consultar(sql, parametros);
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('El estado runtime servidor exige una transacción SQL activa.');
  }
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }
  return numero;
}

function enteroNoNegativo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`${campo} debe ser un entero no negativo.`);
  }
  return numero;
}

function enteroPositivoONulo(valor, campo) {
  return valor === null || valor === undefined
    ? null
    : enteroPositivo(valor, campo);
}

function enteroAcotado(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

function fechaSql(valor, campo) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error(`${campo} no es una fecha válida.`);
  return fecha.toISOString().slice(0, 23).replace('T', ' ');
}

function fechaSqlONulo(valor, campo) {
  return valor === null || valor === undefined ? null : fechaSql(valor, campo);
}

function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La evidencia POL contiene una fecha inválida.');
  }
  return fecha.toISOString();
}

function fechaIsoONulo(valor) {
  return valor === null || valor === undefined ? null : fechaIso(valor);
}

function textoObligatorio(valor, maximo, campo) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > maximo) {
    throw new Error(`${campo} es obligatorio y admite hasta ${maximo} caracteres.`);
  }
  return texto;
}

function validarClaveCausal(valor) {
  const clave = String(valor || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(clave)) {
    throw new Error('La clave causal runtime debe ser una huella SHA-256.');
  }
  return clave;
}
