import { isDeepStrictEqual } from 'node:util';
import {
  MAX_SECUENCIA_AUDITORIA,
  obtenerHashGenesisAuditoriaV1,
  prepararEventoEncadenadoAuditoriaV1
} from './SobreCanonicoAuditoria.js';
import {
  construirIntencionGenesisAuditoriaV1,
  obtenerHuellaEventoIdAuditoriaV1,
  prepararIntencionAuditoriaV1
} from './HuellaIntencionAuditoria.js';
import {
  bytesAUuidV7Auditoria,
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from './UuidV7Auditoria.js';
import { validarParMovimientoAuditoriaV1 } from './ValidadorContratoAuditoria.js';

const ERRORES_TRANSITORIOS = new Set([
  'ER_LOCK_DEADLOCK',
  'ER_CHECKREAD',
  'ER_LOCK_WAIT_TIMEOUT'
]);

export class ConflictoIdempotenciaAuditoria extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ConflictoIdempotenciaAuditoria';
    this.codigo = 'conflicto_idempotencia_auditoria';
  }
}

export class IncoherenciaCadenaAuditoria extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'IncoherenciaCadenaAuditoria';
    this.codigo = 'incoherencia_cadena_auditoria';
  }
}

export class RepositorioAuditoria {
  constructor(clienteSql, { maxReintentos = 3 } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('RepositorioAuditoria requiere un cliente SQL operativo.');
    }
    if (!Number.isInteger(maxReintentos) || maxReintentos < 0 || maxReintentos > 10) {
      throw new Error('maxReintentos debe ser un entero entre 0 y 10.');
    }
    this.clienteSql = clienteSql;
    this.maxReintentos = maxReintentos;
  }

  async incorporarAtomico(intenciones = []) {
    let intento = 0;
    const contextoReintento = { genesisPreasignadas: new Map() };
    while (true) {
      const conexion = await this.clienteSql.obtenerConexion();
      try {
        await conexion.beginTransaction();
        const resultado = await this.incorporarEnTransaccion(intenciones, {
          conexion,
          contextoReintento
        });
        await conexion.commit();
        return Object.freeze({ ...resultado, reintentos: intento });
      } catch (error) {
        await rollbackSeguro(conexion);
        if (!ERRORES_TRANSITORIOS.has(error?.code) || intento >= this.maxReintentos) {
          throw error;
        }
        intento += 1;
      } finally {
        conexion.release();
      }
    }
  }

  async incorporarEnTransaccion(
    intenciones = [],
    { conexion, contextoReintento = { genesisPreasignadas: new Map() } } = {}
  ) {
    if (!conexion?.execute) {
      throw new Error('incorporarEnTransaccion requiere una conexión SQL explícita.');
    }
    if (!(contextoReintento?.genesisPreasignadas instanceof Map)) {
      throw new Error('El contexto de reintento de génesis no es válido.');
    }
    const lote = normalizarLote(intenciones);
    const ahoraLote = await obtenerAhoraSql(conexion);
    const preparadasNegocio = lote.map((intencion, indice) => ({
      clase: 'negocio',
      indice,
      ...prepararIntencionAuditoriaV1(intencion)
    }));
    const claves = ordenarBinarioUnico(
      preparadasNegocio.map(({ intencion }) => intencion.claveCadena)
    );
    const existentesAntes = await buscarCadenasExistentes(conexion, claves);
    const genesisPreparadas = construirGenesisFaltantes({
      claves,
      existentesAntes,
      preparadasNegocio,
      efectivoEnUtc: ahoraLote.textoUtc,
      genesisPreasignadas: contextoReintento.genesisPreasignadas
    });
    const reservas = ordenarReservas([
      ...preparadasNegocio,
      ...genesisPreparadas
    ]);

    for (const reserva of reservas) {
      Object.assign(
        reserva,
        await reservarIdentidad(conexion, reserva, ahoraLote.escalarSql)
      );
    }
    validarResultadoMovimiento(preparadasNegocio);

    const nuevas = reservas.filter((reserva) => reserva.nueva);
    await reservarHuellasEvento(conexion, nuevas);

    const nuevosNegocio = preparadasNegocio.filter((reserva) => reserva.nueva);
    if (nuevosNegocio.length === 0) {
      return construirResultado({
        preparadasNegocio,
        genesisPreparadas,
        registradoEnUtc: null
      });
    }

    const clavesNuevas = ordenarBinarioUnico(
      nuevosNegocio.map(({ intencion }) => intencion.claveCadena)
    );
    const genesisPorClave = new Map(
      genesisPreparadas.map((reserva) => [reserva.intencion.claveCadena, reserva])
    );
    const cabeceras = await bloquearCabeceras({
      conexion,
      claves: clavesNuevas,
      genesisPorClave,
      fechaSql: ahoraLote.escalarSql
    });

    for (const claveCadena of clavesNuevas) {
      const cabecera = cabeceras.get(claveCadena);
      const genesis = genesisPorClave.get(claveCadena);
      const eventosCadena = nuevosNegocio
        .filter((reserva) => reserva.intencion.claveCadena === claveCadena)
        .sort(compararOrdenIncorporacion);
      const aIncorporar = genesis?.nueva
        ? [genesis, ...eventosCadena]
        : eventosCadena;

      for (const reserva of aIncorporar) {
        const secuencia = cabecera.ultimaSecuencia + 1n;
        if (secuencia > MAX_SECUENCIA_AUDITORIA) {
          throw new IncoherenciaCadenaAuditoria(
            `La cadena ${claveCadena} agotó su espacio de secuencia.`
          );
        }
        const sobre = {
          ...reserva.intencion,
          secuencia: String(secuencia),
          registradoEnUtc: ahoraLote.textoUtc
        };
        const evento = prepararEventoEncadenadoAuditoriaV1(sobre, {
          hashAnterior: cabecera.ultimoHash
        });
        await insertarEvento(conexion, cabecera.id, evento);
        reserva.secuencia = String(secuencia);
        reserva.claveCadena = claveCadena;
        reserva.estadoResultado = 'incorporado';
        cabecera.ultimaSecuencia = secuencia;
        cabecera.ultimoHash = evento.hashActual;
      }

      await actualizarCabecera(
        conexion,
        cabecera,
        ahoraLote.escalarSql
      );
    }

    return construirResultado({
      preparadasNegocio,
      genesisPreparadas,
      registradoEnUtc: ahoraLote.textoUtc
    });
  }

  async buscarPorIdentidadEnTransaccion(
    { productor, claveOperacion, rolEvento } = {},
    { conexion } = {}
  ) {
    if (!conexion?.execute) {
      throw new Error('La recuperación auditable exige una conexión SQL explícita.');
    }
    const productorNormalizado = String(productor || '');
    const claveNormalizada = String(claveOperacion || '');
    const rolNormalizado = String(rolEvento || '');
    if (!productorNormalizado || !claveNormalizada ||
        !['principal', 'salida', 'entrada', 'resultado'].includes(rolNormalizado)) {
      throw new Error('La identidad auditable de recuperación no es válida.');
    }
    const [filas] = await conexion.execute(
      `SELECT e.evento_id,e.tipo_evento,e.flujo,e.clave_cadena,
              CAST(e.secuencia AS CHAR) secuencia,e.sujeto_tipo,e.sujeto_id,
              e.correlacion_id,e.productor,e.clave_operacion,e.rol_evento,
              DATE_FORMAT(e.efectivo_en_utc,
                '%Y-%m-%dT%H:%i:%s.%fZ') efectivo_en_utc,
              DATE_FORMAT(e.registrado_en_utc,
                '%Y-%m-%dT%H:%i:%s.%fZ') registrado_en_utc,
              e.payload
         FROM identidades_idempotentes_auditoria i
         JOIN eventos_auditoria e ON e.evento_id=i.evento_id
        WHERE i.productor=? AND i.clave_operacion=? AND i.rol_evento=?
          AND i.estado='vigente'
        LIMIT 1 FOR UPDATE`,
      [productorNormalizado, Buffer.from(claveNormalizada, 'ascii'), rolNormalizado]
    );
    if (!filas[0]) return null;
    const fila = filas[0];
    return Object.freeze({
      estado: 'existente',
      eventoId: bytesAUuidV7Auditoria(fila.evento_id),
      tipo: String(fila.tipo_evento),
      flujo: String(fila.flujo),
      claveCadena: String(fila.clave_cadena),
      secuencia: String(fila.secuencia),
      sujeto: Object.freeze({
        tipo: String(fila.sujeto_tipo),
        id: String(fila.sujeto_id)
      }),
      correlacionId: bytesAUuidV7Auditoria(fila.correlacion_id),
      productor: String(fila.productor),
      claveOperacion: Buffer.from(fila.clave_operacion).toString('ascii'),
      rolEvento: String(fila.rol_evento),
      efectivoEnUtc: normalizarFechaSqlTexto(fila.efectivo_en_utc),
      registradoEnUtc: normalizarFechaSqlTexto(fila.registrado_en_utc),
      payload: Object.freeze(
        typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload
      )
    });
  }

  async existeTestigoEventoEnTransaccion(eventoId, { conexion } = {}) {
    if (!conexion?.execute) {
      throw new Error('La consulta del testigo auditable exige una conexión SQL explícita.');
    }
    const huella = obtenerHuellaEventoIdAuditoriaV1(
      uuidV7AuditoriaABytes(eventoId)
    );
    const [filas] = await conexion.execute(
      `SELECT 1 AS existe
         FROM tombstones_identidad_auditoria
        WHERE huella_evento_id = ?
        LIMIT 1
        FOR UPDATE`,
      [huella]
    );
    return filas.length === 1;
  }
}

