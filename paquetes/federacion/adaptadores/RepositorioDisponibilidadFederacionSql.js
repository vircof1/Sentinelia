import { createHash } from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  validarDeclaracionDisponibilidadFederacion
} from '../src/DisponibilidadFederacion.js';

export class ErrorDisponibilidadFederacionSql extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorDisponibilidadFederacionSql';
    this.codigo = codigo;
  }
}

export class RepositorioDisponibilidadFederacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La disponibilidad federada requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async registrarEnTransaccion(entrada, {
    conexion,
    toleranciaTemporalMs = 5_000
  } = {}) {
    await exigirTransaccion(conexion);
    const declaracion = validarDeclaracionDisponibilidadFederacion(entrada);
    const canonica = canonicalizarJsonFederacion(declaracion);
    const huella = sha256(canonica);
    const destino = await exigirDestino(conexion, declaracion);
    const existente = await obtenerPorId(conexion, declaracion.declaracionId);
    if (existente) {
      if (!Buffer.from(existente.declaracion_sha256).equals(huella)) {
        fallar(
          'declaracion_disponibilidad_divergente',
          'La identidad de declaración ya representa otro contenido.'
        );
      }
      return Object.freeze({
        ...resultadoDeclaracion(existente, true),
        scopeRecepcion: destino.scope
      });
    }
    const ahora = await ahoraSql(conexion);
    if (!Number.isSafeInteger(toleranciaTemporalMs) ||
        toleranciaTemporalMs < 0 || toleranciaTemporalMs > 300_000) {
      fallar(
        'tolerancia_temporal_disponibilidad_invalida',
        'La tolerancia temporal aplicada no pertenece al contrato.'
      );
    }
    if (Date.parse(declaracion.declaradaEnOrigenUtc) >
        new Date(ahora).getTime() + toleranciaTemporalMs) {
      fallar(
        'declaracion_disponibilidad_futura',
        'Una declaración supera la tolerancia temporal máxima del receptor.'
      );
    }
    await conexion.execute(
      `INSERT INTO declaraciones_disponibilidad_federacion (
         declaracion_id,relacion_id,flujo_id,generacion_id,
         installation_declarante_id,familia,tipo,inicio_posicion,fin_posicion,
         causa,rutas_alternativas_agotadas,declaracion_canonica,
         declaracion_sha256,declarada_en_origen_utc,recibida_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        declaracion.declaracionId,declaracion.relacionId,declaracion.flujoId,
        declaracion.generacionId,declaracion.installationDeclaranteId,
        declaracion.familia,declaracion.tipo,declaracion.inicioPosicion,
        declaracion.finPosicion,declaracion.causa,
        declaracion.rutasAlternativasAgotadas,canonica,huella,
        fechaSql(declaracion.declaradaEnOrigenUtc),ahora
      ]
    );
    return Object.freeze({
      ...declaracion,
      yaConocida: false,
      aplicadaCursor: false,
      recibidaEnUtc: new Date(ahora).toISOString(),
      scopeRecepcion: destino.scope
    });
  }

  async evaluarDescarteEnTransaccion({ lote, entrega, candidato } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    if (!candidato) return null;
    const [filas] = await conexion.execute(
      `SELECT e.entrega_id,e.relacion_id,e.flujo_id,e.generacion_id,
              e.posicion_flujo,e.ocurrencia_sha256,e.causa_descarte,
              p.retencion_efectiva_dias,p.version_politica,
              TIMESTAMPADD(DAY,-p.retencion_efectiva_dias,UTC_TIMESTAMP(3))
                AS fecha_corte_utc,
              UTC_TIMESTAMP(3) AS ahora_utc,
              ?<TIMESTAMPADD(DAY,-p.retencion_efectiva_dias,UTC_TIMESTAMP(3))
                AS fuera_retencion,
              (? IS NULL OR ?<=UTC_TIMESTAMP(3)) AS sin_vigencia_operativa
         FROM entregas_recepcion_federacion e
         JOIN politicas_retencion_recepciones_federacion p
           ON p.relacion_id=e.relacion_id AND p.familia=?
        WHERE e.entrega_id=? AND e.relacion_id=? AND e.flujo_id=?
          AND e.generacion_id=? AND e.posicion_flujo=?
        FOR UPDATE`,
      [
        fechaSql(candidato.tiempoEfectivoOrigenUtc),
        candidato.vigenteHastaOrigenUtc === null
          ? null
          : fechaSql(candidato.vigenteHastaOrigenUtc),
        candidato.vigenteHastaOrigenUtc === null
          ? null
          : fechaSql(candidato.vigenteHastaOrigenUtc),
        entrega.ocurrencia.familia,entrega.entregaId,lote.relacionId,
        lote.flujoId,lote.generacionId,entrega.posicionFlujo
      ]
    );
    const fila = filas[0];
    if (!fila || !Boolean(fila.fuera_retencion) ||
        !Boolean(fila.sin_vigencia_operativa)) {
      return null;
    }
    const ocurrencia = entrega.ocurrencia;
    const marcador = canonicalizarJsonFederacion({
      perfil: 'sentinelia-federacion-descarte-retencion-v1',
      version: 1,
      installationOrigenId: ocurrencia.installationOrigenId,
      familia: ocurrencia.familia,
      elementoOrigenId: ocurrencia.elementoOrigenId,
      ocurrenciaOrigenId: ocurrencia.ocurrenciaOrigenId,
      secuenciaElemento: ocurrencia.secuenciaElemento,
      causa: 'retencionReceptor'
    });
    const ahora = fila.ahora_utc;
    let reutilizado = fila.causa_descarte !== null;
    if (fila.causa_descarte === null) {
      let descartePrevio = await obtenerDescartePorOcurrencia(
        conexion,
        lote.relacionId,
        ocurrencia
      );
      if (descartePrevio) {
        if (!esMismaOcurrenciaDescartada(descartePrevio, fila.ocurrencia_sha256)) {
          return resultadoDescarteDivergente();
        }
        reutilizado = true;
      } else {
        try {
          await conexion.execute(
            `INSERT INTO descartes_retencion_recepcion_federacion (
               entrega_id,relacion_id,flujo_id,generacion_id,posicion_flujo,
               installation_origen_id,familia,elemento_origen_id,
               ocurrencia_origen_id,secuencia_elemento,ocurrencia_sha256,
               tiempo_efectivo_origen_utc,politica_dias,version_politica,
               fecha_corte_utc,descartada_en_utc
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              entrega.entregaId,lote.relacionId,lote.flujoId,lote.generacionId,
              entrega.posicionFlujo,ocurrencia.installationOrigenId,
              ocurrencia.familia,ocurrencia.elementoOrigenId,
              ocurrencia.ocurrenciaOrigenId,ocurrencia.secuenciaElemento,
              fila.ocurrencia_sha256,fechaSql(candidato.tiempoEfectivoOrigenUtc),
              String(fila.retencion_efectiva_dias),String(fila.version_politica),
              fila.fecha_corte_utc,ahora
            ]
          );
        } catch (error) {
          if (error?.code !== 'ER_DUP_ENTRY') throw error;
          descartePrevio = await obtenerDescartePorOcurrencia(
            conexion,
            lote.relacionId,
            ocurrencia
          );
          if (!descartePrevio) throw error;
          if (!esMismaOcurrenciaDescartada(descartePrevio, fila.ocurrencia_sha256)) {
            return resultadoDescarteDivergente();
          }
          reutilizado = true;
        }
      }
      const [actualizacion] = await conexion.execute(
        `UPDATE entregas_recepcion_federacion
            SET ocurrencia_canonica=?,causa_descarte='retencionReceptor',
                contenido_descartado_en_utc=?
          WHERE entrega_id=? AND causa_descarte IS NULL`,
        [marcador,ahora,entrega.entregaId]
      );
      if (actualizacion.affectedRows !== 1) {
        fallar(
          'entrega_descarte_retencion_concurrente',
          'La entrega cambió mientras se consolidaba su descarte por retención.'
        );
      }
    }
    return Object.freeze({
      clasificacion: 'terminal',
      resultado: 'descartadaPorRetencion',
      errorTerminal: null,
      errorTemporal: null,
      inboxId: null,
      confirmada: true,
      reutilizado
    });
  }

  async listarParaRelacion({
    relacionId,
    flujoId = null,
    generacionId = null,
    limite = 200
  } = {}) {
    const condiciones = ['relacion_id=?'];
    const parametros = [String(relacionId || '')];
    if (flujoId !== null) {
      condiciones.push('flujo_id=?');
      parametros.push(String(flujoId));
    }
    if (generacionId !== null) {
      condiciones.push('generacion_id=?');
      parametros.push(String(generacionId));
    }
    const cantidad = enteroAcotado(limite, 1, 1000);
    const filas = await this.clienteSql.consultar(
      `SELECT * FROM declaraciones_disponibilidad_federacion
        WHERE ${condiciones.join(' AND ')}
        ORDER BY recibida_en_utc DESC,id DESC LIMIT ${cantidad}`,
      parametros
    );
    return Object.freeze(filas.map(resultadoDeclaracion));
  }
}

