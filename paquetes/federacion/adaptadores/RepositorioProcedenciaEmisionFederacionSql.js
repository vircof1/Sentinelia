import { createHash } from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

export class ErrorProcedenciaEmisionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorProcedenciaEmisionFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioProcedenciaEmisionFederacionSql {
  constructor(clienteSql, { installationLocalId, bootLocalId } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La procedencia emisora requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.installationLocalId = identidad(
      installationLocalId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationLocalId'
    );
    this.bootLocalId = identidad(
      bootLocalId,
      TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
      'bootLocalId'
    );
  }

  async resolverParaLote({ relacionId, flujoId = null, generacionId = null, candidatos } = {}) {
    const relacion = identidad(
      relacionId,
      TIPOS_IDENTIDAD_FEDERADA.RELACION,
      'relacionId'
    );
    if (!Array.isArray(candidatos) || candidatos.length === 0) {
      throw new ErrorProcedenciaEmisionFederacion(
        'candidatos_procedencia_ausentes',
        'La procedencia exige al menos una ocurrencia candidata.'
      );
    }
    const contieneRemotas = candidatos.some((candidato) =>
      candidato?.ocurrencia?.installationOrigenId !== this.installationLocalId);
    if (contieneRemotas && (!flujoId || !generacionId)) {
      throw new ErrorProcedenciaEmisionFederacion(
        'posicion_refederada_ausente',
        'Resolver una ocurrencia refederada exige su flujo y generación de salida.'
      );
    }
    const familias = new Set(candidatos.map((candidato) =>
      candidato?.ocurrencia?.familia
    ));
    if (familias.size !== 1 || ![...familias][0]) {
      throw new ErrorProcedenciaEmisionFederacion(
        'familia_lote_emision_incoherente',
        'Un lote candidato solo puede contener una familia federada.'
      );
    }
    const familia = [...familias][0];
    const filas = await this.clienteSql.consultar(
      `SELECT e.revision_efectiva_actual_id,s.campos,s.niveles_scope,
              s.permite_contenido_sensible,s.permite_refederacion,
              r.scope_tenant_id,r.scope_empresa_id,r.scope_sitio_id,
              DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') AS emitido_utc
         FROM relaciones_federacion r
         JOIN estado_concesion_relaciones_federacion e
           ON e.relacion_id=r.relacion_id
         JOIN revisiones_concesion_federacion v
           ON v.relacion_id=r.relacion_id
          AND v.revision_id=e.revision_efectiva_actual_id
          AND v.papel='efectiva'
          AND v.estado='vigente' AND v.finalizada_en_utc IS NULL
         LEFT JOIN selectores_revision_concesion_federacion s
           ON s.revision_id=v.revision_id AND s.familia=?
        WHERE r.relacion_id=? AND r.direccion='emision'
          AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
          AND r.estado_identidad='valida'
          AND r.estado_compatibilidad IN ('compatible','compatibleParcial')
        LIMIT 1`,
      [familia, relacion]
    );
    if (!filas[0]?.revision_efectiva_actual_id) {
      throw new ErrorProcedenciaEmisionFederacion(
        'revision_efectiva_emision_ausente',
        'La relación no posee una revisión efectiva apta para emitir.'
      );
    }
    const emitidoUtc = `${String(filas[0].emitido_utc).slice(0, 23)}Z`;
    const procedencia = Object.freeze({
      installationEmisoraId: this.installationLocalId,
      bootEmisorId: this.bootLocalId,
      recorridoInstalaciones: Object.freeze([this.installationLocalId]),
      tiemposSaltosDisponibles: Object.freeze([Object.freeze({
        installationId: this.installationLocalId,
        bootId: this.bootLocalId,
        recibidoUtc: null,
        emitidoUtc
      })])
    });
    const selector = Object.freeze({
      disponible: filas[0].campos !== null,
      campos: new Set(parsearListaNullable(filas[0].campos)),
      nivelesScope: new Set(parsearListaNullable(filas[0].niveles_scope)),
      permiteContenidoSensible: Boolean(filas[0].permite_contenido_sensible),
      permiteRefederacion: Boolean(filas[0].permite_refederacion),
      scopeRelacion: Object.freeze({
        tenantId: textoNullable(filas[0].scope_tenant_id),
        empresaId: textoNullable(filas[0].scope_empresa_id),
        sitioId: textoNullable(filas[0].scope_sitio_id)
      })
    });
    const ocurrenciasAutorizadas = new Map();
    const procedencias = new Map();
    for (const candidato of candidatos) {
      const esLocal = candidato.ocurrencia.installationOrigenId === this.installationLocalId;
      const esTerminal = candidato.ocurrencia.operacion !== 'actualizacion';
      if (!esLocal && !selector.permiteRefederacion && !esTerminal) {
        throw new ErrorProcedenciaEmisionFederacion(
          'refederacion_no_autorizada_actualmente',
          'La concesión efectiva ya no permite emitir nuevas copias remotas.'
        );
      }
      if ((esLocal || !esTerminal) && !selector.disponible) {
        throw new ErrorProcedenciaEmisionFederacion(
          'selector_emision_ausente',
          'La concesión efectiva no selecciona la familia de la ocurrencia.'
        );
      }
      if (esLocal) exigirScopeAutorizado(candidato.ocurrencia, selector);
      ocurrenciasAutorizadas.set(
        candidato.entregaId,
        esTerminal && !selector.disponible
          ? clonar(candidato.ocurrencia)
          : sanearOcurrencia(candidato.ocurrencia, selector)
      );
      procedencias.set(
        candidato.entregaId,
        esLocal
          ? procedencia
          : await resolverProcedenciaRefederada(this.clienteSql, {
            flujoId,
            generacionId,
            relacionId: relacion,
            candidato,
            selector,
            exigirScopeLocal: !esTerminal,
            installationLocalId: this.installationLocalId,
            bootLocalId: this.bootLocalId,
            emitidoUtc
          })
      );
    }
    return Object.freeze({
      revisionConcesionEfectiva: filas[0].revision_efectiva_actual_id,
      ocurrenciasAutorizadas: Object.freeze(ocurrenciasAutorizadas),
      procedencias: Object.freeze(procedencias)
    });
  }
}