function normalizarLote(intenciones) {
  if (!Array.isArray(intenciones) || intenciones.length === 0) {
    throw new Error('Debe incorporarse al menos una intención auditable.');
  }
  const ids = new Set();
  const identidades = [];
  for (const intencion of intenciones) {
    const eventoId = intencion?.eventoId;
    if (ids.has(eventoId)) throw new Error('El lote repite un eventoId.');
    ids.add(eventoId);
    const identidad = [
      intencion?.productor,
      intencion?.claveOperacion,
      intencion?.rolEvento
    ];
    if (identidades.some((actual) =>
      actual.every((valor, indice) => valor === identidad[indice])
    )) {
      throw new Error('El lote repite una identidad idempotente.');
    }
    identidades.push(identidad);
  }
  validarMovimiento(intenciones);
  return [...intenciones];
}

function validarMovimiento(intenciones) {
  const movimientos = intenciones.filter(({ tipo }) => tipo?.startsWith('scope.entidad_'));
  if (movimientos.length === 0) return;
  if (movimientos.length !== 2) {
    throw new Error('Un movimiento de scope exige exactamente su par salida/entrada.');
  }
  const salida = movimientos.find(({ tipo }) => tipo === 'scope.entidad_salida');
  const entrada = movimientos.find(({ tipo }) => tipo === 'scope.entidad_entrada');
  if (!salida || !entrada || salida.rolEvento !== 'salida' || entrada.rolEvento !== 'entrada') {
    throw new Error('El movimiento debe declarar los roles normativos salida/entrada.');
  }
  for (const campo of ['productor', 'claveOperacion', 'correlacionId', 'efectivoEnUtc']) {
    if (salida[campo] !== entrada[campo]) {
      throw new Error(`El movimiento debe compartir ${campo}.`);
    }
  }
  if (
    !isDeepStrictEqual(salida.actorReal, entrada.actorReal) ||
    !isDeepStrictEqual(salida.actorEfectivo, entrada.actorEfectivo) ||
    !isDeepStrictEqual(salida.sujeto, entrada.sujeto) ||
    !isDeepStrictEqual(salida.causalidad, entrada.causalidad)
  ) {
    throw new Error('El movimiento debe compartir actor, sujeto y causalidad.');
  }
  if (
    salida.payload?.eventoContraparteId !== entrada.eventoId ||
    entrada.payload?.eventoContraparteId !== salida.eventoId
  ) {
    throw new Error('Los eventos del movimiento deben referenciarse como contraparte.');
  }
  for (const consecuencia of intenciones.filter(
    ({ tipo }) => !tipo?.startsWith('scope.entidad_')
  )) {
    const resultadoInvalido =
      consecuencia.rolEvento !== 'resultado' ||
      consecuencia.correlacionId !== salida.correlacionId ||
      consecuencia.causalidad?.tipo !== 'evento_auditoria' ||
      consecuencia.causalidad?.id !== salida.eventoId;
    const esPrincipal =
      consecuencia.rolEvento === 'principal' &&
      consecuencia.correlacionId === salida.correlacionId &&
      consecuencia.causalidad === null;
    if (resultadoInvalido && !esPrincipal) {
      throw new Error(
        'Un evento auxiliar de movimiento debe ser principal correlacionado o resultado causado por la salida.'
      );
    }
  }
}

