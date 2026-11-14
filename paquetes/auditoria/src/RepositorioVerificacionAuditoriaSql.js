import {
  obtenerHashGenesisAuditoriaV1,
  hashAuditoriaAHex
} from './SobreCanonicoAuditoria.js';
import { bytesAUuidV7Auditoria } from './UuidV7Auditoria.js';
import { ESTADOS_VERIFICACION_CADENA_AUDITORIA } from './VerificadorCadenaAuditoria.js';

export class RepositorioVerificacionAuditoriaSql {
  constructor({ clienteSql = null, conexion = null } = {}) {
    if (!clienteSql && !conexion?.execute) {
      throw new Error('RepositorioVerificacionAuditoriaSql requiere clienteSql o conexión SQL.');
    }
    this.clienteSql = clienteSql;
    this.conexion = conexion;
  }

  async ejecutarLecturaConsistente(tarea) {
    if (this.conexion) return tarea(this);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conexion.beginTransaction();
      const repositorio = new RepositorioVerificacionAuditoriaSql({ conexion });
      const resultado = await tarea(repositorio);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }

  async fijarAnclas({ claveCadena, desdeSecuencia = null, hastaSecuencia = null, usarCheckpoint = false } = {}) {
    const cabecera = await this.#leerCabecera(claveCadena);
    if (!cabecera) {
      return Object.freeze({
        estadoInicial: ESTADOS_VERIFICACION_CADENA_AUDITORIA.SIN_DATOS,
        claveCadena,
        desdeSecuencia,
        hastaSecuencia,
        hashAnterior: obtenerHashGenesisAuditoriaV1(),
        hashAnteriorHex: hashAuditoriaAHex(obtenerHashGenesisAuditoriaV1()),
        hashFinalEsperado: null,
        hashFinalEsperadoHex: null
      });
    }

    const checkpoint = usarCheckpoint
      ? await this.#leerCheckpoint(cabecera.id)
      : null;
    const desde = resolverDesde({ desdeSecuencia, checkpoint });
    const hasta = hastaSecuencia == null
      ? cabecera.ultimaSecuencia
      : BigInt(hastaSecuencia);
    if (hasta < desde) {
      return Object.freeze({
        estadoInicial: ESTADOS_VERIFICACION_CADENA_AUDITORIA.SIN_DATOS,
        claveCadena,
        cadenaId: cabecera.id,
        desdeSecuencia: String(desde),
        hastaSecuencia: String(hasta),
        hashAnterior: checkpoint?.hashUltimaSecuenciaRetirada ?? obtenerHashGenesisAuditoriaV1(),
        hashAnteriorHex: hashAuditoriaAHex(checkpoint?.hashUltimaSecuenciaRetirada ?? obtenerHashGenesisAuditoriaV1()),
        hashFinalEsperado: null,
        hashFinalEsperadoHex: null,
        cabeceraInicial: cabecera,
        checkpointInicial: checkpoint
      });
    }

    const hashAnterior = checkpoint && desde === checkpoint.primeraSecuenciaConservada
      ? checkpoint.hashUltimaSecuenciaRetirada
      : await this.#leerHashAnterior(cabecera.id, desde);
    const hashFinalEsperado = hasta === cabecera.ultimaSecuencia
      ? cabecera.ultimoHash
      : await this.#leerHashEvento(cabecera.id, hasta);

    return Object.freeze({
      estadoInicial: ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA,
      claveCadena,
      cadenaId: cabecera.id,
      desdeSecuencia: String(desde),
      hastaSecuencia: String(hasta),
      hashAnterior,
      hashAnteriorHex: hashAuditoriaAHex(hashAnterior),
      hashFinalEsperado,
      hashFinalEsperadoHex: hashAuditoriaAHex(hashFinalEsperado),
      cabeceraInicial: cabecera,
      checkpointInicial: checkpoint
    });
  }

