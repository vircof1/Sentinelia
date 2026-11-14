import { createHash } from 'node:crypto';

import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  calcularConcesionEfectivaFederacion,
  crearDeclaracionConcesionFederacion,
  crearLimitesAutoridadActualFederacion,
  crearLimitesAutoridadRemotaDeclaradaFederacion,
  crearResponsabilidadFederada
} from '../src/AutoridadConcesionFederacion.js';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { listarContratosFamiliasFederacion }
  from '../src/ContratosFamiliasFederacion.js';
import { compararSeleccionesConcesionFederacion }
  from '../src/RevisionConcesionFederacion.js';
import { crearScopeFederacion } from '../src/ScopeFederacion.js';
import { derivarIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA }
  from '../src/IdentidadFederada.js';

const ORDEN_NIVELES = Object.freeze(['portal', 'tenant', 'empresa', 'sitio']);

export class ErrorConsolidacionConcesionFederacion extends Error {
  constructor(codigo, mensaje, { statusCode = 409 } = {}) {
    super(mensaje);
    this.name = 'ErrorConsolidacionConcesionFederacion';
    this.codigo = codigo;
    this.statusCode = statusCode;
  }
}

export class RepositorioConsolidacionConcesionFederacionSql {
  constructor(clienteSql, {
    adaptadorAuditoria, repositorioConsecuenciasDatos = null
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La consolidación de concesión requiere SQL operativo.');
    }
    if (typeof adaptadorAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La consolidación de concesión requiere auditoría transaccional.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
    if (repositorioConsecuenciasDatos !== null &&
        typeof repositorioConsecuenciasDatos?.aplicarEnTransaccion !== 'function') {
      throw new Error('Las consecuencias de concesión no son válidas.');
    }
    this.repositorioConsecuenciasDatos = repositorioConsecuenciasDatos;
  }

  async consolidar({
    relacionId,
    eventoId,
    correlacionId,
    actor
  } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const relacion = await bloquearRelacion(conexion, relacionId);
      validarRelacion(relacion);
      const estado = await bloquearEstado(conexion, relacionId);
      const papelLocal = relacion.direccion === 'emision' ? 'oferta' : 'aceptacion';
      const papelRemoto = papelLocal === 'oferta' ? 'aceptacion' : 'oferta';
      const local = await cargarRevisionLocalActual(
        conexion,
        estado,
        papelLocal
      );
      const remota = await cargarDeclaracionRemotaActual(
        conexion,
        relacionId,
        papelRemoto
      );
      if (!local || !remota) {
        await conexion.commit();
        return Object.freeze({
          estado: 'pendienteDeclaracionBilateral',
          relacionId,
          falta: Object.freeze([
            ...(!local ? [papelLocal] : []),
            ...(!remota ? [papelRemoto] : [])
          ])
        });
      }
      if (String(local.version_autoridad) !== String(relacion.version_autoridad)) {
        fallar('AUTORIDAD_LOCAL_CAMBIO_DURANTE_NEGOCIACION',
          'La declaración local dejó de pertenecer a la autoridad actual.');
      }
      const autoridadLocal = await resolverAutoridadLocal(conexion, relacion);
      if (!autoridadLocal.toJSON().activa) {
        fallar('AUTORIDAD_LOCAL_CAMBIO_DURANTE_NEGOCIACION',
          'La autoridad local cambió durante la negociación.');
      }
      const ahora = await ahoraSql(conexion);
      const proyeccionRemota = await proyectarRevisionRemota({
        conexion,
        relacion,
        estado,
        remota,
        papelRemoto,
        ahora
      });
      if (proyeccionRemota.estado === 'obsoleta') {
        await conexion.commit();
        return Object.freeze({
          estado: 'declaracionRemotaObsoleta',
          relacionId,
          revisionRemotaId: remota.revision_origen_id
        });
      }

      const declaracionLocal = declaracion(json(local.seleccion));
      const declaracionRemota = declaracion(json(remota.seleccion));
      const autoridadRemota = crearLimitesAutoridadRemotaDeclaradaFederacion({
        declaracion: declaracionRemota
      });
      const parametros = relacion.direccion === 'emision'
        ? {
            ofertaEmisora: declaracionLocal,
            aceptacionReceptora: declaracionRemota,
            autoridadActualEmisora: autoridadLocal,
            autoridadActualReceptora: autoridadRemota
          }
        : {
            ofertaEmisora: declaracionRemota,
            aceptacionReceptora: declaracionLocal,
            autoridadActualEmisora: autoridadRemota,
            autoridadActualReceptora: autoridadLocal
          };
      const efectiva = calcularConcesionEfectivaFederacion(parametros).toJSON();
      const ofertaId = relacion.direccion === 'emision'
        ? local.revision_id
        : remota.revision_origen_id;
      const aceptacionId = relacion.direccion === 'emision'
        ? remota.revision_origen_id
        : local.revision_id;
      const revisionEfectivaId = String(derivarIdentidadFederada({
        tipo: TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION,
        perfil: 'concesion-efectiva-bilateral-v1',
        componentes: [relacionId, ofertaId, aceptacionId]
      }));
      const existente = await buscarEfectivaFuentes(conexion, {
        relacionId,
        ofertaId,
        aceptacionId,
        versionAutoridad: String(relacion.version_autoridad),
        versionAutoridadRemota: String(remota.version_autoridad)
      });
      if (existente) {
        await conexion.commit();
        return respuesta(
          existente,
          estado?.revision_efectiva_actual_id === existente.revision_id
            ? 'yaConocida'
            : 'consolidacionSuperada'
        );
      }

      const anterior = await cargarRevisionPorId(
        conexion,
        estado?.revision_efectiva_actual_id
      );
      let claseCambio = 'inicial';
      if (anterior) {
        claseCambio = compararSeleccionesConcesionFederacion(
          json(anterior.seleccion),
          efectiva
        );
        await finalizarRevision(
          conexion,
          anterior.revision_id,
          ['reduccion', 'mixta'].includes(claseCambio) ? 'reducida' : 'sustituida',
          ahora
        );
      }
      const ordinal = await siguienteOrdinal(conexion, relacionId, 'efectiva');
      await insertarEfectiva(conexion, {
        revisionId: revisionEfectivaId,
        relacion,
        ordinal,
        ofertaId,
        aceptacionId,
        seleccion: efectiva,
        versionAutoridadRemota: String(remota.version_autoridad),
        eventoId,
        correlacionId,
        ahora
      });
      await apuntarEfectiva(conexion, relacionId, revisionEfectivaId, ahora);
      let consecuencias = null;
      if (anterior && ['reduccion', 'mixta'].includes(claseCambio) &&
          this.repositorioConsecuenciasDatos) {
        consecuencias = await this.repositorioConsecuenciasDatos.aplicarEnTransaccion({
          relacionId,
          revisionAnteriorId: anterior.revision_id,
          revisionSiguienteId: revisionEfectivaId,
          seleccionAnterior: json(anterior.seleccion),
          seleccionSiguiente: efectiva,
          causa: 'reduccionConcesion',
          ahora
        }, { conexion });
      }
      await incrementarRevisionRelacion(conexion, relacion, ahora);
      await this.adaptadorAuditoria.registrarEnTransaccion({
        eventoId,
        correlacionId,
        actor,
        tipo: 'federacion.concesion_revisada',
        relacionId,
        revisionConcesionId: revisionEfectivaId,
        motivoCodigo: 'consolidacionBilateral',
        scope: scopeRelacion(relacion),
        efectivoEnUtc: ahora
      }, { conexion });
      await conexion.commit();
      return Object.freeze({
        estado: efectiva.vacia ? 'consolidadaVacia' : 'consolidada',
        relacionId,
        revisionEfectivaId,
        revisionEfectivaAnteriorId: anterior?.revision_id || null,
        claseCambio,
        ofertaId,
        aceptacionId,
        seleccion: Object.freeze(efectiva),
        consecuencias
      });
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
    [relacionId]
  );
  if (!filas[0]) fallar('RELACION_CONCESION_NO_ENCONTRADA',
    'La relación federada no existe.');
  return filas[0];
}

function validarRelacion(relacion) {
  if (relacion.estado_ciclo !== 'vinculada' ||
      relacion.estado_autoridad !== 'autorizada' ||
      relacion.estado_identidad !== 'valida' ||
      relacion.estado_compatibilidad !== 'compatible') {
    fallar('RELACION_CONCESION_NO_OPERATIVA',
      'La relación no puede consolidar una concesión efectiva.');
  }
}

async function bloquearEstado(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM estado_concesion_relaciones_federacion
     WHERE relacion_id=? FOR UPDATE`,
    [relacionId]
  );
  return filas[0] || null;
}

async function cargarRevisionLocalActual(conexion, estado, papel) {
  const id = papel === 'oferta'
    ? estado?.revision_oferta_actual_id
    : estado?.revision_aceptacion_actual_id;
  const revision = await cargarRevisionPorId(conexion, id);
  if (!revision) return null;
  if (revision.papel !== papel || revision.procedencia !== 'local') {
    fallar('DECLARACION_LOCAL_CONCESION_INVALIDA',
      'El puntero local de concesión no conserva una declaración local válida.');
  }
  return revision;
}

async function cargarDeclaracionRemotaActual(conexion, relacionId, papel) {
  const [filas] = await conexion.execute(
    `SELECT * FROM intercambios_declaraciones_concesion_federacion
     WHERE direccion='entrante' AND relacion_id=? AND papel=?
       AND estado='confirmada'
     ORDER BY version_autoridad DESC, revision_ordinal DESC, intercambio_id DESC
     LIMIT 1 FOR UPDATE`,
    [relacionId, papel]
  );
  return filas[0] || null;
}

async function proyectarRevisionRemota({
  conexion, relacion, estado, remota, papelRemoto, ahora
}) {
  const existente = await cargarRevisionPorId(conexion, remota.revision_origen_id);
  if (existente) {
    const seleccionCanonica = canonicalizarJsonFederacion(json(remota.seleccion));
    const huella = createHash('sha256').update(seleccionCanonica).digest();
    const coincide = existente.relacion_id === relacion.relacion_id &&
      existente.papel === papelRemoto && existente.procedencia === 'remota' &&
      Buffer.from(existente.intercambio_origen_id).equals(remota.intercambio_id) &&
      existente.installation_declarante_id === remota.installation_emisora_id &&
      String(existente.version_autoridad) === String(remota.version_autoridad) &&
      String(existente.ordinal) === String(remota.revision_ordinal) &&
      canonicalizarJsonFederacion(json(existente.seleccion)) === seleccionCanonica &&
      Buffer.from(remota.huella_seleccion).equals(huella);
    if (!coincide) fallar('REVISION_REMOTA_CONCESION_CONFLICTIVA',
      'La identidad remota ya pertenece a otra declaración.');
    const idActual = papelRemoto === 'oferta'
      ? estado?.revision_oferta_actual_id
      : estado?.revision_aceptacion_actual_id;
    if (idActual !== existente.revision_id) {
      return { estado: 'obsoleta', revision: existente };
    }
    return { estado: 'yaConocida', revision: existente };
  }
  const idActual = papelRemoto === 'oferta'
    ? estado?.revision_oferta_actual_id
    : estado?.revision_aceptacion_actual_id;
  const actual = await cargarRevisionPorId(conexion, idActual);
  if (actual && compararOrden(actual, remota) >= 0) {
    return { estado: 'obsoleta', revision: actual };
  }
  if (actual) await finalizarRevision(
    conexion,
    actual.revision_id,
    'sustituida',
    ahora
  );
  await insertarRevisionRemota(conexion, { relacion, remota, ahora });
  await apuntarDeclaracion(
    conexion,
    relacion.relacion_id,
    papelRemoto,
    remota.revision_origen_id,
    ahora
  );
  return { estado: 'proyectada' };
}

function compararOrden(actual, remota) {
  const version = BigInt(actual.version_autoridad) - BigInt(remota.version_autoridad);
  if (version !== 0n) return version > 0n ? 1 : -1;
  const ordinal = BigInt(actual.ordinal) - BigInt(remota.revision_ordinal);
  return ordinal === 0n ? 0 : ordinal > 0n ? 1 : -1;
}

async function resolverAutoridadLocal(conexion, relacion) {
  const [filas] = await conexion.execute(
    `SELECT id,activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_emisiones_federacion,
            permiso_configurar_recepciones_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
    [relacion.responsable_usuario_id]
  );
  const usuario = filas[0];
  const permiso = relacion.direccion === 'emision'
    ? 'configurarEmisionesFederacion'
    : 'configurarRecepcionesFederacion';
  const columna = relacion.direccion === 'emision'
    ? 'permiso_configurar_emisiones_federacion'
    : 'permiso_configurar_recepciones_federacion';
  const scopeActual = scopeDesdeFila(usuario || {});
  const scopeConfiguracion = scopeDesdeRelacion(relacion);
  const responsabilidad = crearResponsabilidadFederada({
    usuarioId: String(relacion.responsable_usuario_id || 'ausente'),
    activa: Boolean(usuario?.activo),
    scopeActual,
    permisos: usuario?.[columna] ? [permiso] : []
  });
  return crearLimitesAutoridadActualFederacion({
    responsabilidad,
    permisoRequerido: permiso,
    scopeLocalConfiguracion: scopeConfiguracion,
    nivelesScope: ORDEN_NIVELES.slice(ORDEN_NIVELES.indexOf(scopeActual.nivel)),
    familias: familiasMaximas()
  });
}