function validarResultadoMovimiento(preparadas) {
  if (!preparadas.some(({ intencion }) => intencion.tipo.startsWith('scope.entidad_'))) {
    return;
  }
  const salida = preparadas.find(
    ({ intencion }) => intencion.tipo === 'scope.entidad_salida'
  );
  const entrada = preparadas.find(
    ({ intencion }) => intencion.tipo === 'scope.entidad_entrada'
  );
  validarParMovimientoAuditoriaV1(salida?.intencion, entrada?.intencion);
  const nuevas = preparadas.filter(
    (reserva) => reserva.intencion.tipo.startsWith('scope.entidad_') && reserva.nueva
  ).length;
  if (nuevas !== 0 && nuevas !== 2) {
    throw new IncoherenciaCadenaAuditoria(
      'El movimiento de scope presenta una incorporación parcial imposible.'
    );
  }
  const totalNuevas = preparadas.filter((reserva) => reserva.nueva).length;
  if (totalNuevas !== 0 && totalNuevas !== preparadas.length) {
    throw new IncoherenciaCadenaAuditoria(
      'El movimiento y sus resultados presentan una incorporación parcial imposible.'
    );
  }
}

function construirGenesisFaltantes({
  claves,
  existentesAntes,
  preparadasNegocio,
  efectivoEnUtc,
  genesisPreasignadas
}) {
  return claves
    .filter((clave) => !existentesAntes.has(clave))
    .map((claveCadena) => {
      const primera = preparadasNegocio.find(
        ({ intencion }) => intencion.claveCadena === claveCadena
      ).intencion;
      let entrada = genesisPreasignadas.get(claveCadena);
      if (!entrada) {
        entrada = construirIntencionGenesisAuditoriaV1({
          eventoId: generarUuidV7Auditoria(),
          flujo: primera.flujo,
          claveCadena,
          tenantId: primera.scope.tenantId,
          origen: primera.origen,
          correlacionId: primera.correlacionId,
          efectivoEnUtc
        });
        genesisPreasignadas.set(claveCadena, entrada);
      }
      return {
        clase: 'genesis',
        indice: -1,
        ...prepararIntencionAuditoriaV1(entrada)
      };
    });
}

