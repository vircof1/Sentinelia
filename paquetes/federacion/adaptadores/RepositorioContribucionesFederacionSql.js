import { createHash, randomBytes } from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;
const PATRON_FECHA_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const generadorContribuciones = new GeneradorIdentidadesFederadas({
  fuenteEntropia: Object.freeze({
    entropiaBitsPorIdentidad: 128,
    generarBytes: ({ cantidadBytes }) => randomBytes(cantidadBytes)
  })
});

export class ErrorContribucionesFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorContribucionesFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioContribucionesFederacionSql {
  constructor(
    clienteSql,
    { generarContribucionId = generarContribucionIdSeguro } = {}
  ) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Las contribuciones federadas requieren SQL operativo.');
    }
    if (typeof generarContribucionId !== 'function') {
      throw new Error('Las contribuciones federadas requieren generarContribucionId().');
    }
    this.clienteSql = clienteSql;
    this.generarContribucionId = generarContribucionId;
  }

  async registrarEnTransaccion({
    lote,
    entrega,
    inboxId,
    proyeccionId
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const entrada = normalizarEntrada({ lote, entrega, inboxId, proyeccionId });
    const control = await obtenerControlBloqueado(conexion, entrada);
    exigirControlValido(control, entrada);
    const ahora = await ahoraSql(conexion);
    const recorridoCanonico = canonicalizarJsonFederacion(
      entrada.procedencia.recorridoInstalaciones
    );
    const recorridoSha256 = sha256(recorridoCanonico);
    let contribucionNueva = false;
    let contribucionId = identidad(
      this.generarContribucionId(),
      TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION,
      'generarContribucionId()'
    );
    try {
      await conexion.execute(
        `INSERT INTO contribuciones_proyecciones_federacion (
           contribucion_id,proyeccion_id,relacion_id,revision_concesion_id,
           installation_emisora_id,boot_emisor_ultimo_id,recorrido_sha256,
           longitud_recorrido,estado_autoridad,estado_identidad,
           estado_compatibilidad,resultado_validacion,estado_integridad,
           veces_observada,primera_comunicacion_valida_utc,
           ultima_comunicacion_valida_utc,creada_en_utc,actualizada_en_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'valida','noVerificable',1,?,?,?,?)`,
        [
          contribucionId,
          entrada.proyeccionId,
          entrada.relacionId,
          entrada.revisionConcesionId,
          entrada.procedencia.installationEmisoraId,
          entrada.procedencia.bootEmisorId,
          recorridoSha256,
          entrada.procedencia.recorridoInstalaciones.length,
          control.estado_autoridad,
          control.estado_identidad,
          control.estado_compatibilidad ?? 'desconocida',
          ahora,
          ahora,
          ahora,
          ahora
        ]
      );
      contribucionNueva = true;
      for (let indice = 0;
        indice < entrada.procedencia.recorridoInstalaciones.length;
        indice += 1) {
        await conexion.execute(
          `INSERT INTO recorrido_contribuciones_federacion (
             contribucion_id,ordinal,installation_id
           ) VALUES (?,?,?)`,
          [
            contribucionId,
            indice + 1,
            entrada.procedencia.recorridoInstalaciones[indice]
          ]
        );
      }
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const existente = await obtenerContribucionPorRutaBloqueada(conexion, {
        ...entrada,
        recorridoSha256
      });
      if (!existente) {
        throw new ErrorContribucionesFederacion(
          'contribucion_id_reutilizado',
          'La identidad generada ya pertenece a otra contribución.'
        );
      }
      contribucionId = existente.contribucion_id;
      await exigirRecorridoPersistido(conexion, {
        contribucionId,
        recorrido: entrada.procedencia.recorridoInstalaciones
      });
      await conexion.execute(
        `UPDATE contribuciones_proyecciones_federacion
            SET boot_emisor_ultimo_id=?,estado_autoridad=?,estado_identidad=?,
                estado_compatibilidad=?,resultado_validacion='valida',
                estado_integridad='noVerificable',veces_observada=veces_observada+1,
                ultima_comunicacion_valida_utc=GREATEST(
                  ultima_comunicacion_valida_utc,?
                ),actualizada_en_utc=GREATEST(actualizada_en_utc,?)
          WHERE contribucion_id=?`,
        [
          entrada.procedencia.bootEmisorId,
          control.estado_autoridad,
          control.estado_identidad,
          control.estado_compatibilidad ?? 'desconocida',
          ahora,
          ahora,
          contribucionId
        ]
      );
    }

    const procedenciaCanonica = canonicalizarJsonFederacion(entrada.procedencia);
    const procedenciaSha256 = sha256(procedenciaCanonica);
    let aporteNuevo = false;
    try {
      await conexion.execute(
        `INSERT INTO aportes_ocurrencias_contribuciones_federacion (
           contribucion_id,inbox_ocurrencia_id,flujo_id,generacion_id,
           primera_entrega_id,
           ultima_entrega_id,primera_procedencia_canonica,
           primera_procedencia_sha256,ultima_procedencia_canonica,
           ultima_procedencia_sha256,vigencia_restante_recepcion_ms,
           veces_observada,primera_observacion_utc,ultima_observacion_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        [
          contribucionId,
          entrada.inboxId,
          entrada.flujoId,
          entrada.generacionId,
          entrada.entregaId,
          entrada.entregaId,
          procedenciaCanonica,
          procedenciaSha256,
          procedenciaCanonica,
          procedenciaSha256,
          entrada.vigenciaRestanteMs,
          ahora,
          ahora
        ]
      );
      aporteNuevo = true;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const [actualizacion] = await conexion.execute(
        `UPDATE aportes_ocurrencias_contribuciones_federacion
            SET ultima_entrega_id=?,ultima_procedencia_canonica=?,
                ultima_procedencia_sha256=?,
                veces_observada=veces_observada+1,
                ultima_observacion_utc=GREATEST(ultima_observacion_utc,?)
          WHERE contribucion_id=? AND inbox_ocurrencia_id=?
            AND generacion_id=?`,
        [
          entrada.entregaId,
          procedenciaCanonica,
          procedenciaSha256,
          ahora,
          contribucionId,
          entrada.inboxId,
          entrada.generacionId
        ]
      );
      if (Number(actualizacion.affectedRows) !== 1) {
        throw new ErrorContribucionesFederacion(
          'aporte_contribucion_inconsistente',
          'El aporte conocido no pudo actualizar su evidencia de observación.'
        );
      }
    }
    return Object.freeze({
      contribucionId,
      contribucionNueva,
      aporteNuevo,
      longitudRecorrido: entrada.procedencia.recorridoInstalaciones.length
    });
  }
}

function normalizarEntrada({ lote, entrega, inboxId, proyeccionId }) {
  const relacionId = identidad(
    lote?.relacionId,
    TIPOS_IDENTIDAD_FEDERADA.RELACION,
    'lote.relacionId'
  );
  const revisionConcesionId = identidad(
    lote?.revisionConcesionEfectiva,
    TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION,
    'lote.revisionConcesionEfectiva'
  );
  const flujoId = identidad(
    lote?.flujoId,
    TIPOS_IDENTIDAD_FEDERADA.FLUJO,
    'lote.flujoId'
  );
  const generacionId = identidad(
    lote?.generacionId,
    TIPOS_IDENTIDAD_FEDERADA.GENERACION,
    'lote.generacionId'
  );
  const proyeccion = identidad(
    proyeccionId,
    TIPOS_IDENTIDAD_FEDERADA.PROYECCION,
    'proyeccionId'
  );
  const entregaId = identidad(
    entrega?.entregaId,
    TIPOS_IDENTIDAD_FEDERADA.ENTREGA,
    'entrega.entregaId'
  );
  if (!/^[1-9][0-9]*$/u.test(String(inboxId ?? ''))) {
    fallar('inbox_contribucion_invalida', 'La contribución exige una inbox durable.');
  }
  const procedencia = normalizarProcedencia(entrega?.procedencia, entrega?.ocurrencia);
  return Object.freeze({
    relacionId,
    revisionConcesionId,
    flujoId,
    generacionId,
    proyeccionId: proyeccion,
    entregaId,
    inboxId: String(inboxId),
    procedencia,
    vigenciaRestanteMs: decimalOpcional(
      entrega?.ocurrencia?.vigenciaRestanteMs,
      'ocurrencia.vigenciaRestanteMs'
    ),
    installationOrigenId: entrega.ocurrencia.installationOrigenId,
    familia: entrega.ocurrencia.familia,
    elementoOrigenId: entrega.ocurrencia.elementoOrigenId
  });
}

function normalizarProcedencia(entrada, ocurrencia) {
  exigirObjetoExacto(entrada, [
    'bootEmisorId',
    'installationEmisoraId',
    'recorridoInstalaciones',
    'tiemposSaltosDisponibles'
  ], 'entrega.procedencia');
  const installationEmisoraId = identidad(
    entrada.installationEmisoraId,
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
    'procedencia.installationEmisoraId'
  );
  const bootEmisorId = identidad(
    entrada.bootEmisorId,
    TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
    'procedencia.bootEmisorId'
  );
  if (!Array.isArray(entrada.recorridoInstalaciones) ||
      entrada.recorridoInstalaciones.length === 0) {
    fallar('recorrido_contribucion_invalido', 'El recorrido no puede estar vacío.');
  }
  const recorridoInstalaciones = entrada.recorridoInstalaciones.map((valor, indice) =>
    identidad(
      valor,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      `procedencia.recorridoInstalaciones[${indice}]`
    ));
  if (new Set(recorridoInstalaciones).size !== recorridoInstalaciones.length ||
      recorridoInstalaciones[0] !== ocurrencia?.installationOrigenId ||
      recorridoInstalaciones.at(-1) !== installationEmisoraId) {
    fallar(
      'recorrido_contribucion_incoherente',
      'El recorrido debe ser único, comenzar en origen y terminar en el emisor inmediato.'
    );
  }
  if (!Array.isArray(entrada.tiemposSaltosDisponibles)) {
    fallar('tiempos_contribucion_invalidos', 'Los tiempos de salto deben ser una lista.');
  }
  const posiciones = new Map(recorridoInstalaciones.map((id, indice) => [id, indice]));
  const vistos = new Set();
  const tiemposSaltosDisponibles = entrada.tiemposSaltosDisponibles.map((salto, indice) => {
    exigirObjetoExacto(
      salto,
      ['bootId', 'emitidoUtc', 'installationId', 'recibidoUtc'],
      `procedencia.tiemposSaltosDisponibles[${indice}]`
    );
    const installationId = identidad(
      salto.installationId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      `tiemposSaltosDisponibles[${indice}].installationId`
    );
    if (!posiciones.has(installationId) || vistos.has(installationId)) {
      fallar(
        'tiempos_contribucion_incoherentes',
        'Cada tiempo debe pertenecer una sola vez al recorrido.'
      );
    }
    vistos.add(installationId);
    const bootId = salto.bootId === null
      ? null
      : identidad(
        salto.bootId,
        TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
        `tiemposSaltosDisponibles[${indice}].bootId`
      );
    const recibidoUtc = fechaOpcional(salto.recibidoUtc, 'recibidoUtc');
    const emitidoUtc = fechaOpcional(salto.emitidoUtc, 'emitidoUtc');
    if (recibidoUtc && emitidoUtc && Date.parse(emitidoUtc) < Date.parse(recibidoUtc)) {
      fallar('cronologia_contribucion_invalida', 'Un salto se emitió antes de recibirse.');
    }
    if (installationId === installationEmisoraId && bootId !== bootEmisorId) {
      fallar('boot_contribucion_incoherente', 'El boot del emisor inmediato no coincide.');
    }
    return { installationId, bootId, recibidoUtc, emitidoUtc };
  }).sort((a, b) => posiciones.get(a.installationId) - posiciones.get(b.installationId));
  return Object.freeze({
    installationEmisoraId,
    bootEmisorId,
    recorridoInstalaciones: Object.freeze(recorridoInstalaciones),
    tiemposSaltosDisponibles: Object.freeze(tiemposSaltosDisponibles.map(Object.freeze))
  });
}

async function obtenerControlBloqueado(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT r.installation_remota_id,r.estado_autoridad,r.estado_identidad,
            r.estado_compatibilidad,v.papel
       FROM relaciones_federacion r
       JOIN estado_concesion_relaciones_federacion e
         ON e.relacion_id=r.relacion_id
       JOIN revisiones_concesion_federacion v
         ON v.relacion_id=r.relacion_id AND v.revision_id=?
        AND v.revision_id=e.revision_efectiva_actual_id
        AND v.papel='efectiva' AND v.estado='vigente'
        AND v.finalizada_en_utc IS NULL
       JOIN flujos_federacion f
         ON f.relacion_id=r.relacion_id AND f.flujo_id=?
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
       JOIN proyecciones_federacion p
         ON p.proyeccion_id=?
        AND p.installation_origen_id=?
        AND p.familia=f.familia
        AND p.familia=?
        AND p.elemento_origen_id=?
        AND p.scope_nivel=f.scope_nivel
        AND p.scope_tenant_id<=>f.scope_tenant_id
        AND p.scope_empresa_id<=>f.scope_empresa_id
        AND p.scope_sitio_id<=>f.scope_sitio_id
      WHERE r.relacion_id=? AND r.direccion='recepcion'
        AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
        AND r.estado_identidad='valida'
        AND r.estado_compatibilidad IN ('compatible','compatibleParcial')
      FOR UPDATE`,
    [
      entrada.revisionConcesionId,
      entrada.flujoId,
      entrada.generacionId,
      entrada.proyeccionId,
      entrada.installationOrigenId,
      entrada.familia,
      entrada.elementoOrigenId,
      entrada.relacionId
    ]
  );
  return filas[0] || null;
}

function exigirControlValido(control, entrada) {
  if (!control || control.papel !== 'efectiva') {
    fallar(
      'revision_concesion_efectiva_desconocida',
      'La contribución no identifica una revisión efectiva de la relación.'
    );
  }
  if (control.installation_remota_id !== entrada.procedencia.installationEmisoraId) {
    fallar(
      'emisor_contribucion_no_autorizado',
      'La procedencia no coincide con el extremo remoto de la relación.'
    );
  }
}

async function obtenerContribucionPorRutaBloqueada(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT contribucion_id,installation_emisora_id,longitud_recorrido
       FROM contribuciones_proyecciones_federacion
      WHERE proyeccion_id=? AND relacion_id=? AND revision_concesion_id=?
        AND recorrido_sha256=? FOR UPDATE`,
    [
      entrada.proyeccionId,
      entrada.relacionId,
      entrada.revisionConcesionId,
      entrada.recorridoSha256
    ]
  );
  const fila = filas[0];
  if (!fila) return null;
  if (fila.installation_emisora_id !== entrada.procedencia.installationEmisoraId ||
      String(fila.longitud_recorrido) !==
        String(entrada.procedencia.recorridoInstalaciones.length)) {
    fallar(
      'huella_recorrido_colisionada',
      'La huella de recorrido coincide con otra procedencia estructural.'
    );
  }
  return fila;
}

async function exigirRecorridoPersistido(conexion, { contribucionId, recorrido }) {
  const [filas] = await conexion.execute(
    `SELECT ordinal,installation_id
       FROM recorrido_contribuciones_federacion
      WHERE contribucion_id=? ORDER BY ordinal`,
    [contribucionId]
  );
  if (filas.length !== recorrido.length || filas.some((fila, indice) =>
    String(fila.ordinal) !== String(indice + 1) ||
    fila.installation_id !== recorrido[indice])) {
    fallar(
      'huella_recorrido_colisionada',
      'La huella coincide pero el recorrido durable es diferente.'
    );
  }
}

function exigirObjetoExacto(valor, claves, campo) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.getPrototypeOf(valor) !== Object.prototype) {
    fallar('procedencia_contribucion_invalida', `${campo} debe ser un objeto JSON.`);
  }
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  if (observadas.length !== esperadas.length ||
      observadas.some((clave, indice) => clave !== esperadas[indice])) {
    fallar('procedencia_contribucion_invalida', `${campo} tiene una forma desconocida.`);
  }
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch (error) {
    throw new ErrorContribucionesFederacion(
      'identidad_contribucion_invalida',
      `${campo} no es canónica: ${error.message}`
    );
  }
}

function decimalOpcional(valor, campo) {
  if (valor === null) return null;
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto) || BigInt(texto) > MAX_BIGINT_UNSIGNED) {
    fallar('vigencia_contribucion_invalida', `${campo} no es un entero durable.`);
  }
  return texto;
}

function fechaOpcional(valor, campo) {
  if (valor === null) return null;
  if (typeof valor !== 'string' || !PATRON_FECHA_UTC.test(valor) ||
      !Number.isFinite(Date.parse(valor)) || new Date(Date.parse(valor)).toISOString() !== valor) {
    fallar('fecha_contribucion_invalida', `${campo} no usa UTC canónico.`);
  }
  return valor;
}

function generarContribucionIdSeguro() {
  return generadorContribuciones.generar(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION);
}

function sha256(valor) {
  return createHash('sha256').update(valor, 'utf8').digest();
}

function fallar(codigo, mensaje) {
  throw new ErrorContribucionesFederacion(codigo, mensaje);
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    fallar('transaccion_contribucion_ausente', 'La contribución exige SQL prestado.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_contribucion_inactiva', 'La contribución exige transacción activa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}
