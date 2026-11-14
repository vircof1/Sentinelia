import {
  ESTADOS_PERFIL_SERVIDOR_AGENTE
} from './ContratoPerfilServidorAgente.js';
import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  crearPerfilServidorAgenteDesdeFila
} from './PerfilServidorAgente.js';

export class RepositorioPerfilesServidorAgentes {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async buscarPorAgenteId(agenteId, {
    conexion = null,
    bloquear = false
  } = {}) {
    if (bloquear && !conexion?.execute) {
      throw new Error(
        'El bloqueo del perfil servidor exige una transacción SQL.'
      );
    }
    const filas = await consultarSql(
      this.clienteSql,
      conexion,
      `
        SELECT ${columnasPerfil()}
        FROM perfiles_servidor_agentes
        WHERE agente_id = ?
        ORDER BY generacion DESC
        LIMIT 1${bloquear ? ' FOR UPDATE' : ''}
      `,
      [normalizarEnteroPositivo(agenteId, 'agenteId')]
    );

    return crearPerfilServidorAgenteDesdeFila(filas[0] || null);
  }

  async listarUltimosPorAgentesIds(agentesIds = []) {
    const ids = normalizarIdsUnicos(agentesIds, 'agenteId');
    if (ids.length === 0) return [];
    const marcadores = ids.map(() => '?').join(', ');
    const filas = await consultarSql(
      this.clienteSql,
      null,
      `
        SELECT ${columnasPerfil('p')}
        FROM perfiles_servidor_agentes p
        INNER JOIN (
          SELECT agente_id, MAX(generacion) AS generacion
          FROM perfiles_servidor_agentes
          WHERE agente_id IN (${marcadores})
          GROUP BY agente_id
        ) ultimo
          ON ultimo.agente_id = p.agente_id
          AND ultimo.generacion = p.generacion
        ORDER BY p.agente_id ASC
      `,
      ids
    );
    return filas.map(crearPerfilServidorAgenteDesdeFila);
  }

  async buscarEvidenciaElegibilidad(agenteId, { conexion = null } = {}) {
    const id = normalizarEnteroPositivo(agenteId, 'agenteId');
    const login = await consultarSql(
      this.clienteSql,
      conexion,
      `
        SELECT id, boot_id, inicio_utc
        FROM periodos_vida_pol_agentes
        WHERE agente_id = ?
          AND boot_id IS NOT NULL
          AND TRIM(boot_id) <> ''
        ORDER BY inicio_utc ASC, id ASC
        LIMIT 1
      `,
      [id]
    );
    const heartbeat = await consultarSql(
      this.clienteSql,
      conexion,
      `
        SELECT id, ultimo_heartbeat_utc
        FROM periodos_vida_pol_agentes
        WHERE agente_id = ?
          AND heartbeats_recibidos > 0
          AND ultimo_heartbeat_utc IS NOT NULL
        ORDER BY ultimo_heartbeat_utc ASC, id ASC
        LIMIT 1
      `,
      [id]
    );
    const evidenciaLogin = login[0] || null;
    const evidenciaHeartbeat = heartbeat[0] || null;

    return Object.freeze({
      loginValidoConBootId: Boolean(evidenciaLogin),
      heartbeatExplicitoAceptado: Boolean(evidenciaHeartbeat),
      login: evidenciaLogin
        ? Object.freeze({
            periodoVidaPolId: Number(evidenciaLogin.id),
            bootId: evidenciaLogin.boot_id,
            observadoEnUtc: normalizarMarcaUtc(evidenciaLogin.inicio_utc)
          })
        : null,
      heartbeat: evidenciaHeartbeat
        ? Object.freeze({
            periodoVidaPolId: Number(evidenciaHeartbeat.id),
            observadoEnUtc: normalizarMarcaUtc(
              evidenciaHeartbeat.ultimo_heartbeat_utc
            )
          })
        : null
    });
  }

  async promoverEnTransaccion({
    agenteId,
    histeresisSinPolSegundos,
    duracionReinicioRecienteSegundos,
    generadaEnUtc
  }, { conexion } = {}) {
    if (!conexion?.execute) {
      throw new Error(
        'La promoción del perfil servidor exige una transacción SQL.'
      );
    }

    const id = normalizarEnteroPositivo(agenteId, 'agenteId');
    const histeresis = normalizarEnteroPositivo(
      histeresisSinPolSegundos,
      'histeresisSinPolSegundos'
    );
    const duracionReinicio = normalizarEnteroPositivo(
      duracionReinicioRecienteSegundos,
      'duracionReinicioRecienteSegundos'
    );
    const fechaSql = normalizarFechaSql(generadaEnUtc, 'generadaEnUtc');
    const [agentes] = await conexion.execute(
      'SELECT id FROM agentes_sentinelia WHERE id = ? FOR UPDATE',
      [id]
    );

    if (agentes.length === 0) {
      throw new Error('No existe el agente que se quiere promover.');
    }

    const perfilAnterior = await this.buscarPorAgenteId(id, { conexion });
    if (perfilAnterior?.estaVigente()) {
      throw new Error(
        'El agente ya tiene una generación de perfil servidor vigente.'
      );
    }

    const generacion = (perfilAnterior?.generacion || 0) + 1;
    await conexion.execute(
      `
        INSERT INTO perfiles_servidor_agentes (
          agente_id,
          generacion,
          estado,
          histeresis_sin_pol_segundos,
          duracion_reinicio_reciente_segundos,
          generada_en_utc,
          version_estado
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
      `,
      [
        id,
        generacion,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
        histeresis,
        duracionReinicio,
        fechaSql
      ]
    );

    return this.buscarPorAgenteId(id, { conexion });
  }