function sanearOcurrencia(ocurrencia, selector) {
  const campos = Object.fromEntries(Object.entries(ocurrencia.campos || {}).map(
    ([nombre, declaracion]) => [
      nombre,
      campoAutorizado({ nombre, declaracion, ocurrencia, selector })
        ? clonar(declaracion)
        : { estado: 'omitido', causa: 'noAutorizado' }
    ]
  ));
  return Object.freeze({ ...clonar(ocurrencia), campos });
}

function campoAutorizado({ nombre, declaracion, ocurrencia, selector }) {
  if (!selector.campos.has(nombre)) return false;
  if (declaracion?.estado !== 'presente' || declaracion.sensibilidad !== 'sensible') {
    return true;
  }
  if (!selector.permiteContenidoSensible) return false;
  return sensiblesPresentes(ocurrencia.familia, declaracion.valor)
    .every((campo) => selector.campos.has(campo));
}

function sensiblesPresentes(familia, payload) {
  const tipo = payload?.tipoRegistro;
  if (familia === 'monitores') {
    return payload?.credencialPropia?.estado === 'presente' ? ['credencialPropia'] : [];
  }
  if (familia === 'triggersInformativos') {
    if (tipo === 'definicion') {
      return payload?.contenidoSensible?.estado === 'presente'
        ? ['contenidoSensibleDefinicion'] : [];
    }
    if (tipo === 'asignacionMonitor') {
      return payload?.contenidoSensible?.estado === 'presente'
        ? ['contenidoSensibleAsignacion'] : [];
    }
    return ['payloadSolicitud', 'payloadRespuesta', 'payloadError']
      .filter((campo) => payload?.[campo]?.estado === 'presente');
  }
  if (familia === 'auditoria') return ['payloadCompleto'];
  if (familia === 'avisosFederados') {
    return [payload?.actor, payload?.actorUltimaTransicion]
      .some((actor) => actor?.estado === 'visible') ? ['actorVisible'] : [];
  }
  return [];
}

function exigirScopeAutorizado(ocurrencia, selector) {
  const scope = ocurrencia?.scopeOrigenDeclarado;
  if (!scope || !selector.nivelesScope.has(scope.nivel) ||
      !scopeContenidoEnRelacion(scope, selector.scopeRelacion)) {
    throw new ErrorProcedenciaEmisionFederacion(
      'scope_ocurrencia_fuera_concesion_actual',
      'La ocurrencia dejó de pertenecer al scope de la concesión efectiva.'
    );
  }
}

function scopeContenidoEnRelacion(scope, limite) {
  if (limite.tenantId !== null && textoNullable(scope.tenantId) !== limite.tenantId) {
    return false;
  }
  if (limite.empresaId !== null && textoNullable(scope.empresaId) !== limite.empresaId) {
    return false;
  }
  return limite.sitioId === null || textoNullable(scope.sitioId) === limite.sitioId;
}

function parsearLista(valor) {
  const lista = typeof valor === 'string' ? JSON.parse(valor) : valor;
  if (!Array.isArray(lista) || lista.some((elemento) => typeof elemento !== 'string')) {
    throw new ErrorProcedenciaEmisionFederacion(
      'selector_concesion_emision_invalido',
      'La concesión efectiva contiene un selector no interpretable.'
    );
  }
  return lista;
}

function parsearListaNullable(valor) {
  return valor === null || valor === undefined ? [] : parsearLista(valor);
}

