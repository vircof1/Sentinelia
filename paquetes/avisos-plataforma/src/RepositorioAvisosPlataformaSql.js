import {
  bytesAIdAvisoPlataforma,
  idAvisoPlataformaABytes
} from './IdentidadAvisoPlataforma.js';

const ERRORES_REINTENTABLES = new Set([
  'ER_DUP_ENTRY',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT'
]);

export class RepositorioAvisosPlataformaSql {
  constructor(clienteSql, {
    adaptadorAuditoria,
    capturadorFederacion = null,
    maxReintentos = 3
  } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('RepositorioAvisosPlataformaSql requiere cliente SQL.');
    }
    if (typeof adaptadorAuditoria?.registrarTransicionEnTransaccion !== 'function') {
      throw new Error('El repositorio de avisos requiere adaptador de auditoría.');
    }
    if (capturadorFederacion !== null &&
        typeof capturadorFederacion?.prepararCapturasMutacionEnTransaccion !== 'function') {
      throw new Error('El capturador federado de avisos no es transaccional.');
    }
    if (!Number.isInteger(maxReintentos) || maxReintentos < 0 || maxReintentos > 10) {
      throw new Error('maxReintentos debe estar entre 0 y 10.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
    this.capturadorFederacion = capturadorFederacion;
    this.maxReintentos = maxReintentos;
  }

  async aplicarAtomico({ claveCausalHex, eventoId, tipoSolicitud, decidir }) {
    let intento = 0;
    while (true) {
      const conexion = await this.clienteSql.obtenerConexion();
      try {
        await conexion.beginTransaction();
        const resultado = await this.aplicarEnTransaccion(
          { claveCausalHex, eventoId, tipoSolicitud, decidir }, { conexion }
        );
        await conexion.commit();
        return Object.freeze({ ...resultado, reintentos: intento });
      } catch (error) {
        await rollbackSeguro(conexion);
        if (!ERRORES_REINTENTABLES.has(error?.code) || intento >= this.maxReintentos) {
          throw error;
        }
        intento += 1;
      } finally {
        conexion.release();
      }
    }
  }

  async aplicarEnTransaccion({ claveCausalHex, eventoId, tipoSolicitud, decidir }, { conexion } = {}) {
    if (!conexion?.execute) throw new Error('El aviso transaccional exige conexión prestada.');
    const existente = await buscarResultadoPorEvento(
      conexion,
      eventoId,
      claveCausalHex,
      tipoSolicitud
    );
    if (existente) return existente;
    const ahoraSql = await obtenerAhoraSql(conexion);
    const ciclo = await buscarUltimoCiclo(conexion, Buffer.from(claveCausalHex, 'hex'));
    const decision = await decidir({ ciclo, ahoraSql });
    if (decision.tipo === 'sin_cambios') {
      return Object.freeze({ estado: 'sin_cambios', aviso: ciclo, transicion: null });
    }
    if (decision.tipo === 'insertar') await insertarAviso(conexion, decision.aviso);
    else if (decision.tipo === 'actualizar') await actualizarAviso(conexion, decision.aviso);
    else throw new Error('El servicio devolvió una decisión de aviso desconocida.');
    await insertarHistorico(conexion, decision.historico);
    const evento = await this.adaptadorAuditoria
      .registrarTransicionEnTransaccion(decision.auditoria, { conexion });
    const capturasFederadas = this.capturadorFederacion
      ? await this.capturadorFederacion.prepararCapturasMutacionEnTransaccion({
          avisoId: decision.aviso.avisoId,
          ordinal: decision.historico.ordinal
        }, { conexion })
      : null;
    return Object.freeze({
      estado: decision.resultado,
      aviso: Object.freeze({ ...decision.aviso }),
      transicion: Object.freeze({ ...decision.historico }),
      eventoAuditoria: evento,
      capturasFederadas
    });
  }
}

async function buscarResultadoPorEvento(
  conexion,
  eventoId,
  claveCausalHex,
  tipoSolicitud
) {
  const eventoBytes = idAvisoPlataformaABytes(eventoId, 'eventoId');
  const [filas] = await conexion.execute(
    `SELECT a.*,
            h.ordinal AS ordinal_evento,
            h.transicion_tipo AS transicion_evento,
            (SELECT COALESCE(MAX(h2.ordinal), 0)
             FROM historico_avisos_plataforma h2
             WHERE h2.aviso_id = a.aviso_id) AS ultimo_ordinal
     FROM historico_avisos_plataforma h
     INNER JOIN avisos_plataforma a ON a.aviso_id = h.aviso_id
     WHERE h.evento_auditoria_id = ?
     LIMIT 1
     FOR UPDATE`,
    [eventoBytes]
  );
  if (!filas[0]) return null;
  if (Buffer.from(filas[0].clave_causal).toString('hex') !== claveCausalHex) {
    throw new Error('El eventoId ya pertenece a otra causa de aviso de plataforma.');
  }
  const transicionesAdmitidas = {
    deteccion: new Set(['apertura', 'reapertura', 'confirmacion_tecnica']),
    gravedad: new Set(['escalado', 'desescalado']),
    resolucion: new Set(['resolucion'])
  }[tipoSolicitud];
  if (!transicionesAdmitidas?.has(filas[0].transicion_evento)) {
    throw new Error('El eventoId ya pertenece a otra operación de aviso de plataforma.');
  }
  return Object.freeze({
    estado: 'ya_procesado',
    aviso: proyectarAviso(filas[0]),
    transicion: Object.freeze({
      avisoId: bytesAIdAvisoPlataforma(filas[0].aviso_id),
      ordinal: Number(filas[0].ordinal_evento),
      transicionTipo: filas[0].transicion_evento,
      eventoAuditoriaId: eventoId
    }),
    eventoAuditoria: null
  });
}

async function obtenerAhoraSql(conexion) {
  const [filas] = await conexion.execute(
    `SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora_sql`
  );
  return String(filas[0].ahora_sql).slice(0, 23);
}

async function buscarUltimoCiclo(conexion, claveCausal) {
  const [filas] = await conexion.execute(
    `SELECT a.*,
            (SELECT COALESCE(MAX(h.ordinal), 0)
             FROM historico_avisos_plataforma h
             WHERE h.aviso_id = a.aviso_id) AS ultimo_ordinal
     FROM avisos_plataforma a
     WHERE a.clave_causal = ?
     ORDER BY a.id DESC
     LIMIT 1
     FOR UPDATE`,
    [claveCausal]
  );
  return filas[0] ? proyectarAviso(filas[0]) : null;
}

async function insertarAviso(conexion, aviso) {
  await conexion.execute(
    `INSERT INTO avisos_plataforma (
       aviso_id, version_catalogo, tipo_codigo, causa_codigo, clave_causal,
       estado_ciclo, gravedad, scope_tenant_id, scope_empresa_id, scope_sitio_id,
       objeto_tipo, objeto_id, relacion_id, flujo_id, ciclo_anterior_aviso_id,
       primera_deteccion_utc, ultima_deteccion_utc, contador_detecciones,
       contexto_humano, resumen, correlacion_apertura_id, evento_apertura_id,
       evento_ultima_transicion_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    parametrosAviso(aviso)
  );
}

async function actualizarAviso(conexion, aviso) {
  const [resultado] = await conexion.execute(
    `UPDATE avisos_plataforma
     SET estado_ciclo = ?, gravedad = ?, ultima_deteccion_utc = ?,
         resuelto_en_utc = ?, obsoleto_en_utc = ?, contador_detecciones = ?,
         contexto_humano = ?, resumen = ?, evento_ultima_transicion_id = ?
     WHERE aviso_id = ?`,
    [
      aviso.estadoCiclo,
      aviso.gravedad,
      aviso.ultimaDeteccionUtc,
      aviso.resueltoEnUtc,
      aviso.obsoletoEnUtc,
      aviso.contadorDetecciones,
      JSON.stringify(aviso.contextoHumano),
      JSON.stringify(aviso.resumen),
      idAvisoPlataformaABytes(aviso.eventoUltimaTransicionId, 'eventoUltimaTransicionId'),
      idAvisoPlataformaABytes(aviso.avisoId)
    ]
  );
  if (resultado.affectedRows !== 1) {
    throw new Error('El ciclo de aviso bloqueado dejó de existir.');
  }
}

async function insertarHistorico(conexion, historico) {
  await conexion.execute(
    `INSERT INTO historico_avisos_plataforma (
       aviso_id, ordinal, transicion_tipo, estado_anterior, estado_nuevo,
       gravedad_anterior, gravedad_nueva, contador_detecciones,
       efectivo_en_utc, registrado_en_utc, evento_auditoria_id,
       correlacion_id, detalle, contexto_humano, resumen
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      idAvisoPlataformaABytes(historico.avisoId),
      historico.ordinal,
      historico.transicionTipo,
      historico.estadoAnterior,
      historico.estadoNuevo,
      historico.gravedadAnterior,
      historico.gravedadNueva,
      historico.contadorDetecciones,
      historico.efectivoEnUtc,
      historico.registradoEnUtc,
      idAvisoPlataformaABytes(historico.eventoAuditoriaId, 'eventoAuditoriaId'),
      idAvisoPlataformaABytes(historico.correlacionId, 'correlacionId'),
      JSON.stringify(historico.detalle),
      JSON.stringify(historico.contextoHumano),
      JSON.stringify(historico.resumen)
    ]
  );
}

function parametrosAviso(aviso) {
  return [
    idAvisoPlataformaABytes(aviso.avisoId),
    aviso.versionCatalogo,
    aviso.tipoCodigo,
    aviso.causaCodigo,
    Buffer.from(aviso.claveCausalHex, 'hex'),
    aviso.estadoCiclo,
    aviso.gravedad,
    aviso.scope.tenantId,
    aviso.scope.empresaId,
    aviso.scope.sitioId,
    aviso.objetoTipo,
    aviso.objetoId,
    aviso.relacionId,
    aviso.flujoId,
    aviso.cicloAnteriorId
      ? idAvisoPlataformaABytes(aviso.cicloAnteriorId, 'cicloAnteriorId')
      : null,
    aviso.primeraDeteccionUtc,
    aviso.ultimaDeteccionUtc,
    aviso.contadorDetecciones,
    JSON.stringify(aviso.contextoHumano),
    JSON.stringify(aviso.resumen),
    idAvisoPlataformaABytes(aviso.correlacionAperturaId, 'correlacionAperturaId'),
    idAvisoPlataformaABytes(aviso.eventoAperturaId, 'eventoAperturaId'),
    idAvisoPlataformaABytes(aviso.eventoUltimaTransicionId, 'eventoUltimaTransicionId')
  ];
}

function proyectarAviso(fila) {
  return Object.freeze({
    avisoId: bytesAIdAvisoPlataforma(fila.aviso_id),
    versionCatalogo: Number(fila.version_catalogo),
    tipoCodigo: fila.tipo_codigo,
    causaCodigo: fila.causa_codigo,
    claveCausalHex: Buffer.from(fila.clave_causal).toString('hex'),
    estadoCiclo: fila.estado_ciclo,
    gravedad: fila.gravedad,
    scope: Object.freeze({
      tenantId: decimalONull(fila.scope_tenant_id),
      empresaId: decimalONull(fila.scope_empresa_id),
      sitioId: decimalONull(fila.scope_sitio_id)
    }),
    objetoTipo: fila.objeto_tipo,
    objetoId: fila.objeto_id,
    relacionId: fila.relacion_id,
    flujoId: fila.flujo_id,
    cicloAnteriorId: fila.ciclo_anterior_aviso_id
      ? bytesAIdAvisoPlataforma(fila.ciclo_anterior_aviso_id, 'cicloAnteriorId')
      : null,
    primeraDeteccionUtc: fechaSql(fila.primera_deteccion_utc),
    ultimaDeteccionUtc: fechaSql(fila.ultima_deteccion_utc),
    resueltoEnUtc: fechaSql(fila.resuelto_en_utc),
    obsoletoEnUtc: fechaSql(fila.obsoleto_en_utc),
    contadorDetecciones: Number(fila.contador_detecciones),
    contextoHumano: json(fila.contexto_humano),
    resumen: json(fila.resumen),
    correlacionAperturaId: bytesAIdAvisoPlataforma(
      fila.correlacion_apertura_id,
      'correlacionAperturaId'
    ),
    eventoAperturaId: bytesAIdAvisoPlataforma(fila.evento_apertura_id, 'eventoAperturaId'),
    eventoUltimaTransicionId: bytesAIdAvisoPlataforma(
      fila.evento_ultima_transicion_id,
      'eventoUltimaTransicionId'
    ),
    ultimoOrdinal: Number(fila.ultimo_ordinal)
  });
}

function json(valor) {
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
}

function decimalONull(valor) {
  return valor == null ? null : String(valor);
}

function fechaSql(valor) {
  if (valor == null) return null;
  if (valor instanceof Date) return valor.toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
  return String(valor).replace('T', ' ').replace('Z', '').slice(0, 23);
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // Conserva el error causal original.
  }
}
