import { createHash } from 'node:crypto';

import { crearLoteRecepcionFederacion } from '../src/LoteRecepcionFederacion.js';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { crearOcurrenciaOrigenFederada } from '../src/EnvolventeFederacion.js';
import {
  ERRORES_TEMPORALES_FEDERACION,
  ERRORES_TERMINALES_FEDERACION,
  RESULTADOS_OCURRENCIA_FEDERACION
} from '../src/CatalogosFederacion.js';
import { normalizarConfiguracionFederacion } from '../src/ConfiguracionFederacion.js';
import { separarContenidoSensibleFederacion } from '../src/SeparacionContenidoSensibleFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

export class ErrorEntregasFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorEntregasFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioEntregasFederacionSql {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Las entregas federadas requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async esReplayTerminalExacto(entrada) {
    const lote = incorporarHuellas(crearLoteRecepcionFederacion(entrada));
    const filas = await this.clienteSql.consultar(
      `SELECT l.relacion_id,l.flujo_id,l.generacion_id,l.composicion_sha256,
              l.total_entregas,
              COUNT(DISTINCT CASE WHEN r.clasificacion='terminal'
                THEN r.entrega_id END) AS total_terminales
         FROM lotes_recepcion_federacion l
         LEFT JOIN intentos_lotes_recepcion_federacion i ON i.lote_id=l.lote_id
         LEFT JOIN resultados_entregas_recepcion_federacion r ON r.intento_id=i.id
        WHERE l.lote_id=?
        GROUP BY l.id`,
      [lote.loteId]
    );
    const fila = filas[0];
    return Boolean(fila &&
      fila.relacion_id === lote.relacionId &&
      fila.flujo_id === lote.flujoId &&
      fila.generacion_id === lote.generacionId &&
      Number(fila.total_entregas) === lote.entregas.length &&
      Number(fila.total_terminales) === lote.entregas.length &&
      Buffer.from(fila.composicion_sha256).equals(lote.composicionSha256));
  }

  async prepararIntentoEnTransaccion(entrada, { conexion, capacidad = null } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const lote = incorporarHuellas(crearLoteRecepcionFederacion(entrada));
    const destino = await exigirDestinoEstructural(conexion, lote);
    const capacidadNormalizada = normalizarCapacidad(capacidad);
    const ahora = await ahoraSql(conexion);
    let nuevo = false;
    try {
      await conexion.execute(
        `INSERT INTO lotes_recepcion_federacion (
           lote_id,relacion_id,flujo_id,generacion_id,composicion_sha256,
           total_entregas,estado,total_intentos,creado_en_utc,actualizado_en_utc
         ) VALUES (?,?,?,?,?,?,'pendiente',0,?,?)`,
        [
          lote.loteId,
          lote.relacionId,
          lote.flujoId,
          lote.generacionId,
          lote.composicionSha256,
          lote.entregas.length,
          ahora,
          ahora
        ]
      );
      nuevo = true;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
    }
    const filaLote = await bloquearLote(conexion, lote.loteId);
    if (!filaLote) {
      throw new ErrorEntregasFederacion(
        'lote_no_persistido',
        'El lote no quedó disponible después de reservar su identidad.'
      );
    }
    exigirMismaComposicion(filaLote, lote);
    if (nuevo) {
      for (const entrega of lote.entregas) {
        let entregaNueva = false;
        try {
          await conexion.execute(
            `INSERT INTO entregas_recepcion_federacion (
               entrega_id,relacion_id,flujo_id,generacion_id,posicion_flujo,
               ocurrencia_canonica,ocurrencia_sha256,creada_en_utc
             ) VALUES (?,?,?,?,?,?,?,?)`,
            [
              entrega.entregaId,
              lote.relacionId,
              lote.flujoId,
              lote.generacionId,
              entrega.posicionFlujo,
              entrega.ocurrenciaPersistibleCanonica,
              entrega.ocurrenciaSha256,
              ahora
            ]
          );
          entregaNueva = true;
        } catch (error) {
          if (error?.code !== 'ER_DUP_ENTRY') throw error;
        }
        if (!entregaNueva) {
          await exigirEntregaPersistida(conexion, lote, entrega);
        }
        await conexion.execute(
          `INSERT INTO composiciones_lotes_recepcion_federacion (
             lote_id,ordinal_lote,entrega_id
           ) VALUES (?,?,?)`,
          [
            lote.loteId,
            entrega.ordinalLote,
            entrega.entregaId
          ]
        );
      }
    } else {
      await exigirEntregasPersistidas(conexion, lote);
    }
    const terminalesPrevios = await obtenerTerminalesPrevios(conexion, lote);
    const numeroIntento = BigInt(filaLote.total_intentos) + 1n;
    const replayCompleto = terminalesPrevios.size === lote.entregas.length;
    if (!replayCompleto) {
      exigirDestinoOperativo(destino, lote);
      exigirContratoCapacidad(destino, capacidadNormalizada);
    }
    const entregasExcedidas = replayCompleto
      ? Object.freeze([])
      : evaluarLimitesLote(lote, capacidadNormalizada);
    const clase = nuevo
      ? 'inicial'
      : replayCompleto
        ? 'replayTerminal'
        : 'reintento';
    return Object.freeze({
      lote,
      numeroIntento: numeroIntento.toString(),
      clase,
      capacidad: capacidadNormalizada,
      entregasExcedidas,
      terminalesPrevios
    });
  }

