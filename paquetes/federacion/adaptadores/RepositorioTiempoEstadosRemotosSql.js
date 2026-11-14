import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

export class RepositorioTiempoEstadosRemotosSql {
  constructor(clienteSql, {
    generarTransicionId = generarUuidV7Auditoria,
    adaptadorAuditoria = null
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El tiempo de estados remotos requiere SQL operativo.');
    }
    if (typeof generarTransicionId !== 'function') {
      throw new Error('El tiempo de estados remotos requiere identidades UUIDv7.');
    }
    if (adaptadorAuditoria !== null && (
      typeof adaptadorAuditoria?.registrarCicloEnTransaccion !== 'function' ||
      typeof adaptadorAuditoria?.registrarEstadoEnTransaccion !== 'function'
    )) {
      throw new Error('El adaptador de auditoría temporal no es válido.');
    }
    this.clienteSql = clienteSql;
    this.generarTransicionId = generarTransicionId;
    this.adaptadorAuditoria = adaptadorAuditoria;
  }

  async iniciarConsolidacion({ bootId, duracionMs } = {}) {
    const boot = identidad(bootId, TIPOS_IDENTIDAD_FEDERADA.ARRANQUE, 'bootId');
    const duracion = entero(duracionMs, 0, 3_600_000, 'duracionMs');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [existentes] = await conexion.execute(
        `SELECT * FROM ciclos_consolidacion_estados_remotos
          WHERE boot_id=? FOR UPDATE`,
        [boot]
      );
      if (!existentes[0]) {
        const ahora = await ahoraSql(conexion);
        const limite = new Date(ahora.getTime() + duracion);
        const eventoId = uuidV7(this.generarTransicionId(), 'eventoInicioId');
        await conexion.execute(
          `INSERT INTO ciclos_consolidacion_estados_remotos (
             boot_id,estado,iniciado_en_utc,limite_en_utc,
             cerrado_en_utc,evento_inicio_id,evento_cierre_id,version_ciclo
           ) VALUES (?,'abierto',?,?,NULL,?,NULL,1)`,
          [boot, ahora, limite, eventoId]
        );
        await this.adaptadorAuditoria?.registrarCicloEnTransaccion({
          eventoId,
          operacion: 'iniciada',
          bootId: boot,
          efectivoEnUtc: ahora.toISOString()
        }, { conexion });
      }
      const ciclo = await obtenerCiclo(conexion, boot, false);
      await conexion.commit();
      return proyectarCiclo(ciclo);
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async materializar({ bootId, fotografias = [] } = {}) {
    const boot = identidad(bootId, TIPOS_IDENTIDAD_FEDERADA.ARRANQUE, 'bootId');
    if (!Array.isArray(fotografias)) throw new Error('fotografias debe ser una lista.');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      let ciclo = await obtenerCiclo(conexion, boot, true);
      if (!ciclo) throw new Error('No existe un ciclo de consolidación para este arranque.');
      const ahora = await ahoraSql(conexion);
      if (ciclo.estado === 'abierto' && new Date(ciclo.limite_en_utc) <= ahora) {
        const eventoCierreId = uuidV7(
          this.generarTransicionId(),
          'eventoCierreId'
        );
        await conexion.execute(
          `UPDATE ciclos_consolidacion_estados_remotos
              SET estado='cerrado',cerrado_en_utc=?,evento_cierre_id=?,
                  version_ciclo=version_ciclo+1
            WHERE boot_id=? AND estado='abierto'`,
          [ahora, eventoCierreId, boot]
        );
        await this.adaptadorAuditoria?.registrarCicloEnTransaccion({
          eventoId: eventoCierreId,
          operacion: 'finalizada',
          bootId: boot,
          efectivoEnUtc: ahora.toISOString()
        }, { conexion });
        ciclo = await obtenerCiclo(conexion, boot, true);
      }
      const transiciones = [];
      for (const fotografia of fotografias) {
        const resultado = await materializarFotografia(conexion, {
          fotografia,
          ciclo,
          ahora,
          generarTransicionId: this.generarTransicionId,
          adaptadorAuditoria: this.adaptadorAuditoria
        });
        if (resultado) transiciones.push(resultado);
      }
      transiciones.push(...await materializarRetiradas(conexion, {
        ahora,
        generarTransicionId: this.generarTransicionId,
        adaptadorAuditoria: this.adaptadorAuditoria
      }));
      await conexion.commit();
      return Object.freeze({
        ciclo: proyectarCiclo(ciclo),
        totalTransiciones: transiciones.length,
        transiciones: Object.freeze(transiciones)
      });
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async listarEstados() {
    const filas = await this.clienteSql.consultar(
      `SELECT * FROM estados_temporales_fotografias_remotas
        ORDER BY proyeccion_id`
    );
    return Object.freeze(filas.map(proyectarEstado));
  }

  async listarAvisosPendientes({ limite = 100 } = {}) {
    const maximo = entero(limite, 1, 1000, 'limite');
    const filas = await this.clienteSql.consultar(
      `SELECT t.*,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              w.relacion_id,w.flujo_id,r.monitor_origen_id,r.estado_operativo
         FROM transiciones_temporales_fotografias_remotas t
         JOIN proyecciones_federacion p ON p.proyeccion_id=t.proyeccion_id
         JOIN registros_monitores_remotos r
           ON r.proyeccion_id=t.proyeccion_id
          AND r.generacion_id=t.generacion_id
          AND r.secuencia_elemento=t.secuencia_estado
         JOIN trabajos_materializacion_federacion w
           ON w.entrega_id=r.trabajo_entrega_id
        WHERE t.operacion_aviso<>'ninguna' AND t.aviso_aplicado_en_utc IS NULL
        ORDER BY t.materializado_en_utc,t.transicion_id
        LIMIT ${maximo}`
    );
    return Object.freeze(filas.map(proyectarAvisoPendiente));
  }

  async confirmarAviso({ transicionId } = {}) {
    const id = uuidV7(transicionId, 'transicionId');
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE transiciones_temporales_fotografias_remotas
          SET aviso_aplicado_en_utc=UTC_TIMESTAMP(3)
        WHERE transicion_id=? AND operacion_aviso<>'ninguna'
          AND aviso_aplicado_en_utc IS NULL`,
      [id]
    );
    if (Number(resultado.affectedRows) === 1) return true;
    const [existente] = await this.clienteSql.consultar(
      `SELECT aviso_aplicado_en_utc
         FROM transiciones_temporales_fotografias_remotas
        WHERE transicion_id=? AND operacion_aviso<>'ninguna'`,
      [id]
    );
    if (!existente?.aviso_aplicado_en_utc) {
      throw new Error('La transición temporal no admite la confirmación indicada.');
    }
    return false;
  }
}

async function materializarRetiradas(conexion, {
  ahora,
  generarTransicionId,
  adaptadorAuditoria
}) {
  const [retiradas] = await conexion.execute(
    `WITH candidatas AS (
       SELECT p.proyeccion_id,p.scope_tenant_id,p.scope_empresa_id,
              p.scope_sitio_id,v.generacion_id AS generacion_retirada_id,
              v.ultima_secuencia_evaluada,
              e.generacion_id AS estado_generacion_id,
              ROW_NUMBER() OVER (
                PARTITION BY p.proyeccion_id
                ORDER BY v.actualizada_en_utc DESC,v.generacion_id DESC
              ) AS ordinal
         FROM proyecciones_federacion p
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=p.proyeccion_id
       LEFT JOIN estados_actuales_proyecciones_federacion a
           ON a.proyeccion_id=p.proyeccion_id
         LEFT JOIN estados_temporales_fotografias_remotas e
           ON e.proyeccion_id=p.proyeccion_id
        WHERE p.familia='monitores'
          AND v.estado_vigencia='retirada'
          AND (
            e.proyeccion_id IS NULL
            OR e.generacion_id<>v.generacion_id
            OR e.condicion<>'retirada'
          )
        AND (
            (a.generacion_actual_id=v.generacion_id
            AND v.estado_publicacion='actual')
          OR (a.proyeccion_id IS NULL
            AND v.estado_publicacion='preparando')
        )
     )
     SELECT c.*,f.secuencia_estado AS fotografia_secuencia,
            f.vigente_hasta_receptor_utc,r.vigente_hasta_origen_utc
       FROM candidatas c
       LEFT JOIN fotografias_operativas_monitores_remotos f
         ON f.proyeccion_id=c.proyeccion_id
        AND f.generacion_id=c.generacion_retirada_id
        AND f.secuencia_estado=(
          SELECT MAX(f0.secuencia_estado)
            FROM fotografias_operativas_monitores_remotos f0
           WHERE f0.proyeccion_id=c.proyeccion_id
             AND f0.generacion_id=c.generacion_retirada_id
             AND f0.secuencia_estado<=c.ultima_secuencia_evaluada
        )
       LEFT JOIN registros_monitores_remotos r
         ON r.proyeccion_id=f.proyeccion_id
        AND r.generacion_id=f.generacion_id
        AND r.secuencia_elemento=f.secuencia_estado
      WHERE c.ordinal=1
      ORDER BY c.proyeccion_id`
  );
  const transiciones = [];
  for (const retirada of retiradas) {
    await conexion.execute(
      `SELECT proyeccion_id FROM proyecciones_federacion
        WHERE proyeccion_id=? FOR UPDATE`,
      [retirada.proyeccion_id]
    );
    const [fronteraRetirada] = await conexion.execute(
      `SELECT v.generacion_id
         FROM versiones_proyecciones_federacion v
         LEFT JOIN estados_actuales_proyecciones_federacion a
           ON a.proyeccion_id=v.proyeccion_id
        WHERE v.proyeccion_id=? AND v.generacion_id=?
          AND v.estado_vigencia='retirada'
          AND (
            (a.generacion_actual_id=v.generacion_id
              AND v.estado_publicacion='actual')
            OR (a.proyeccion_id IS NULL
              AND v.estado_publicacion='preparando')
          )`,
      [retirada.proyeccion_id, retirada.generacion_retirada_id]
    );
    if (!fronteraRetirada[0]) continue;
    const [estados] = await conexion.execute(
      `SELECT * FROM estados_temporales_fotografias_remotas
        WHERE proyeccion_id=? FOR UPDATE`,
      [retirada.proyeccion_id]
    );
    const anterior = estados[0] || null;
    const mismaGeneracion = anterior?.generacion_id ===
      retirada.generacion_retirada_id;
    if (mismaGeneracion && anterior.condicion === 'retirada') continue;
    const transicionId = uuidV7(generarTransicionId(), 'generarTransicionId()');
    const operacionAviso = resolverOperacionAviso(anterior, 'retirada');
    const eventoAvisoId = operacionAviso === 'ninguna'
      ? null
      : uuidV7(generarTransicionId(), 'eventoAvisoId');
    const generacionId = retirada.generacion_retirada_id;
    const secuencia = mismaGeneracion
      ? anterior.secuencia_estado
      : retirada.fotografia_secuencia ?? null;
    const vigencia = mismaGeneracion
      ? anterior.vigente_hasta_efectiva_utc
      : vigenciaRetirada(retirada, ahora);
    if (anterior) {
      await conexion.execute(
        `UPDATE estados_temporales_fotografias_remotas
            SET generacion_id=?,secuencia_estado=?,condicion='retirada',
                vigente_hasta_efectiva_utc=?,efectivo_en_utc=?,materializado_en_utc=?,
                boot_consolidacion_id=NULL,aviso_vencimiento_activo=FALSE,
                ultima_transicion_id=?,version_estado=version_estado+1
          WHERE proyeccion_id=?`,
        [generacionId,secuencia,vigencia,ahora,ahora,transicionId,
          anterior.proyeccion_id]
      );
    } else {
      await conexion.execute(
        `INSERT INTO estados_temporales_fotografias_remotas (
           proyeccion_id,generacion_id,secuencia_estado,condicion,
           vigente_hasta_efectiva_utc,efectivo_en_utc,materializado_en_utc,
           boot_consolidacion_id,aviso_vencimiento_activo,
           ultima_transicion_id,version_estado
         ) VALUES (?,?,?,'retirada',?,?,?,NULL,FALSE,?,1)`,
        [retirada.proyeccion_id,generacionId,secuencia,vigencia,ahora,ahora,transicionId]
      );
    }
    await conexion.execute(
      `INSERT INTO transiciones_temporales_fotografias_remotas (
         transicion_id,proyeccion_id,generacion_id,secuencia_estado,
         condicion_anterior,condicion_nueva,causa,
         vigente_hasta_efectiva_utc,efectivo_en_utc,materializado_en_utc,
         boot_consolidacion_id,operacion_aviso,evento_aviso_id,
         aviso_aplicado_en_utc
       ) VALUES (?,?,?,?,?,'retirada','fuente_retirada',?,?,?,?,?,?,NULL)`,
      [
        transicionId,retirada.proyeccion_id,generacionId,secuencia,
        anterior?.condicion ?? null,vigencia,ahora,ahora,null,
        operacionAviso,eventoAvisoId
      ]
    );
    await adaptadorAuditoria?.registrarEstadoEnTransaccion({
      eventoId: transicionId,
      proyeccionId: retirada.proyeccion_id,
      scope: {
        tenantId: decimalOpcional(retirada.scope_tenant_id),
        empresaId: decimalOpcional(retirada.scope_empresa_id),
        sitioId: decimalOpcional(retirada.scope_sitio_id)
      },
      efectivoEnUtc: ahora.toISOString(),
      causa: 'fuente_retirada'
    }, { conexion });
    transiciones.push(Object.freeze({
      transicionId,
      proyeccionId: retirada.proyeccion_id,
      condicionAnterior: anterior?.condicion ?? null,
      condicionNueva: 'retirada',
      causa: 'fuente_retirada',
      operacionAviso
    }));
  }
  return transiciones;
}

function vigenciaRetirada(retirada, ahora) {
  const limites = [
    retirada.vigente_hasta_origen_utc,
    retirada.vigente_hasta_receptor_utc
  ].filter((valor) => valor !== null && valor !== undefined)
    .map((valor) => new Date(valor));
  return limites.length === 0
    ? ahora
    : new Date(Math.min(...limites.map((fecha) => fecha.getTime())));
}

async function materializarFotografia(conexion, {
  fotografia,
  ciclo,
  ahora,
  generarTransicionId,
  adaptadorAuditoria
}) {
  const proyeccionId = identidad(
    fotografia?.proyeccionId,
    TIPOS_IDENTIDAD_FEDERADA.PROYECCION,
    'fotografia.proyeccionId'
  );
  const generacionId = identidad(
    fotografia?.generacionId,
    TIPOS_IDENTIDAD_FEDERADA.GENERACION,
    'fotografia.generacionId'
  );
  const secuencia = decimalPositivo(fotografia?.secuenciaElemento, 'secuenciaElemento');
  const vigencia = fecha(fotografia?.fotografiaOperativa?.vigenteHastaEfectivaUtc, 'vigencia');
  const [fronteras] = await conexion.execute(
    `SELECT 1 AS vigente
       FROM estados_actuales_proyecciones_federacion a
       JOIN versiones_proyecciones_federacion v
         ON v.proyeccion_id=a.proyeccion_id
        AND v.generacion_id=a.generacion_actual_id
        AND v.estado_publicacion='actual'
       JOIN fotografias_operativas_monitores_remotos f
         ON f.proyeccion_id=a.proyeccion_id
        AND f.generacion_id=a.generacion_actual_id
        AND f.secuencia_estado=?
      WHERE a.proyeccion_id=? AND a.generacion_actual_id=?
        AND f.secuencia_estado<=v.ultima_secuencia_evaluada`,
    [secuencia, proyeccionId, generacionId]
  );
  if (!fronteras[0]) return null;
  const [estados] = await conexion.execute(
    `SELECT * FROM estados_temporales_fotografias_remotas
      WHERE proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  const anterior = estados[0] || null;
  const mismaFotografia = anterior &&
    anterior.generacion_id === generacionId &&
    String(anterior.secuencia_estado) === secuencia;
  let condicion = resolverCondicion(fotografia.fotografiaOperativa, ciclo);
  if (mismaFotografia &&
      ['noAutorizada', 'incompatible'].includes(anterior.condicion)) {
    condicion = anterior.condicion;
  }
  if (mismaFotografia && anterior.condicion === condicion &&
      new Date(anterior.vigente_hasta_efectiva_utc).getTime() === vigencia.getTime()) {
    return null;
  }
  const transicionId = uuidV7(generarTransicionId(), 'generarTransicionId()');
  const causa = resolverCausa({ anterior, condicion, mismaFotografia });
  const operacionAviso = resolverOperacionAviso(anterior, condicion);
  const eventoAvisoId = operacionAviso === 'ninguna'
    ? null
    : uuidV7(generarTransicionId(), 'eventoAvisoId');
  const avisoActivo = operacionAviso === 'detectar'
    ? true
    : operacionAviso === 'resolver'
      ? false
      : Boolean(anterior?.aviso_vencimiento_activo);
  const efectivo = condicion === 'vencida' ? vigencia : ahora;
  if (!anterior) {
    await conexion.execute(
      `INSERT INTO estados_temporales_fotografias_remotas (
         proyeccion_id,generacion_id,secuencia_estado,condicion,
         vigente_hasta_efectiva_utc,efectivo_en_utc,materializado_en_utc,
         boot_consolidacion_id,aviso_vencimiento_activo,
         ultima_transicion_id,version_estado
       ) VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
      [
        proyeccionId,generacionId,secuencia,condicion,vigencia,efectivo,ahora,
        condicion === 'consolidando' ? ciclo.boot_id : null,
        avisoActivo,transicionId
      ]
    );
  } else {
    await conexion.execute(
      `UPDATE estados_temporales_fotografias_remotas
          SET generacion_id=?,secuencia_estado=?,condicion=?,
              vigente_hasta_efectiva_utc=?,efectivo_en_utc=?,
              materializado_en_utc=?,boot_consolidacion_id=?,
              aviso_vencimiento_activo=?,ultima_transicion_id=?,
              version_estado=version_estado+1
        WHERE proyeccion_id=?`,
      [
        generacionId,secuencia,condicion,vigencia,efectivo,ahora,
        condicion === 'consolidando' ? ciclo.boot_id : null,
        avisoActivo,transicionId,proyeccionId
      ]
    );
  }
  await conexion.execute(
    `INSERT INTO transiciones_temporales_fotografias_remotas (
       transicion_id,proyeccion_id,generacion_id,secuencia_estado,
       condicion_anterior,condicion_nueva,causa,
       vigente_hasta_efectiva_utc,efectivo_en_utc,materializado_en_utc,
       boot_consolidacion_id,operacion_aviso,evento_aviso_id,
       aviso_aplicado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
    [
      transicionId,proyeccionId,generacionId,secuencia,
      anterior?.condicion ?? null,condicion,causa,vigencia,efectivo,ahora,
      condicion === 'consolidando' ? ciclo.boot_id : null,
      operacionAviso,eventoAvisoId
    ]
  );
  await adaptadorAuditoria?.registrarEstadoEnTransaccion({
    eventoId: transicionId,
    proyeccionId,
    scope: {
      tenantId: fotografia.scopeRecepcion.tenantId,
      empresaId: fotografia.scopeRecepcion.empresaId,
      sitioId: fotografia.scopeRecepcion.sitioId
    },
    efectivoEnUtc: efectivo.toISOString(),
    causa
  }, { conexion });
  return Object.freeze({
    transicionId,
    proyeccionId,
    condicionAnterior: anterior?.condicion ?? null,
    condicionNueva: condicion,
    causa,
    operacionAviso
  });
}

function resolverCondicion(fotografia, ciclo) {
  if (!fotografia.autorizada) return 'noAutorizada';
  if (!fotografia.compatible) return 'incompatible';
  if (fotografia.utilizableAhora) return 'vigente';
  if (ciclo.estado === 'abierto') return 'consolidando';
  return 'vencida';
}

function resolverCausa({ anterior, condicion, mismaFotografia }) {
  if (!anterior) return condicion === 'consolidando'
    ? 'consolidacion_iniciada' : 'fotografia_inicial';
  if (!mismaFotografia) {
    if (condicion === 'vigente') return 'fotografia_actualizada';
    if (condicion === 'noAutorizada') return 'autoridad_perdida';
    if (condicion === 'incompatible') return 'compatibilidad_perdida';
    return 'ttl_agotado';
  }
  if (anterior.condicion === 'noAutorizada' && condicion !== 'noAutorizada') {
    return 'autoridad_recuperada';
  }
  if (anterior.condicion === 'incompatible' && condicion !== 'incompatible') {
    return 'compatibilidad_recuperada';
  }
  if (condicion === 'consolidando') return 'consolidacion_iniciada';
  if (anterior.condicion === 'consolidando' && condicion === 'vencida') {
    return 'consolidacion_finalizada';
  }
  if (condicion === 'vigente') return 'estado_recuperado';
  if (condicion === 'noAutorizada') return 'autoridad_perdida';
  if (condicion === 'incompatible') return 'compatibilidad_perdida';
  return 'ttl_agotado';
}

function resolverOperacionAviso(anterior, condicion) {
  const activo = Boolean(anterior?.aviso_vencimiento_activo);
  if (condicion === 'vencida' && !activo) return 'detectar';
  if (condicion !== 'vencida' && activo) return 'resolver';
  return 'ninguna';
}

async function obtenerCiclo(conexion, bootId, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT * FROM ciclos_consolidacion_estados_remotos
      WHERE boot_id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [bootId]
  );
  return filas[0] || null;
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute('SELECT UTC_TIMESTAMP(3) AS ahora');
  return new Date(filas[0].ahora);
}

function proyectarCiclo(fila) {
  return Object.freeze({
    bootId: fila.boot_id,
    estado: fila.estado,
    iniciadoEnUtc: serializarFecha(fila.iniciado_en_utc),
    limiteEnUtc: serializarFecha(fila.limite_en_utc),
    cerradoEnUtc: serializarFecha(fila.cerrado_en_utc),
    version: String(fila.version_ciclo)
  });
}

function proyectarEstado(fila) {
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    generacionId: fila.generacion_id,
    secuenciaElemento: fila.secuencia_estado === null
      ? null
      : String(fila.secuencia_estado),
    condicion: fila.condicion,
    vigenteHastaEfectivaUtc: serializarFecha(fila.vigente_hasta_efectiva_utc),
    efectivoEnUtc: serializarFecha(fila.efectivo_en_utc),
    materializadoEnUtc: serializarFecha(fila.materializado_en_utc),
    bootConsolidacionId: fila.boot_consolidacion_id,
    avisoVencimientoActivo: Boolean(fila.aviso_vencimiento_activo),
    transicionId: fila.ultima_transicion_id,
    version: String(fila.version_estado)
  });
}

function proyectarAvisoPendiente(fila) {
  return Object.freeze({
    transicionId: fila.transicion_id,
    eventoAvisoId: fila.evento_aviso_id,
    operacion: fila.operacion_aviso,
    efectivoEnUtc: serializarFecha(fila.efectivo_en_utc),
    proyeccionId: fila.proyeccion_id,
    generacionId: fila.generacion_id,
    secuenciaElemento: String(fila.secuencia_estado),
    condicionAnterior: fila.condicion_anterior,
    condicionNueva: fila.condicion_nueva,
    causa: fila.causa,
    vigenteHastaEfectivaUtc: serializarFecha(fila.vigente_hasta_efectiva_utc),
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    monitorOrigenId: fila.monitor_origen_id,
    estadoOperativo: fila.estado_operativo,
    relacionId: fila.relacion_id,
    flujoId: fila.flujo_id,
    scope: Object.freeze({
      tenantId: decimalOpcional(fila.scope_tenant_id),
      empresaId: decimalOpcional(fila.scope_empresa_id),
      sitioId: decimalOpcional(fila.scope_sitio_id)
    })
  });
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    throw new Error(`${campo} no es una identidad federada válida.`);
  }
}

function uuidV7(valor, campo) {
  const texto = String(valor || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(texto)) {
    throw new Error(`${campo} debe ser un UUIDv7.`);
  }
  return texto;
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} no pertenece al rango permitido.`);
  }
  return numero;
}

function decimalPositivo(valor, campo) {
  try {
    const numero = BigInt(valor);
    if (numero >= 1n && numero <= 18_446_744_073_709_551_615n) return numero.toString();
  } catch { /* error normalizado abajo */ }
  throw new Error(`${campo} debe ser un decimal positivo.`);
}

function fecha(valor, campo) {
  const resultado = new Date(valor);
  if (Number.isNaN(resultado.getTime())) throw new Error(`${campo} no es una fecha válida.`);
  return resultado;
}

function serializarFecha(valor) {
  return valor === null || valor === undefined ? null : new Date(valor).toISOString();
}

function decimalOpcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}