function scopeDesdeFila(fila) {
  const datos = {
    tenantId: decimalNullable(fila.tenant_id),
    empresaId: decimalNullable(fila.empresa_id),
    sitioId: decimalNullable(fila.sitio_id)
  };
  return crearScopeFederacion({ nivel: nivel(datos), ...datos });
}

function scopeDesdeRelacion(fila) {
  const datos = {
    tenantId: decimalNullable(fila.scope_tenant_id),
    empresaId: decimalNullable(fila.scope_empresa_id),
    sitioId: decimalNullable(fila.scope_sitio_id)
  };
  return crearScopeFederacion({ nivel: nivel(datos), ...datos });
}

function familiasMaximas() {
  return Object.fromEntries(listarContratosFamiliasFederacion().map((contrato) => [
    contrato.familia,
    {
      campos: [contrato.selector.campoBase, ...contrato.selector.camposSensibles],
      permiteContenidoSensible: contrato.selector.camposSensibles.length > 0,
      permiteRefederacion: true
    }
  ]));
}

async function insertarRevisionRemota(conexion, { relacion, remota, ahora }) {
  const seleccion = canonicalizarJsonFederacion(json(remota.seleccion));
  await conexion.execute(
    `INSERT INTO revisiones_concesion_federacion (
       revision_id,relacion_id,papel,procedencia,installation_declarante_id,
       intercambio_origen_id,ordinal,estado,revision_oferta_id,
       revision_aceptacion_id,seleccion,huella_seleccion,
       autorizada_por_usuario_id,version_autoridad,version_autoridad_remota,
       creada_en_utc,vigente_desde_utc,evento_auditoria_id,correlacion_id
     ) VALUES (?, ?, ?, 'remota', ?, ?, ?, 'vigente', NULL, NULL, ?, ?,
       NULL, ?, NULL, ?, ?, ?, ?)`,
    [remota.revision_origen_id, relacion.relacion_id, remota.papel,
      remota.installation_emisora_id, remota.intercambio_id,
      String(remota.revision_ordinal), seleccion,
      createHash('sha256').update(seleccion).digest(),
      String(remota.version_autoridad), ahora, ahora, remota.intercambio_id,
      remota.intercambio_id]
  );
  await insertarSelectores(
    conexion,
    remota.revision_origen_id,
    json(remota.seleccion)
  );
}