  async leerPaginaEventos({ claveCadena, desdeExclusiva, hastaInclusiva, limite } = {}) {
    const [filas] = await this.conexion.execute(
      `
        SELECT
          evento_id, tipo_evento, version_contrato, flujo, clave_cadena,
          CAST(secuencia AS CHAR) AS secuencia,
          actor_real_tipo, actor_real_id, actor_efectivo_tipo, actor_efectivo_id,
          modo_actuacion, sujeto_tipo, sujeto_id, origen,
          scope_tenant_id, scope_empresa_id, scope_sitio_id, correlacion_id,
          causalidad_tipo, causalidad_id, productor, clave_operacion, rol_evento,
          DATE_FORMAT(efectivo_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS efectivo_en_utc,
          DATE_FORMAT(registrado_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS registrado_en_utc,
          version_canonicalizador, version_encadenado, payload,
          hash_payload, hash_anterior, hash_actual
        FROM eventos_auditoria
        WHERE clave_cadena = ?
          AND secuencia > ?
          AND secuencia <= ?
        ORDER BY secuencia ASC
        LIMIT ?
      `,
      [claveCadena, String(desdeExclusiva), String(hastaInclusiva), Number(limite)]
    );
    return filas.map(mapearEvento);
  }

  async confirmarAnclas(anclas = {}) {
    if (!anclas?.cadenaId) return Object.freeze({ estable: false, codigo: 'cadena_ausente' });
    const cabecera = await this.#leerCabecera(anclas.claveCadena);
    if (
      !cabecera ||
      cabecera.id !== anclas.cadenaId ||
      cabecera.ultimaSecuencia !== anclas.cabeceraInicial.ultimaSecuencia ||
      !cabecera.ultimoHash.equals(anclas.cabeceraInicial.ultimoHash)
    ) {
      return Object.freeze({
        estable: false,
        codigo: 'cabecera_modificada',
        mensaje: 'La cabecera de auditoría cambió mientras se verificaba la cadena.'
      });
    }
    const checkpoint = anclas.checkpointInicial
      ? await this.#leerCheckpoint(anclas.cadenaId)
      : null;
    if (!checkpointIgual(checkpoint, anclas.checkpointInicial)) {
      return Object.freeze({
        estable: false,
        codigo: 'checkpoint_modificado',
        mensaje: 'El checkpoint de auditoría cambió mientras se verificaba la cadena.'
      });
    }
    return Object.freeze({ estable: true });
  }

  async #leerCabecera(claveCadena) {
    const [filas] = await this.conexion.execute(
      `
        SELECT
          id, clave_cadena, flujo, tenant_id,
          CAST(ultima_secuencia AS CHAR) AS ultima_secuencia,
          ultimo_hash
        FROM cadenas_auditoria
        WHERE clave_cadena = ?
        LIMIT 1
      `,
      [claveCadena]
    );
    if (filas.length === 0) return null;
    return Object.freeze({
      id: Number(filas[0].id),
      claveCadena: filas[0].clave_cadena,
      flujo: filas[0].flujo,
      tenantId: filas[0].tenant_id == null ? null : String(filas[0].tenant_id),
      ultimaSecuencia: BigInt(filas[0].ultima_secuencia),
      ultimoHash: Buffer.from(filas[0].ultimo_hash)
    });
  }

  async #leerCheckpoint(cadenaId) {
    const [filas] = await this.conexion.execute(
      `
        SELECT
          CAST(ultima_secuencia_retirada AS CHAR) AS ultima_secuencia_retirada,
          hash_ultima_secuencia_retirada,
          CAST(primera_secuencia_conservada AS CHAR) AS primera_secuencia_conservada,
          politica_dias,
          DATE_FORMAT(aplicado_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS aplicado_en_utc,
          evento_retencion_id
        FROM checkpoints_auditoria
        WHERE cadena_id = ?
        LIMIT 1
      `,
      [cadenaId]
    );
    if (filas.length === 0) return null;
    return Object.freeze({
      ultimaSecuenciaRetirada: BigInt(filas[0].ultima_secuencia_retirada),
      hashUltimaSecuenciaRetirada: Buffer.from(filas[0].hash_ultima_secuencia_retirada),
      primeraSecuenciaConservada: filas[0].primera_secuencia_conservada == null
        ? null
        : BigInt(filas[0].primera_secuencia_conservada),
      politicaDias: Number(filas[0].politica_dias),
      aplicadoEnUtc: normalizarFechaSqlTexto(filas[0].aplicado_en_utc),
      eventoRetencionId: bytesAUuidV7Auditoria(filas[0].evento_retencion_id)
    });
  }

  async #leerHashAnterior(cadenaId, desde) {
    if (desde === 1n) return obtenerHashGenesisAuditoriaV1();
    return this.#leerHashEvento(cadenaId, desde - 1n);
  }

  async #leerHashEvento(cadenaId, secuencia) {
    const [filas] = await this.conexion.execute(
      `
        SELECT hash_actual
        FROM eventos_auditoria
        WHERE cadena_id = ? AND secuencia = ?
        LIMIT 1
      `,
      [cadenaId, String(secuencia)]
    );
    if (filas.length !== 1) {
      throw new Error(`No existe ancla de hash para la secuencia ${secuencia}.`);
    }
    return Buffer.from(filas[0].hash_actual);
  }
}