async function exigirDestino(conexion, declaracion) {
  const [filas] = await conexion.execute(
    `SELECT f.familia,f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id,
            r.installation_remota_id,r.estado_ciclo,r.estado_autoridad,
            r.estado_identidad,r.estado_compatibilidad
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
       JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
      WHERE f.relacion_id=? AND f.flujo_id=? AND f.direccion='recepcion'
      FOR UPDATE`,
    [declaracion.generacionId,declaracion.relacionId,declaracion.flujoId]
  );
  const fila = filas[0];
  if (!fila || fila.familia !== declaracion.familia ||
      fila.installation_remota_id !== declaracion.installationDeclaranteId ||
      fila.estado_ciclo !== 'vinculada' || fila.estado_autoridad !== 'autorizada' ||
      fila.estado_identidad !== 'valida' ||
      !['compatible','compatibleParcial'].includes(fila.estado_compatibilidad)) {
    fallar(
      'declaracion_disponibilidad_no_autorizada',
      'La relación no autoriza esa declaración para el flujo y generación.'
    );
  }
  return {
    scope: Object.freeze({
      tenantId: decimal(fila.scope_tenant_id),
      empresaId: decimal(fila.scope_empresa_id),
      sitioId: decimal(fila.scope_sitio_id)
    })
  };
}