async function insertarEfectiva(conexion, entrada) {
  const canonico = canonicalizarJsonFederacion(entrada.seleccion);
  await conexion.execute(
    `INSERT INTO revisiones_concesion_federacion (
       revision_id,relacion_id,papel,procedencia,installation_declarante_id,
       intercambio_origen_id,ordinal,estado,revision_oferta_id,
       revision_aceptacion_id,seleccion,huella_seleccion,
       autorizada_por_usuario_id,version_autoridad,version_autoridad_remota,
       creada_en_utc,vigente_desde_utc,evento_auditoria_id,correlacion_id
     ) VALUES (?, ?, 'efectiva', 'derivada', NULL, NULL, ?, ?, ?, ?, ?, ?,
       NULL, ?, ?, ?, ?, ?, ?)`,
    [entrada.revisionId, entrada.relacion.relacion_id, entrada.ordinal,
      entrada.seleccion.vacia ? 'vacia' : 'vigente', entrada.ofertaId,
      entrada.aceptacionId, canonico,
      createHash('sha256').update(canonico).digest(),
      String(entrada.relacion.version_autoridad),
      entrada.versionAutoridadRemota, entrada.ahora, entrada.ahora,
      uuidV7AuditoriaABytes(entrada.eventoId),
      uuidV7AuditoriaABytes(entrada.correlacionId)]
  );
  await insertarSelectores(conexion, entrada.revisionId, entrada.seleccion);
}