async function resolverProcedenciaRefederada(clienteSql, {
  flujoId,
  generacionId,
  relacionId,
  candidato,
  selector,
  exigirScopeLocal,
  installationLocalId,
  bootLocalId,
  emitidoUtc
}) {
  const filas = await clienteSql.consultar(
    `SELECT d.procedencia_base_canonica,d.procedencia_base_sha256,
            d.longitud_recorrido_base,d.recibida_origen_en_utc,p.scope_nivel,
            p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
            r.scope_tenant_id AS limite_tenant_id,
            r.scope_empresa_id AS limite_empresa_id,
            r.scope_sitio_id AS limite_sitio_id
       FROM descendientes_refederacion_federacion d
       JOIN proyecciones_federacion p ON p.proyeccion_id=d.proyeccion_origen_id
       JOIN relaciones_federacion r ON r.relacion_id=d.relacion_destino_id
      WHERE d.flujo_destino_id=? AND d.generacion_destino_id=?
        AND d.posicion_flujo=?
        AND d.relacion_destino_id=?
        AND EXISTS (
          SELECT 1 FROM posiciones_ocurrencias_flujos_federacion po
           WHERE po.flujo_id=d.flujo_destino_id
             AND po.generacion_id=d.generacion_destino_id
             AND po.posicion_flujo=d.posicion_flujo
             AND po.installation_origen_id=? AND po.familia=?
             AND po.elemento_origen_id=? AND po.ocurrencia_origen_id=?
        )
      LIMIT 1`,
    [
      flujoId,
      generacionId,
      candidato.posicionFlujo,
      relacionId,
      candidato.ocurrencia.installationOrigenId,
      candidato.ocurrencia.familia,
      candidato.ocurrencia.elementoOrigenId,
      candidato.ocurrencia.ocurrenciaOrigenId
    ]
  );
  const fila = filas[0];
  if (!fila) {
    throw new ErrorProcedenciaEmisionFederacion(
      'descendiente_refederado_no_testimoniado',
      'La posición remota carece del descendiente durable que prueba su recorrido.'
    );
  }
  if (exigirScopeLocal && (
    !selector.nivelesScope.has(fila.scope_nivel) ||
    !scopeLocalContenidoEnRelacion(fila)
  )) {
    throw new ErrorProcedenciaEmisionFederacion(
      'scope_refederado_fuera_concesion_actual',
      'La proyección remota dejó de pertenecer al scope local de la concesión efectiva.'
    );
  }
  const base = typeof fila.procedencia_base_canonica === 'string'
    ? JSON.parse(fila.procedencia_base_canonica)
    : fila.procedencia_base_canonica;
  const canonica = canonicalizarJsonFederacion(base);
  const esperada = Buffer.from(fila.procedencia_base_sha256);
  const observada = await importarHash(canonica);
  if (!esperada.equals(observada)) {
    throw new ErrorProcedenciaEmisionFederacion(
      'procedencia_refederada_corrupta',
      'La procedencia durable no coincide con su huella de integridad.'
    );
  }
  if (base.recorridoInstalaciones.length !== Number(fila.longitud_recorrido_base) ||
      base.recorridoInstalaciones.includes(installationLocalId)) {
    throw new ErrorProcedenciaEmisionFederacion(
      'recorrido_refederado_incoherente',
      'El recorrido durable no puede incorporar dos veces la instalación emisora.'
    );
  }
  return Object.freeze({
    installationEmisoraId: installationLocalId,
    bootEmisorId: bootLocalId,
    recorridoInstalaciones: Object.freeze([
      ...base.recorridoInstalaciones,
      installationLocalId
    ]),
    tiemposSaltosDisponibles: Object.freeze([
      ...base.tiemposSaltosDisponibles.map((salto) => Object.freeze(clonar(salto))),
      Object.freeze({
        installationId: installationLocalId,
        bootId: bootLocalId,
        recibidoUtc: fechaIso(fila.recibida_origen_en_utc),
        emitidoUtc
      })
    ])
  });
}

function scopeLocalContenidoEnRelacion(fila) {
  if (fila.limite_tenant_id !== null &&
      textoNullable(fila.scope_tenant_id) !== textoNullable(fila.limite_tenant_id)) {
    return false;
  }
  if (fila.limite_empresa_id !== null &&
      textoNullable(fila.scope_empresa_id) !== textoNullable(fila.limite_empresa_id)) {
    return false;
  }
  return fila.limite_sitio_id === null ||
    textoNullable(fila.scope_sitio_id) === textoNullable(fila.limite_sitio_id);
}

async function importarHash(valor) {
  return createHash('sha256').update(valor, 'utf8').digest();
}

function fechaIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return `${String(valor).replace(' ', 'T').slice(0, 23)}Z`;
}

function textoNullable(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch (error) {
    throw new ErrorProcedenciaEmisionFederacion(
      'identidad_procedencia_invalida',
      `${campo} no es canónica: ${error.message}`
    );
  }
}