async function obtenerPorId(conexion, declaracionId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM declaraciones_disponibilidad_federacion
      WHERE declaracion_id=? FOR UPDATE`,
    [declaracionId]
  );
  return filas[0] || null;
}

async function obtenerDescartePorOcurrencia(conexion, relacionId, ocurrencia) {
  const [filas] = await conexion.execute(
    `SELECT entrega_id,ocurrencia_sha256
       FROM descartes_retencion_recepcion_federacion
      WHERE relacion_id=? AND installation_origen_id=? AND familia=?
        AND elemento_origen_id=? AND ocurrencia_origen_id=?
      FOR UPDATE`,
    [
      relacionId,ocurrencia.installationOrigenId,ocurrencia.familia,
      ocurrencia.elementoOrigenId,ocurrencia.ocurrenciaOrigenId
    ]
  );
  return filas[0] || null;
}

function esMismaOcurrenciaDescartada(descarte, huella) {
  return Buffer.from(descarte.ocurrencia_sha256).equals(Buffer.from(huella));
}

function resultadoDescarteDivergente() {
  return Object.freeze({
    clasificacion: 'terminal',
    resultado: 'rechazadaDefinitiva',
    errorTerminal: 'descarteRetencionDivergente',
    errorTemporal: null,
    inboxId: null,
    confirmada: false,
    reutilizado: false
  });
}

function resultadoDeclaracion(fila, yaConocida = false) {
  return Object.freeze({
    declaracionId: fila.declaracion_id,
    relacionId: fila.relacion_id,
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_id,
    installationDeclaranteId: fila.installation_declarante_id,
    familia: fila.familia,
    tipo: fila.tipo,
    inicioPosicion: String(fila.inicio_posicion),
    finPosicion: String(fila.fin_posicion),
    causa: fila.causa,
    rutasAlternativasAgotadas: Boolean(fila.rutas_alternativas_agotadas),
    declaradaEnOrigenUtc: fechaIso(fila.declarada_en_origen_utc),
    recibidaEnUtc: fechaIso(fila.recibida_en_utc),
    aplicadaCursor: fila.aplicada_cursor_en_utc !== null,
    yaConocida
  });
}

function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest();
}

function fechaSql(valor) {
  return String(valor).slice(0, 23).replace('T', ' ').replace('Z', '');
}

function fechaIso(valor) {
  return valor === null || valor === undefined ? null : new Date(valor).toISOString();
}

function decimal(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function enteroAcotado(valor, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    fallar('limite_disponibilidad_invalido', 'El límite de consulta no es válido.');
  }
  return numero;
}

async function exigirTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function' || typeof conexion?.query !== 'function') {
    fallar('transaccion_disponibilidad_ausente', 'La operación exige una conexión prestada.');
  }
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_disponibilidad_inactiva', 'La operación exige una transacción activa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorDisponibilidadFederacionSql(codigo, mensaje);
}
