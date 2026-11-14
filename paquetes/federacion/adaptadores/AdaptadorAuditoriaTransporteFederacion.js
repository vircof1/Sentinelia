import { Buffer } from 'node:buffer';

import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

const RESULTADOS_ACEPTADOS = new Set([
  'aceptada', 'yaConocida', 'retiradaAceptada', 'salidaAceptada'
]);

export class AdaptadorAuditoriaTransporteFederacion {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('El testimonio de transporte exige auditoría transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async registrarRecepcionEnTransaccion(
    { preparacion, resultadoDurable } = {},
    { conexion } = {}
  ) {
    if (!conexion?.execute) {
      throw new Error('El testimonio de recepción exige una conexión prestada.');
    }
    if (preparacion?.clase === 'replayTerminal') {
      return Object.freeze({ estado: 'omitido', causa: 'replayTerminalExacto' });
    }
    const lote = preparacion?.lote;
    if (!lote || resultadoDurable?.loteId !== lote.loteId ||
        resultadoDurable?.numeroIntento !== preparacion.numeroIntento) {
      throw new Error('El resultado durable no corresponde al intento testimoniado.');
    }
    const entregasTestimoniadas = seleccionarEntregasTestimoniadas(
      lote,
      resultadoDurable.resultados
    );
    if (entregasTestimoniadas.length === 0) {
      return Object.freeze({ estado: 'omitido', causa: 'sinTrabajoNuevo' });
    }
    const contexto = await obtenerContextoRecepcion(conexion, lote);
    const ahora = await ahoraSql(conexion);
    const eventoId = generarUuidV7Auditoria();
    const conteos = resumirResultados(entregasTestimoniadas);
    const rango = calcularRango(entregasTestimoniadas.map(({ entrega }) => entrega));
    const intencion = {
      eventoId,
      tipo: 'federacion.lote_recibido',
      versionContrato: 2,
      flujo: 'federacion',
      claveCadena: construirClaveCadenaAuditoria({
        flujo: 'federacion', tenantId: contexto.scope.tenantId
      }),
      actorReal: {
        tipo: 'instancia_remota', id: contexto.installationRemotaId
      },
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: { tipo: 'lote_federado', id: lote.loteId },
      origen: 'api_federacion',
      scope: contexto.scope,
      correlacionId: eventoId,
      causalidad: { tipo: 'relacion_federacion', id: lote.relacionId },
      productor: 'api_federacion',
      claveOperacion: `recepcion-lote:v1:${lote.loteId}:${preparacion.numeroIntento}`,
      rolEvento: 'principal',
      efectivoEnUtc: normalizarFecha(ahora),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        direccion: 'recepcion',
        resultado: 'persistido',
        generacionId: lote.generacionId,
        loteId: lote.loteId,
        rango,
        conteos,
        codigo: null
      }
    };
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion(
      [intencion],
      { conexion }
    );
    if (resultado?.eventos?.length !== 1 ||
        resultado.eventos[0]?.estado !== 'incorporado') {
      throw new Error('El testimonio consolidado no quedó incorporado en auditoría.');
    }
    return Object.freeze({
      estado: 'incorporado',
      eventoId,
      loteId: lote.loteId,
      numeroIntento: preparacion.numeroIntento,
      rango,
      conteos
    });
  }
}

async function obtenerContextoRecepcion(conexion, lote) {
  const [filas] = await conexion.execute(
    `SELECT r.installation_remota_id,
            f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id
       FROM flujos_federacion f
       JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
      WHERE f.flujo_id=? AND f.relacion_id=? AND f.direccion='recepcion'
      FOR UPDATE`,
    [lote.generacionId, lote.flujoId, lote.relacionId]
  );
  const fila = filas[0];
  if (!fila?.installation_remota_id) {
    throw new Error('El lote no posee una contraparte receptora confirmada.');
  }
  return Object.freeze({
    installationRemotaId: fila.installation_remota_id,
    scope: Object.freeze({
      tenantId: decimalOpcional(fila.scope_tenant_id),
      empresaId: decimalOpcional(fila.scope_empresa_id),
      sitioId: decimalOpcional(fila.scope_sitio_id)
    })
  });
}

function seleccionarEntregasTestimoniadas(lote, resultados) {
  if (!Array.isArray(resultados) || resultados.length !== lote.entregas.length) {
    throw new Error('El testimonio exige un resultado por cada entrega del lote.');
  }
  return lote.entregas
    .map((entrega, indice) => Object.freeze({ entrega, resultado: resultados[indice] }))
    .filter(({ resultado }) => resultado.reutilizado !== true);
}

function resumirResultados(entregasTestimoniadas) {
  let aceptadas = 0n;
  let rechazadas = 0n;
  for (const { resultado } of entregasTestimoniadas) {
    if (resultado.clasificacion !== 'terminal') continue;
    if (RESULTADOS_ACEPTADOS.has(resultado.resultado)) aceptadas += 1n;
    else rechazadas += 1n;
  }
  const bytes = entregasTestimoniadas.reduce((total, { entrega }) => total + BigInt(
    Buffer.byteLength(
      entrega.ocurrenciaPersistibleCanonica ?? entrega.ocurrenciaCanonica,
      'utf8'
    )
  ), 0n);
  return Object.freeze({
    ocurrencias: String(entregasTestimoniadas.length),
    aceptadas: String(aceptadas),
    rechazadas: String(rechazadas),
    bytes: String(bytes)
  });
}

function calcularRango(entregas) {
  const posiciones = entregas.map(({ posicionFlujo }) => BigInt(posicionFlujo));
  return Object.freeze({
    desde: String(posiciones.reduce((menor, actual) => actual < menor ? actual : menor)),
    hasta: String(posiciones.reduce((mayor, actual) => actual > mayor ? actual : mayor))
  });
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function normalizarFecha(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor || '');
  const sql = texto.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})\d{0,3}$/u
  );
  return sql ? `${sql[1]}T${sql[2]}.${sql[3]}Z` : texto;
}

function decimalOpcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}