function resolverDesde({ desdeSecuencia, checkpoint }) {
  if (desdeSecuencia != null) return BigInt(desdeSecuencia);
  if (checkpoint?.primeraSecuenciaConservada != null) {
    return checkpoint.primeraSecuenciaConservada;
  }
  return 1n;
}

function mapearEvento(fila) {
  const sobre = Object.freeze({
    eventoId: bytesAUuidV7Auditoria(fila.evento_id),
    tipo: fila.tipo_evento,
    versionContrato: Number(fila.version_contrato),
    flujo: fila.flujo,
    claveCadena: fila.clave_cadena,
    secuencia: String(fila.secuencia),
    actorReal: Object.freeze({
      tipo: fila.actor_real_tipo,
      id: fila.actor_real_id
    }),
    actorEfectivo: fila.actor_efectivo_tipo == null
      ? null
      : Object.freeze({
        tipo: fila.actor_efectivo_tipo,
        id: fila.actor_efectivo_id
      }),
    modoActuacion: fila.modo_actuacion,
    sujeto: Object.freeze({
      tipo: fila.sujeto_tipo,
      id: fila.sujeto_id
    }),
    origen: fila.origen,
    scope: Object.freeze({
      tenantId: fila.scope_tenant_id == null ? null : String(fila.scope_tenant_id),
      empresaId: fila.scope_empresa_id == null ? null : String(fila.scope_empresa_id),
      sitioId: fila.scope_sitio_id == null ? null : String(fila.scope_sitio_id)
    }),
    correlacionId: bytesAUuidV7Auditoria(fila.correlacion_id),
    causalidad: fila.causalidad_tipo == null
      ? null
      : Object.freeze({
        tipo: fila.causalidad_tipo,
        id: fila.causalidad_id
      }),
    productor: fila.productor,
    claveOperacion: Buffer.from(fila.clave_operacion).toString('ascii'),
    rolEvento: fila.rol_evento,
    efectivoEnUtc: normalizarFechaSqlTexto(fila.efectivo_en_utc),
    registradoEnUtc: normalizarFechaSqlTexto(fila.registrado_en_utc),
    versionCanonicalizador: fila.version_canonicalizador,
    versionEncadenado: fila.version_encadenado,
    payload: typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload
  });
  return Object.freeze({
    sobre,
    secuencia: sobre.secuencia,
    hashPayload: Buffer.from(fila.hash_payload),
    hashAnterior: Buffer.from(fila.hash_anterior),
    hashActual: Buffer.from(fila.hash_actual)
  });
}

function checkpointIgual(actual, esperado) {
  if (actual === null || esperado === null) return actual === esperado;
  return (
    actual.ultimaSecuenciaRetirada === esperado.ultimaSecuenciaRetirada &&
    actual.hashUltimaSecuenciaRetirada.equals(esperado.hashUltimaSecuenciaRetirada) &&
    actual.primeraSecuenciaConservada === esperado.primeraSecuenciaConservada &&
    actual.politicaDias === esperado.politicaDias &&
    actual.aplicadoEnUtc === esperado.aplicadoEnUtc &&
    actual.eventoRetencionId === esperado.eventoRetencionId
  );
}

function normalizarFechaSqlTexto(valor) {
  const texto = String(valor);
  const coincidencia = texto.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})\d{3}Z$/
  );
  if (!coincidencia) throw new Error(`Fecha SQL UTC no canónica: ${texto}.`);
  return `${coincidencia[1]}.${coincidencia[2]}Z`;
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva la autoridad diagnóstica.
  }
}