async function insertarSelectores(conexion, revisionId, seleccion) {
  for (const [familia, selector] of Object.entries(seleccion.familias || {})) {
    await conexion.execute(
      `INSERT INTO selectores_revision_concesion_federacion (
         revision_id,familia,niveles_scope,campos,
         permite_contenido_sensible,permite_refederacion
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [revisionId, familia, JSON.stringify(seleccion.nivelesScope || []),
        JSON.stringify(selector.campos), selector.permiteContenidoSensible,
        selector.permiteRefederacion]
    );
  }
}

async function buscarEfectivaFuentes(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT * FROM revisiones_concesion_federacion
     WHERE relacion_id=? AND papel='efectiva' AND revision_oferta_id=?
       AND revision_aceptacion_id=? AND version_autoridad=?
       AND version_autoridad_remota=? LIMIT 1 FOR UPDATE`,
    [entrada.relacionId, entrada.ofertaId, entrada.aceptacionId,
      entrada.versionAutoridad, entrada.versionAutoridadRemota]
  );
  return filas[0] || null;
}

async function cargarRevisionPorId(conexion, revisionId) {
  if (!revisionId) return null;
  const [filas] = await conexion.execute(
    'SELECT * FROM revisiones_concesion_federacion WHERE revision_id=? FOR UPDATE',
    [revisionId]
  );
  return filas[0] || null;
}

async function siguienteOrdinal(conexion, relacionId, papel) {
  const [filas] = await conexion.execute(
    `SELECT COALESCE(MAX(ordinal),0)+1 AS siguiente
     FROM revisiones_concesion_federacion WHERE relacion_id=? AND papel=?`,
    [relacionId, papel]
  );
  return String(filas[0].siguiente);
}

async function finalizarRevision(conexion, revisionId, estado, ahora) {
  await conexion.execute(
    `UPDATE revisiones_concesion_federacion
     SET estado=?,finalizada_en_utc=? WHERE revision_id=?`,
    [estado, ahora, revisionId]
  );
}

async function apuntarDeclaracion(conexion, relacionId, papel, revisionId, ahora) {
  const columna = papel === 'oferta'
    ? 'revision_oferta_actual_id'
    : 'revision_aceptacion_actual_id';
  await conexion.execute(
    `INSERT INTO estado_concesion_relaciones_federacion (
       relacion_id,${columna},revision,actualizada_en_utc
     ) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE
       ${columna}=VALUES(${columna}),revision=revision+1,
       actualizada_en_utc=VALUES(actualizada_en_utc)`,
    [relacionId, revisionId, ahora]
  );
}

async function apuntarEfectiva(conexion, relacionId, revisionId, ahora) {
  await conexion.execute(
    `INSERT INTO estado_concesion_relaciones_federacion (
       relacion_id,revision_efectiva_actual_id,revision,actualizada_en_utc
     ) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE
       revision_efectiva_actual_id=VALUES(revision_efectiva_actual_id),
       revision=revision+1,actualizada_en_utc=VALUES(actualizada_en_utc)`,
    [relacionId, revisionId, ahora]
  );
}

async function incrementarRevisionRelacion(conexion, relacion, ahora) {
  const [resultado] = await conexion.execute(
    `UPDATE relaciones_federacion SET revision=revision+1,actualizada_en_utc=?
     WHERE relacion_id=? AND revision=?`,
    [ahora, relacion.relacion_id, relacion.revision]
  );
  if (resultado.affectedRows !== 1) fallar('CONSOLIDACION_CONCESION_CONCURRENTE',
    'La relación cambió durante la consolidación.');
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return String(filas[0].ahora).replace(/(\.\d{3})\d+$/u, '$1');
}

function respuesta(fila, estado) {
  return Object.freeze({
    estado,
    relacionId: fila.relacion_id,
    revisionEfectivaId: fila.revision_id,
    ofertaId: fila.revision_oferta_id,
    aceptacionId: fila.revision_aceptacion_id,
    seleccion: Object.freeze(json(fila.seleccion))
  });
}

function declaracion(seleccion) {
  return crearDeclaracionConcesionFederacion(seleccion);
}

function scopeRelacion(fila) {
  return {
    tenantId: decimalNullable(fila.scope_tenant_id),
    empresaId: decimalNullable(fila.scope_empresa_id),
    sitioId: decimalNullable(fila.scope_sitio_id)
  };
}

function nivel(scope) {
  return scope.sitioId ? 'sitio'
    : scope.empresaId ? 'empresa'
      : scope.tenantId ? 'tenant' : 'portal';
}

function decimalNullable(valor) {
  return valor == null ? null : String(valor);
}

function json(valor) {
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
}

function fallar(codigo, mensaje, statusCode = 409) {
  throw new ErrorConsolidacionConcesionFederacion(
    codigo,
    mensaje,
    { statusCode }
  );
}