  async guardarIntentoEnTransaccion(preparacion, resultados, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    if (!Array.isArray(resultados) ||
        resultados.length !== preparacion.lote.entregas.length) {
      throw new ErrorEntregasFederacion(
        'resultados_incompletos',
        'Cada entrega del lote debe producir exactamente un resultado durable.'
      );
    }
    const resultadosNormalizados = resultados.map((resultado, indice) =>
      normalizarResultado(resultado, preparacion.lote.entregas[indice].ocurrencia));
    const ahora = await ahoraSql(conexion);
    const totalTerminales = resultadosNormalizados.filter(
      (resultado) => resultado.clasificacion === 'terminal'
    ).length;
    const totalTemporales = resultadosNormalizados.length - totalTerminales;
    const [insercion] = await conexion.execute(
      `INSERT INTO intentos_lotes_recepcion_federacion (
         lote_id,numero_intento,clase,total_terminales,total_temporales,creado_en_utc
       ) VALUES (?,?,?,?,?,?)`,
      [
        preparacion.lote.loteId,
        preparacion.numeroIntento,
        preparacion.clase,
        totalTerminales,
        totalTemporales,
        ahora
      ]
    );
    const intentoId = String(insercion.insertId);
    const resultadosPersistidos = [];
    for (let indice = 0; indice < resultadosNormalizados.length; indice += 1) {
      const resultado = resultadosNormalizados[indice];
      const entrega = preparacion.lote.entregas[indice];
      const [insercionResultado] = await conexion.execute(
        `INSERT INTO resultados_entregas_recepcion_federacion (
           intento_id,lote_id,entrega_id,clasificacion,resultado,error_terminal,
           error_temporal,inbox_ocurrencia_id,confirmada,reutilizado,creado_en_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          intentoId,
          preparacion.lote.loteId,
          entrega.entregaId,
          resultado.clasificacion,
          resultado.resultado,
          resultado.errorTerminal,
          resultado.errorTemporal,
          resultado.inboxId,
          resultado.confirmada,
          resultado.reutilizado,
          ahora
        ]
      );
      resultadosPersistidos.push(Object.freeze({
        ...resultado,
        resultadoId: String(insercionResultado.insertId)
      }));
    }
    const estado = totalTemporales === 0 ? 'terminal' : 'parcialTemporal';
    const [actualizacion] = await conexion.execute(
      `UPDATE lotes_recepcion_federacion
          SET estado=?,total_intentos=?,actualizado_en_utc=?
        WHERE lote_id=? AND total_intentos=?`,
      [
        estado,
        preparacion.numeroIntento,
        ahora,
        preparacion.lote.loteId,
        (BigInt(preparacion.numeroIntento) - 1n).toString()
      ]
    );
    if (actualizacion.affectedRows !== 1) {
      throw new ErrorEntregasFederacion(
        'intento_concurrente',
        'Otro receptor avanzó el mismo lote fuera del bloqueo esperado.'
      );
    }
    return Object.freeze({
      loteId: preparacion.lote.loteId,
      intentoId,
      numeroIntento: preparacion.numeroIntento,
      clase: preparacion.clase,
      estado,
      resultados: Object.freeze(resultadosPersistidos.map((resultado, indice) => Object.freeze({
        entregaId: preparacion.lote.entregas[indice].entregaId,
        posicionFlujo: preparacion.lote.entregas[indice].posicionFlujo,
        ...resultado
      })))
    });
  }
}

async function exigirDestinoEstructural(conexion, lote) {
  const [filas] = await conexion.execute(
    `SELECT f.relacion_id,f.direccion,f.familia,f.version_familia,
            f.generacion_activa_id,
            r.estado_ciclo,r.estado_autoridad,r.estado_identidad,
            r.estado_compatibilidad
       FROM flujos_federacion f
       JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
      WHERE f.flujo_id=? FOR UPDATE`,
    [lote.generacionId, lote.flujoId]
  );
  const fila = filas[0];
  if (!fila || fila.relacion_id !== lote.relacionId ||
      fila.direccion !== 'recepcion') {
    throw new ErrorEntregasFederacion(
      'destino_lote_incompatible',
      'El lote no pertenece a la relación, flujo y generación receptores activos.'
    );
  }
  for (const entrega of lote.entregas) {
    const familia = entrega.ocurrencia?.familia;
    const version = entrega.ocurrencia?.familiaVersion;
    // Una ocurrencia estructuralmente inválida obtiene su resultado individual.
    // Si declara un contrato reconocible, en cambio, no puede cruzar por un
    // flujo perteneciente a otra familia o versión.
    if (typeof familia === 'string' && Number.isSafeInteger(version) &&
        (familia !== fila.familia || version !== Number(fila.version_familia))) {
      throw new ErrorEntregasFederacion(
        'contrato_lote_incompatible',
        'El lote declara una familia o versión distinta del contrato del flujo.'
      );
    }
  }
  return Object.freeze({
    familia: fila.familia,
    versionFamilia: Number(fila.version_familia),
    generacionActivaId: fila.generacion_activa_id,
    estadoCiclo: fila.estado_ciclo,
    estadoAutoridad: fila.estado_autoridad,
    estadoIdentidad: fila.estado_identidad,
    estadoCompatibilidad: fila.estado_compatibilidad
  });
}

function exigirDestinoOperativo(destino, lote) {
  if (destino.generacionActivaId !== lote.generacionId ||
      destino.estadoCiclo !== 'vinculada' ||
      destino.estadoAutoridad !== 'autorizada' ||
      destino.estadoIdentidad !== 'valida' ||
      !['compatible', 'compatibleParcial'].includes(destino.estadoCompatibilidad)) {
    throw new ErrorEntregasFederacion(
      'relacion_recepcion_no_operativa',
      'La relación ya no admite incorporar nuevas entregas federadas.'
    );
  }
}

function normalizarCapacidad(entrada = null) {
  const configuracion = normalizarConfiguracionFederacion({
    ...(entrada?.configuracion ?? {}),
    ...(entrada?.maximoOcurrenciasPorLote === undefined
      ? {}
      : { loteMaximoOcurrencias: entrada.maximoOcurrenciasPorLote }),
    ...(entrada?.maximoBytesPorLote === undefined
      ? {}
      : { loteMaximoBytes: entrada.maximoBytesPorLote }),
    ...(entrada?.maximoBytesPorOcurrencia === undefined
      ? {}
      : { ocurrenciaMaximaBytes: entrada.maximoBytesPorOcurrencia }),
    ...(entrada?.capacidadTemporalOcurrencias === undefined
      ? {}
      : { capacidadReceptoraOcurrencias: entrada.capacidadTemporalOcurrencias })
  });
  const versionConfiguracion = decimalNoNegativo(
    entrada?.versionConfiguracion ?? '0',
    'versionConfiguracion'
  );
  const disponible = entrada?.disponible ?? true;
  if (typeof disponible !== 'boolean') {
    throw new ErrorEntregasFederacion(
      'capacidad_invalida',
      'La disponibilidad receptora debe ser booleana.'
    );
  }
  const familiasSoportadas = entrada?.familiasSoportadas ?? null;
  const versionesFamilia = entrada?.versionesFamilia ?? null;
  if (familiasSoportadas !== null && !Array.isArray(familiasSoportadas)) {
    throw new ErrorEntregasFederacion(
      'capacidad_invalida',
      'Las familias soportadas deben ser una lista.'
    );
  }
  return Object.freeze({
    versionConfiguracion,
    disponible,
    familiasSoportadas: familiasSoportadas === null
      ? null
      : Object.freeze([...familiasSoportadas]),
    versionesFamilia: versionesFamilia === null
      ? null
      : Object.freeze({ ...versionesFamilia }),
    maximoOcurrenciasPorLote: configuracion.loteMaximoOcurrencias,
    maximoBytesPorLote: configuracion.loteMaximoBytes,
    maximoBytesPorOcurrencia: configuracion.ocurrenciaMaximaBytes,
    capacidadTemporalOcurrencias: configuracion.capacidadReceptoraOcurrencias
  });
}

function exigirContratoCapacidad(destino, capacidad) {
  if (capacidad.familiasSoportadas !== null &&
      !capacidad.familiasSoportadas.includes(destino.familia)) {
    throw new ErrorEntregasFederacion(
      'familia_no_admitida_actualmente',
      'La capacidad vigente no admite la familia del flujo.'
    );
  }
  if (capacidad.versionesFamilia !== null &&
      capacidad.versionesFamilia[destino.familia] !== destino.versionFamilia) {
    throw new ErrorEntregasFederacion(
      'version_familia_no_admitida_actualmente',
      'La capacidad vigente no admite la versión contractual del flujo.'
    );
  }
}

function evaluarLimitesLote(lote, capacidad) {
  if (lote.entregas.length > capacidad.maximoOcurrenciasPorLote) {
    throw errorLimiteLote(
      'El lote supera el número de ocurrencias admitido actualmente.',
      capacidad
    );
  }
  let bytesLote = 2;
  const excedidas = [];
  for (const entrega of lote.entregas) {
    const bytes = Buffer.byteLength(entrega.ocurrenciaCanonica, 'utf8') +
      (entrega.procedenciaCanonica === null
        ? 0
        : Buffer.byteLength(entrega.procedenciaCanonica, 'utf8'));
    bytesLote += bytes + (entrega.ordinalLote === 1 ? 0 : 1);
    if (bytes > capacidad.maximoBytesPorOcurrencia) {
      excedidas.push(entrega.entregaId);
    }
  }
  if (bytesLote > capacidad.maximoBytesPorLote) {
    throw errorLimiteLote(
      'El lote supera los bytes admitidos actualmente y debe reagruparse.',
      capacidad
    );
  }
  return Object.freeze(excedidas);
}

function errorLimiteLote(mensaje, capacidad) {
  const error = new ErrorEntregasFederacion('lote_excede_limites', mensaje);
  error.capacidad = capacidad;
  return error;
}

const RESULTADOS_ACEPTADOS = new Set([
  'aceptada',
  'yaConocida',
  'retiradaAceptada',
  'salidaAceptada'
]);

function normalizarResultado(resultado = {}, ocurrencia = {}) {
  const clasificacion = resultado.clasificacion;
  const codigo = RESULTADOS_OCURRENCIA_FEDERACION.exigir(resultado.resultado, {
    campo: 'resultado'
  });
  if (typeof resultado.confirmada !== 'boolean' ||
      typeof resultado.reutilizado !== 'boolean') {
    throw resultadoInvalido('Confirmación y reutilización deben ser booleanas.');
  }
  const inboxId = resultado.inboxId === null
    ? null
    : decimalPositivo(resultado.inboxId, 'inboxId');
  if (clasificacion === 'temporal') {
    if (!['aplazadaCapacidad', 'aplazadaValidacion'].includes(codigo) ||
        resultado.errorTerminal !== null || inboxId !== null ||
        resultado.confirmada || resultado.reutilizado) {
      throw resultadoInvalido('Un resultado temporal no puede confirmar ni terminalizar.');
    }
    return Object.freeze({
      clasificacion,
      resultado: codigo,
      errorTerminal: null,
      errorTemporal: ERRORES_TEMPORALES_FEDERACION.exigir(
        resultado.errorTemporal,
        { campo: 'errorTemporal' }
      ),
      inboxId: null,
      confirmada: false,
      reutilizado: resultado.reutilizado
    });
  }
  if (clasificacion !== 'terminal' || resultado.errorTemporal !== null) {
    throw resultadoInvalido('La clasificación del resultado no es coherente.');
  }
  if (RESULTADOS_ACEPTADOS.has(codigo)) {
    if (resultado.errorTerminal !== null || inboxId === null || !resultado.confirmada) {
      throw resultadoInvalido('Una aceptación terminal exige inbox y confirmación.');
    }
    if ((codigo === 'aceptada' && ocurrencia.operacion !== 'actualizacion') ||
        (codigo === 'retiradaAceptada' && ocurrencia.operacion !== 'retirada') ||
        (codigo === 'salidaAceptada' && ocurrencia.operacion !== 'salidaProyeccion')) {
      throw resultadoInvalido('La aceptación no coincide con la operación recibida.');
    }
  } else if (codigo === 'descartadaPorRetencion') {
    if (resultado.errorTerminal !== null || inboxId !== null ||
        !resultado.confirmada || ocurrencia.operacion !== 'actualizacion') {
      throw resultadoInvalido(
        'Un descarte por retención confirma una actualización sin inbox ni error.'
      );
    }
  } else if (codigo === 'divergente') {
    if (resultado.errorTerminal !== 'divergenciaContenido' ||
        inboxId === null || resultado.confirmada) {
      throw resultadoInvalido('Una divergencia terminal exige su evidencia inbox sin ACK.');
    }
  } else if (codigo === 'rechazadaDefinitiva') {
    const errorTerminal = ERRORES_TERMINALES_FEDERACION.exigir(resultado.errorTerminal, {
      campo: 'errorTerminal'
    });
    if (errorTerminal === 'divergenciaContenido' || resultado.confirmada) {
      throw resultadoInvalido('Un rechazo definitivo no confirma la ocurrencia.');
    }
  } else {
    throw resultadoInvalido('El resultado no pertenece a su clasificación terminal.');
  }
  return Object.freeze({
    clasificacion,
    resultado: codigo,
    errorTerminal: resultado.errorTerminal,
    errorTemporal: null,
    inboxId,
    confirmada: resultado.confirmada,
    reutilizado: resultado.reutilizado
  });
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw resultadoInvalido(`${campo} debe ser un entero decimal positivo.`);
  }
  return texto;
}

function decimalNoNegativo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) {
    throw new ErrorEntregasFederacion(
      'capacidad_invalida',
      `${campo} debe ser un entero decimal no negativo.`
    );
  }
  return texto;
}

function resultadoInvalido(mensaje) {
  return new ErrorEntregasFederacion('resultado_entrega_invalido', mensaje);
}

function incorporarHuellas(loteBase) {
  const entregas = loteBase.entregas.map((entrega) => {
    const separacion = separarContenidoSensibleFederacion(entrega.ocurrencia);
    const canonicoPublico = canonicalizarJsonFederacion(separacion.publico);
    const ocurrenciaOriginalSha256 = calcularHuellaOriginalNormalizada(
      entrega.ocurrencia
    );
    return Object.freeze({
      ...entrega,
      ocurrenciaPersistibleCanonica: canonicoPublico,
      ocurrenciaSha256: sha256(canonicoPublico),
      ocurrenciaOriginalSha256,
      tieneContenidoSensible: Boolean(separacion.contenidoSensible)
    });
  });
  const composicionCanonica = canonicalizarJsonFederacion(entregas.map((entrega) => ({
    entregaId: entrega.entregaId,
    posicionFlujo: entrega.posicionFlujo,
    ocurrenciaSha256: entrega.ocurrenciaSha256.toString('hex'),
    procedencia: entrega.procedencia
  })));
  return Object.freeze({
    ...loteBase,
    composicionSha256: sha256(canonicalizarJsonFederacion({
      revisionConcesionEfectiva: loteBase.revisionConcesionEfectiva,
      entregas: JSON.parse(composicionCanonica)
    })),
    entregas: Object.freeze(entregas)
  });
}

function calcularHuellaOriginalNormalizada(ocurrencia) {
  try {
    return sha256(crearOcurrenciaOrigenFederada({
      ...ocurrencia,
      installationOrigenId: crearIdentidadFederada({
        tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
        valor: String(ocurrencia.installationOrigenId ?? '')
      }),
      elementoOrigenId: crearIdentidadFederada({
        tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
        valor: String(ocurrencia.elementoOrigenId ?? '')
      }),
      ocurrenciaOrigenId: crearIdentidadFederada({
        tipo: TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
        valor: String(ocurrencia.ocurrenciaOrigenId ?? '')
      })
    }).canonicalizar());
  } catch {
    // La validación individual de inbox conserva la autoridad sobre entradas
    // inválidas; preparar el lote no debe convertirlas en fallo global.
    return null;
  }
}

function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest();
}

async function bloquearLote(conexion, loteId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM lotes_recepcion_federacion WHERE lote_id=? FOR UPDATE',
    [loteId]
  );
  return filas[0] || null;
}

function exigirMismaComposicion(fila, lote) {
  if (fila.relacion_id !== lote.relacionId ||
      fila.flujo_id !== lote.flujoId ||
      fila.generacion_id !== lote.generacionId ||
      Number(fila.total_entregas) !== lote.entregas.length ||
      !Buffer.from(fila.composicion_sha256).equals(lote.composicionSha256)) {
    throw new ErrorEntregasFederacion(
      'lote_id_reutilizado',
      'El loteId ya identifica otra composición y no puede reinterpretarse.'
    );
  }
}

async function exigirEntregasPersistidas(conexion, lote) {
  const [filas] = await conexion.execute(
    `SELECT e.entrega_id,c.ordinal_lote,e.posicion_flujo,
            e.ocurrencia_canonica,e.ocurrencia_sha256,e.causa_descarte,
            e.relacion_id,e.flujo_id,e.generacion_id
       FROM composiciones_lotes_recepcion_federacion c
       JOIN entregas_recepcion_federacion e ON e.entrega_id=c.entrega_id
      WHERE c.lote_id=? ORDER BY c.ordinal_lote FOR UPDATE`,
    [lote.loteId]
  );
  if (filas.length !== lote.entregas.length) {
    throw new ErrorEntregasFederacion(
      'lote_persistido_incompleto',
      'La composición durable del lote está incompleta.'
    );
  }
  for (let indice = 0; indice < filas.length; indice += 1) {
    const fila = filas[indice];
    const entrega = lote.entregas[indice];
    if (fila.entrega_id !== entrega.entregaId ||
        Number(fila.ordinal_lote) !== entrega.ordinalLote ||
        fila.relacion_id !== lote.relacionId ||
        fila.flujo_id !== lote.flujoId ||
        fila.generacion_id !== lote.generacionId ||
        String(fila.posicion_flujo) !== entrega.posicionFlujo ||
        !contenidoEntregaCompatible(fila, entrega) ||
        !Buffer.from(fila.ocurrencia_sha256).equals(entrega.ocurrenciaSha256)) {
      throw new ErrorEntregasFederacion(
        'lote_persistido_divergente',
        'Las entregas durables no coinciden con la composición del lote.'
      );
    }
  }
}

async function exigirEntregaPersistida(conexion, lote, entrega) {
  const [filas] = await conexion.execute(
    `SELECT relacion_id,flujo_id,generacion_id,posicion_flujo,
            ocurrencia_canonica,ocurrencia_sha256,causa_descarte
       FROM entregas_recepcion_federacion
      WHERE entrega_id=? FOR UPDATE`,
    [entrega.entregaId]
  );
  const fila = filas[0];
  if (!fila || fila.relacion_id !== lote.relacionId ||
      fila.flujo_id !== lote.flujoId ||
      fila.generacion_id !== lote.generacionId ||
      String(fila.posicion_flujo) !== entrega.posicionFlujo ||
      !contenidoEntregaCompatible(fila, entrega) ||
      !Buffer.from(fila.ocurrencia_sha256).equals(entrega.ocurrenciaSha256)) {
    throw new ErrorEntregasFederacion(
      'entrega_id_reutilizado',
      'El entregaId ya representa otro contenido o destino inmediato.'
    );
  }
}

function contenidoEntregaCompatible(fila, entrega) {
  return fila.ocurrencia_canonica === entrega.ocurrenciaPersistibleCanonica ||
    (
      fila.causa_descarte === 'retencionReceptor' &&
      Buffer.from(fila.ocurrencia_sha256).equals(entrega.ocurrenciaSha256)
    );
}

async function obtenerTerminalesPrevios(conexion, lote) {
  const [filas] = await conexion.execute(
    `SELECT r.entrega_id,r.clasificacion,r.resultado,r.error_terminal,
            r.error_temporal,r.inbox_ocurrencia_id,r.confirmada,
            s.contenido_sha256 AS ocurrencia_original_sha256
       FROM resultados_entregas_recepcion_federacion r
       JOIN intentos_lotes_recepcion_federacion i ON i.id=r.intento_id
       LEFT JOIN secretos_inbox_federacion s
         ON s.inbox_ocurrencia_id=r.inbox_ocurrencia_id
      WHERE i.lote_id=? AND r.clasificacion='terminal'
      ORDER BY r.id DESC`,
    [lote.loteId]
  );
  const entregas = new Map(lote.entregas.map((entrega) => [entrega.entregaId, entrega]));
  const resultados = new Map();
  for (const fila of filas) {
    if (resultados.has(fila.entrega_id)) continue;
    const entrega = entregas.get(fila.entrega_id);
    if (entrega?.tieneContenidoSensible && entrega.ocurrenciaOriginalSha256 !== null &&
        fila.ocurrencia_original_sha256 !== null &&
        !Buffer.from(fila.ocurrencia_original_sha256)
          .equals(entrega.ocurrenciaOriginalSha256)) {
      throw new ErrorEntregasFederacion(
        'replay_terminal_sensible_divergente',
        'El replay terminal altera contenido sensible todavía custodiado.'
      );
    }
    resultados.set(fila.entrega_id, Object.freeze({
      clasificacion: 'terminal',
      resultado: fila.resultado,
      errorTerminal: fila.error_terminal,
      errorTemporal: null,
      inboxId: fila.inbox_ocurrencia_id === null
        ? null
        : String(fila.inbox_ocurrencia_id),
      confirmada: Boolean(fila.confirmada),
      reutilizado: true
    }));
  }
  return resultados;
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new ErrorEntregasFederacion(
      'transaccion_prestada_ausente',
      'El lote exige una conexión SQL prestada.'
    );
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new ErrorEntregasFederacion(
      'transaccion_prestada_inactiva',
      'El lote solo puede incorporarse dentro de una transacción activa.'
    );
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}