async function buscarCadenasExistentes(conexion, claves) {
  if (claves.length === 0) return new Set();
  const [filas] = await conexion.execute(
    `SELECT clave_cadena FROM cadenas_auditoria WHERE clave_cadena IN (${marcadores(claves)})`,
    claves
  );
  return new Set(filas.map((fila) => fila.clave_cadena));
}

async function reservarIdentidad(conexion, reserva, primeraObservacionSql) {
  const { intencion, huella } = reserva;
  const eventoId = uuidV7AuditoriaABytes(intencion.eventoId);
  const claveOperacion = Buffer.from(intencion.claveOperacion, 'ascii');
  const [insercion] = await conexion.execute(
    `
      INSERT IGNORE INTO identidades_idempotentes_auditoria (
        productor, clave_operacion, rol_evento, huella_intencion, evento_id,
        estado, primera_observacion_utc, retenido_en_utc
      ) VALUES (?, ?, ?, ?, ?, 'vigente', ?, NULL)
    `,
    [
      intencion.productor,
      claveOperacion,
      intencion.rolEvento,
      huella,
      eventoId,
      primeraObservacionSql
    ]
  );
  const [filas] = await conexion.execute(
    `
      SELECT
        huella_intencion, evento_id, estado,
        DATE_FORMAT(primera_observacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS primera_observacion_utc
      FROM identidades_idempotentes_auditoria
      WHERE productor = ? AND clave_operacion = ? AND rol_evento = ?
      LIMIT 1
      FOR UPDATE
    `,
    [intencion.productor, claveOperacion, intencion.rolEvento]
  );
  if (filas.length === 0) {
    const [porEvento] = await conexion.execute(
      'SELECT 1 FROM identidades_idempotentes_auditoria WHERE evento_id = ? LIMIT 1 FOR UPDATE',
      [eventoId]
    );
    if (porEvento.length > 0) {
      throw new ConflictoIdempotenciaAuditoria(
        `El eventoId ${intencion.eventoId} ya pertenece a otra intención.`
      );
    }
    throw new Error('No se pudo reservar la identidad idempotente.');
  }
  const fila = filas[0];
  const nueva = Number(insercion.affectedRows) === 1;
  if (nueva) {
    return {
      nueva: true,
      estadoResultado: null,
      primeraObservacionUtc: normalizarFechaSqlTexto(fila.primera_observacion_utc)
    };
  }
  if (reserva.clase !== 'genesis' && !Buffer.from(fila.huella_intencion).equals(huella)) {
    throw new ConflictoIdempotenciaAuditoria(
      `La identidad ${intencion.productor}/${intencion.claveOperacion}/${intencion.rolEvento} ya protege otra intención.`
    );
  }
  if (reserva.clase !== 'genesis' && !Buffer.from(fila.evento_id).equals(eventoId)) {
    throw new ConflictoIdempotenciaAuditoria(
      'Un reintento compatible debe conservar el eventoId preasignado.'
    );
  }
  if (fila.estado === 'retenido') {
    return {
      nueva: false,
      estadoResultado: 'retenido',
      eventoIdPersistido: bytesAUuidV7Auditoria(fila.evento_id),
      secuencia: null,
      claveCadena: intencion.claveCadena,
      primeraObservacionUtc: normalizarFechaSqlTexto(fila.primera_observacion_utc)
    };
  }
  const [eventos] = await conexion.execute(
    `
      SELECT clave_cadena, CAST(secuencia AS CHAR) AS secuencia
      FROM eventos_auditoria
      WHERE evento_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [fila.evento_id]
  );
  if (eventos.length === 0) {
    throw new IncoherenciaCadenaAuditoria(
      'Existe una identidad vigente sin su evento auditable.'
    );
  }
  return {
    nueva: false,
    estadoResultado: 'existente',
    eventoIdPersistido: bytesAUuidV7Auditoria(fila.evento_id),
    secuencia: String(eventos[0].secuencia),
    claveCadena: eventos[0].clave_cadena,
    primeraObservacionUtc: normalizarFechaSqlTexto(fila.primera_observacion_utc)
  };
}

async function reservarHuellasEvento(conexion, reservas) {
  const ordenadas = reservas
    .map((reserva) => ({
      reserva,
      eventoId: uuidV7AuditoriaABytes(reserva.intencion.eventoId)
    }))
    .map((entrada) => ({
      ...entrada,
      huella: obtenerHuellaEventoIdAuditoriaV1(entrada.eventoId)
    }))
    .sort((a, b) => Buffer.compare(a.huella, b.huella));
  for (const { reserva, huella } of ordenadas) {
    try {
      await conexion.execute(
        'INSERT INTO tombstones_identidad_auditoria (huella_evento_id) VALUES (?)',
        [huella]
      );
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      throw new ConflictoIdempotenciaAuditoria(
        `El eventoId ${reserva.intencion.eventoId} ya fue incorporado anteriormente.`
      );
    }
  }
}

async function bloquearCabeceras({ conexion, claves, genesisPorClave, fechaSql }) {
  const resultado = new Map();
  for (const claveCadena of claves) {
    let cabecera = await buscarCabeceraParaActualizar(conexion, claveCadena);
    const genesis = genesisPorClave.get(claveCadena);
    if (!cabecera) {
      if (!genesis?.nueva) {
        throw new IncoherenciaCadenaAuditoria(
          `La génesis ${claveCadena} existe sin cabecera de cadena.`
        );
      }
      const intencion = genesis.intencion;
      await conexion.execute(
        `
          INSERT INTO cadenas_auditoria (
            clave_cadena, flujo, tenant_id, ultima_secuencia, ultimo_hash,
            fecha_creacion_utc, fecha_actualizacion_utc
          ) VALUES (?, ?, ?, 1, ?, ?, ?)
        `,
        [
          claveCadena,
          intencion.flujo,
          intencion.scope.tenantId,
          obtenerHashGenesisAuditoriaV1(),
          fechaSql,
          fechaSql
        ]
      );
      cabecera = await buscarCabeceraParaActualizar(conexion, claveCadena);
      cabecera.nueva = true;
      cabecera.ultimaSecuencia = 0n;
      cabecera.ultimoHash = obtenerHashGenesisAuditoriaV1();
    } else {
      if (genesis?.nueva) {
        throw new IncoherenciaCadenaAuditoria(
          `La cabecera ${claveCadena} existe sin su identidad de génesis.`
        );
      }
      await verificarPuntaCadena(conexion, cabecera);
    }
    resultado.set(claveCadena, cabecera);
  }
  return resultado;
}

async function buscarCabeceraParaActualizar(conexion, claveCadena) {
  const [filas] = await conexion.execute(
    `
      SELECT
        id, clave_cadena, flujo, tenant_id,
        CAST(ultima_secuencia AS CHAR) AS ultima_secuencia,
        ultimo_hash
      FROM cadenas_auditoria
      WHERE clave_cadena = ?
      LIMIT 1
      FOR UPDATE
    `,
    [claveCadena]
  );
  if (filas.length === 0) return null;
  return {
    id: filas[0].id,
    claveCadena: filas[0].clave_cadena,
    flujo: filas[0].flujo,
    tenantId: filas[0].tenant_id == null ? null : String(filas[0].tenant_id),
    ultimaSecuencia: BigInt(filas[0].ultima_secuencia),
    ultimoHash: Buffer.from(filas[0].ultimo_hash),
    nueva: false
  };
}

async function verificarPuntaCadena(conexion, cabecera) {
  const [filas] = await conexion.execute(
    `
      SELECT hash_actual
      FROM eventos_auditoria
      WHERE cadena_id = ? AND secuencia = ?
      LIMIT 1
      FOR UPDATE
    `,
    [cabecera.id, String(cabecera.ultimaSecuencia)]
  );
  if (filas.length === 1) {
    if (Buffer.from(filas[0].hash_actual).equals(cabecera.ultimoHash)) return;
    throw new IncoherenciaCadenaAuditoria(
      `La cabecera ${cabecera.claveCadena} no coincide con su último evento.`
    );
  }
  if (filas.length > 1) {
    throw new IncoherenciaCadenaAuditoria(
      `La cabecera ${cabecera.claveCadena} presenta una punta ambigua.`
    );
  }

  const [checkpoints] = await conexion.execute(
    `
      SELECT
        CAST(ultima_secuencia_retirada AS CHAR) AS ultima_secuencia_retirada,
        hash_ultima_secuencia_retirada,
        primera_secuencia_conservada
      FROM checkpoints_auditoria
      WHERE cadena_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [cabecera.id]
  );
  const checkpoint = checkpoints[0];
  const recorteCompletoCoherente =
    checkpoints.length === 1 &&
    checkpoint.primera_secuencia_conservada == null &&
    BigInt(checkpoint.ultima_secuencia_retirada) === cabecera.ultimaSecuencia &&
    Buffer.from(checkpoint.hash_ultima_secuencia_retirada).equals(cabecera.ultimoHash);
  if (!recorteCompletoCoherente) {
    throw new IncoherenciaCadenaAuditoria(
      `La cabecera ${cabecera.claveCadena} no coincide con su último evento ni con un checkpoint de recorte completo.`
    );
  }
}