  async cerrarEnTransaccion({
    agenteId,
    generacion,
    estado,
    codigoCierre,
    detalleCierre = null,
    cerradaEnUtc
  } = {}, { conexion } = {}) {
    if (!conexion?.execute) {
      throw new Error(
        'El cierre del perfil servidor exige una transacción SQL.'
      );
    }
    const estadoNormalizado = String(estado || '').trim();
    if (![
      ESTADOS_PERFIL_SERVIDOR_AGENTE.RETIRADO,
      ESTADOS_PERFIL_SERVIDOR_AGENTE.DESACTIVADO_INCOMPATIBLE
    ].includes(estadoNormalizado)) {
      throw new Error('El estado final del perfil servidor no es válido.');
    }
    const codigo = normalizarTextoObligatorio(codigoCierre, 80, 'codigoCierre');
    const detalle = normalizarTextoOpcionalAcotado(
      detalleCierre,
      512,
      'detalleCierre'
    );
    const id = normalizarEnteroPositivo(agenteId, 'agenteId');
    const numeroGeneracion = normalizarEnteroPositivo(
      generacion,
      'generacion'
    );
    const [resultado] = await conexion.execute(
      `
        UPDATE perfiles_servidor_agentes
        SET estado = ?,
            cerrada_en_utc = ?,
            codigo_cierre = ?,
            detalle_cierre = ?,
            version_estado = version_estado + 1
        WHERE agente_id = ?
          AND generacion = ?
          AND estado IN (?, ?)
      `,
      [
        estadoNormalizado,
        normalizarFechaSql(cerradaEnUtc, 'cerradaEnUtc'),
        codigo,
        detalle,
        id,
        numeroGeneracion,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO
      ]
    );
    if (Number(resultado.affectedRows || 0) !== 1) {
      throw new Error('La generación servidor ya no admite este cierre.');
    }
    return this.buscarPorAgenteId(id, { conexion, bloquear: true });
  }

  async actualizarConfiguracionEnTransaccion({
    agenteId,
    generacion,
    versionEsperada,
    histeresisSinPolSegundos,
    duracionReinicioRecienteSegundos
  } = {}, { conexion } = {}) {
    if (!conexion?.execute) {
      throw new Error(
        'La configuración del perfil servidor exige una transacción SQL.'
      );
    }
    const id = normalizarEnteroPositivo(agenteId, 'agenteId');
    const numeroGeneracion = normalizarEnteroPositivo(
      generacion,
      'generacion'
    );
    const version = normalizarEnteroPositivo(
      versionEsperada,
      'versionEsperada'
    );
    const histeresis = normalizarEnteroPositivo(
      histeresisSinPolSegundos,
      'histeresisSinPolSegundos'
    );
    const duracionReinicio = normalizarEnteroPositivo(
      duracionReinicioRecienteSegundos,
      'duracionReinicioRecienteSegundos'
    );
    const [resultado] = await conexion.execute(
      `
        UPDATE perfiles_servidor_agentes
        SET histeresis_sin_pol_segundos = ?,
            duracion_reinicio_reciente_segundos = ?,
            version_estado = version_estado + 1
        WHERE agente_id = ?
          AND generacion = ?
          AND version_estado = ?
          AND estado IN (?, ?)
      `,
      [
        histeresis,
        duracionReinicio,
        id,
        numeroGeneracion,
        version,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
        ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO
      ]
    );
    if (Number(resultado.affectedRows || 0) !== 1) {
      throw new Error(
        'El perfil servidor cambió mientras se editaba; recarga antes de continuar.'
      );
    }
    return this.buscarPorAgenteId(id, { conexion, bloquear: true });
  }
}

function columnasPerfil(alias = '') {
  const prefijo = alias ? `${alias}.` : '';
  return `
    ${prefijo}agente_id,
    ${prefijo}generacion,
    ${prefijo}estado,
    ${prefijo}histeresis_sin_pol_segundos,
    ${prefijo}duracion_reinicio_reciente_segundos,
    ${prefijo}generada_en_utc,
    ${prefijo}armada_en_utc,
    ${prefijo}cerrada_en_utc,
    ${prefijo}codigo_cierre,
    ${prefijo}detalle_cierre,
    ${prefijo}version_estado,
    ${prefijo}fecha_creacion,
    ${prefijo}fecha_actualizacion
  `;
}

async function consultarSql(clienteSql, conexion, sql, parametros) {
  if (conexion) {
    const [filas] = await conexion.execute(sql, parametros);
    return filas;
  }

  return clienteSql.consultar(sql, parametros);
}

function normalizarEnteroPositivo(valor, campo) {
  const numero = Number(valor);

  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }

  return numero;
}

function normalizarIdsUnicos(valores, campo) {
  if (!Array.isArray(valores)) {
    throw new Error(`${campo} debe ser una lista.`);
  }
  return [...new Set(valores.map((valor) =>
    normalizarEnteroPositivo(valor, campo)
  ))];
}

function normalizarFechaSql(valor, campo) {
  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`${campo} debe ser una fecha válida.`);
  }

  return fecha.toISOString().slice(0, 23).replace('T', ' ');
}

function normalizarTextoObligatorio(valor, maximo, campo) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > maximo) {
    throw new Error(`${campo} es obligatorio y admite hasta ${maximo} caracteres.`);
  }
  return texto;
}

function normalizarTextoOpcionalAcotado(valor, maximo, campo) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim();
  if (!texto || texto.length > maximo) {
    throw new Error(`${campo} admite hasta ${maximo} caracteres.`);
  }
  return texto;
}