export const __testablesRepositorioAuditoria = Object.freeze({
  verificarPuntaCadena
});

async function insertarEvento(conexion, cadenaId, preparado) {
  const sobre = preparado.sobre;
  await conexion.execute(
    `
      INSERT INTO eventos_auditoria (
        evento_id, cadena_id, tipo_evento, version_contrato, flujo, clave_cadena,
        secuencia, actor_real_tipo, actor_real_id, actor_efectivo_tipo,
        actor_efectivo_id, modo_actuacion, sujeto_tipo, sujeto_id, origen,
        scope_tenant_id, scope_empresa_id, scope_sitio_id, correlacion_id,
        causalidad_tipo, causalidad_id, productor, clave_operacion, rol_evento,
        efectivo_en_utc, registrado_en_utc, version_canonicalizador,
        version_encadenado, payload, evento_contraparte_id, hash_payload,
        hash_anterior, hash_actual
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    [
      uuidV7AuditoriaABytes(sobre.eventoId),
      cadenaId,
      sobre.tipo,
      sobre.versionContrato,
      sobre.flujo,
      sobre.claveCadena,
      sobre.secuencia,
      sobre.actorReal.tipo,
      sobre.actorReal.id,
      sobre.actorEfectivo?.tipo ?? null,
      sobre.actorEfectivo?.id ?? null,
      sobre.modoActuacion,
      sobre.sujeto.tipo,
      sobre.sujeto.id,
      sobre.origen,
      sobre.scope.tenantId,
      sobre.scope.empresaId,
      sobre.scope.sitioId,
      uuidV7AuditoriaABytes(sobre.correlacionId),
      sobre.causalidad?.tipo ?? null,
      sobre.causalidad?.id ?? null,
      sobre.productor,
      Buffer.from(sobre.claveOperacion, 'ascii'),
      sobre.rolEvento,
      fechaUtcASql(sobre.efectivoEnUtc),
      fechaUtcASql(sobre.registradoEnUtc),
      sobre.versionCanonicalizador,
      sobre.versionEncadenado,
      JSON.stringify(sobre.payload),
      sobre.tipo.startsWith('scope.entidad_')
        ? uuidV7AuditoriaABytes(sobre.payload.eventoContraparteId)
        : null,
      preparado.hashPayload,
      preparado.hashAnterior,
      preparado.hashActual
    ]
  );
}

async function actualizarCabecera(conexion, cabecera, fechaSql) {
  const [resultado] = await conexion.execute(
    `
      UPDATE cadenas_auditoria
      SET ultima_secuencia = ?, ultimo_hash = ?, fecha_actualizacion_utc = ?,
          fecha_creacion_utc = CASE WHEN ? THEN ? ELSE fecha_creacion_utc END
      WHERE id = ?
    `,
    [
      String(cabecera.ultimaSecuencia),
      cabecera.ultimoHash,
      fechaSql,
      cabecera.nueva ? 1 : 0,
      fechaSql,
      cabecera.id
    ]
  );
  if (Number(resultado.affectedRows) !== 1) {
    throw new IncoherenciaCadenaAuditoria(
      `No se pudo consolidar la cabecera ${cabecera.claveCadena}.`
    );
  }
}

async function obtenerAhoraSql(conexion) {
  const [filas] = await conexion.execute(
    `
      SELECT
        DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS escalar_sql
    `
  );
  if (!filas[0]?.escalar_sql) {
    throw new Error('MariaDB no devolvió el reloj UTC de auditoría.');
  }
  const escalarSql = normalizarFechaSqlEscalar(filas[0].escalar_sql);
  return {
    textoUtc: `${escalarSql.replace(' ', 'T')}Z`,
    escalarSql
  };
}

function construirResultado({
  preparadasNegocio,
  genesisPreparadas,
  registradoEnUtc
}) {
  const eventos = preparadasNegocio
    .sort((a, b) => a.indice - b.indice)
    .map((reserva) => Object.freeze({
      eventoId: reserva.eventoIdPersistido || reserva.intencion.eventoId,
      estado: reserva.estadoResultado,
      claveCadena: reserva.claveCadena || reserva.intencion.claveCadena,
      secuencia: reserva.secuencia,
      primeraObservacionUtc: reserva.primeraObservacionUtc
    }));
  const genesis = genesisPreparadas.map((reserva) => Object.freeze({
    eventoId: reserva.eventoIdPersistido || reserva.intencion.eventoId,
    estado: reserva.estadoResultado,
    claveCadena: reserva.claveCadena || reserva.intencion.claveCadena,
    secuencia: reserva.secuencia
  }));
  return Object.freeze({
    registradoEnUtc,
    eventos: Object.freeze(eventos),
    genesis: Object.freeze(genesis)
  });
}

function ordenarReservas(reservas) {
  return [...reservas].sort((a, b) => {
    for (const campo of ['productor', 'claveOperacion', 'rolEvento']) {
      const comparacion = Buffer.compare(
        Buffer.from(a.intencion[campo], 'ascii'),
        Buffer.from(b.intencion[campo], 'ascii')
      );
      if (comparacion !== 0) return comparacion;
    }
    return 0;
  });
}

function compararOrdenIncorporacion(a, b) {
  const ordenRol = { salida: 0, entrada: 1, principal: 2, resultado: 3 };
  if (a.intencion.claveOperacion === b.intencion.claveOperacion) {
    return ordenRol[a.intencion.rolEvento] - ordenRol[b.intencion.rolEvento];
  }
  return a.indice - b.indice;
}

function ordenarBinarioUnico(valores) {
  return [...new Set(valores)].sort((a, b) =>
    Buffer.compare(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii'))
  );
}

function marcadores(valores) {
  return valores.map(() => '?').join(', ');
}

function fechaUtcASql(fecha) {
  return fecha.slice(0, -1).replace('T', ' ');
}

function normalizarFechaSqlTexto(valor) {
  const texto = String(valor);
  const coincidencia = texto.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})\d{3}Z$/
  );
  if (!coincidencia) throw new Error(`Fecha SQL UTC no canónica: ${texto}.`);
  return `${coincidencia[1]}.${coincidencia[2]}Z`;
}

function normalizarFechaSqlEscalar(valor) {
  const texto = String(valor);
  const coincidencia = texto.match(
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.(\d{3})\d{3}$/
  );
  if (!coincidencia) throw new Error(`Escalar DATETIME(3) no canónico: ${texto}.`);
  return `${coincidencia[1]}.${coincidencia[2]}`;
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva la autoridad diagnóstica.
  }
}
