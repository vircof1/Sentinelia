import { createHash, timingSafeEqual } from 'node:crypto';

import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearObligacionPostcommitEliminacionAgente,
  PERFIL_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE
} from './ContratoEliminacionAdministrativaAgente.js';
import { ErrorEjecucionOperacionAdministrativa }
  from './ProcesadorOperacionesAdministrativas.js';

const RETENCION_OBLIGACIONES_DIAS = 90;
const CODIGO = /^[a-z][a-z0-9_]{0,63}$/u;
const DECIMAL_POSITIVO = /^[1-9][0-9]*$/u;

export class ErrorPreparacionEliminacionAgregadoAgente extends
  ErrorEjecucionOperacionAdministrativa {
  constructor(codigo, mensaje) {
    super(codigo, mensaje, { permanente: true });
    this.name = 'ErrorPreparacionEliminacionAgregadoAgente';
  }
}

export class NucleoPreparacionDependenciasAgenteEnTransaccion {
  constructor({
    repositorioDependencias,
    servicioRetiradaFederada,
    repositorioOperacionesSesion,
    repositorioObligacionesPostcommit,
    crearObligacionPostcommit = crearObligacionAgente,
    ahora = () => new Date(),
    retencionObligacionesDias = RETENCION_OBLIGACIONES_DIAS
  } = {}) {
    exigirPuerto(
      repositorioDependencias,
      'cargarContextoSesionBloqueadaEnTransaccion'
    );
    exigirPuerto(
      repositorioDependencias,
      'eliminarEjecucionesTriggersEnTransaccion'
    );
    exigirPuerto(servicioRetiradaFederada, 'prepararEnTransaccion');
    exigirPuerto(
      repositorioOperacionesSesion,
      'neutralizarPorEliminacionEnTransaccion'
    );
    exigirPuerto(
      repositorioObligacionesPostcommit,
      'crearORecuperarVariasEnTransaccion'
    );
    if (typeof crearObligacionPostcommit !== 'function') {
      throw new TypeError('La fábrica de obligaciones debe ser invocable.');
    }
    if (typeof ahora !== 'function') throw new TypeError('ahora debe ser invocable.');
    if (!Number.isInteger(retencionObligacionesDias) || retencionObligacionesDias < 1) {
      throw new TypeError('retencionObligacionesDias debe ser un entero positivo.');
    }
    Object.assign(this, {
      repositorioDependencias,
      servicioRetiradaFederada,
      repositorioOperacionesSesion,
      repositorioObligacionesPostcommit,
      crearObligacionPostcommit,
      ahora,
      retencionObligacionesDias
    });
  }

  async prepararEnTransaccion({
    agenteActual,
    operacionCausal,
    actores,
    scope,
    dependencias
  } = {}, { conexion } = {}) {
    const entrada = normalizarEntrada({
      agenteActual,
      operacionCausal,
      actores,
      scope,
      dependencias
    });
    if (!conexion || typeof conexion !== 'object') {
      throw new TypeError('El núcleo exige una conexión SQL prestada.');
    }

    const agenteId = entrada.agenteActual.id;
    const contextoSesion = await this.repositorioDependencias
      .cargarContextoSesionBloqueadaEnTransaccion({ agenteId }, { conexion });
    if (!contextoSesion) {
      throw estructuraModificada('El agente desapareció durante su preparación.');
    }

    let retiradasFederadas;
    try {
      retiradasFederadas = await this.servicioRetiradaFederada
        .prepararEnTransaccion({ agenteId }, { conexion });
    } catch (error) {
      if (/^identidad_/u.test(String(error?.codigo || ''))) {
        throw new ErrorPreparacionEliminacionAgregadoAgente(
          'agente_eliminacion_identidad_federada_incompleta',
          'La identidad federada del agregado no permite preparar una retirada completa.'
        );
      }
      throw error;
    }

    const neutralizacionSesion = await this.repositorioOperacionesSesion
      .neutralizarPorEliminacionEnTransaccion(
        crearEntradaNeutralizacion({ ...entrada, contextoSesion }),
        { conexion }
      );
    const fechaCreacion = fechaValida(this.ahora(), 'ahora');
    const retenerHasta = new Date(
      fechaCreacion.getTime() + this.retencionObligacionesDias * 86_400_000
    );
    const obligaciones = crearDescriptoresObligaciones({
      ...entrada,
      neutralizacionSesion
    }).map((descriptor) => this.crearObligacionPostcommit(descriptor));
    const obligacionesPostcommit = await this.repositorioObligacionesPostcommit
      .crearORecuperarVariasEnTransaccion({
        obligaciones,
        creadaEnUtc: fechaCreacion,
        retenerHastaUtc: retenerHasta
      }, { conexion });

    const cantidadEjecuciones = conteo(
      entrada.dependencias.conteosFinales,
      'ejecuciones_trigger'
    );
    const cantidadCorreoAceptado = conteo(
      entrada.dependencias.conteosFinales,
      'correo_aceptado_preservadas'
    );
    let ejecucionesTriggers;
    try {
      ejecucionesTriggers = await this.repositorioDependencias
        .eliminarEjecucionesTriggersEnTransaccion({
          monitorIds: entrada.dependencias.conjuntosEstructurales.monitores,
          cantidadEsperada: cantidadEjecuciones,
          cantidadCorreoAceptadoEsperada: cantidadCorreoAceptado
        }, { conexion });
    } catch (error) {
      if (error?.codigo === 'agente_eliminacion_impacto_no_seguro') {
        throw new ErrorPreparacionEliminacionAgregadoAgente(
          error.codigo,
          error.message
        );
      }
      throw error;
    }

    return congelar({
      agenteId,
      retiradasFederadas,
      neutralizacionSesion,
      obligacionesPostcommit,
      ejecucionesTriggers,
      postcondicionesEsperadas: {
        agenteId,
        raizAntesDelDelete: '1',
        ejecucionesTriggers: '0',
        correoAceptadoPreservadas:
          ejecucionesTriggers.correoAceptadoPreservadas,
        obligacionesPostcommit: String(obligacionesPostcommit.length),
        operacionesSesionReemplazadas:
          String(neutralizacionSesion.operacionesReemplazadas)
      }
    });
  }
}

function normalizarEntrada(entrada) {
  const agenteId = decimalPositivo(entrada.agenteActual?.id, 'agenteActual.id');
  const operacionId = uuidV7AuditoriaABytes(
    entrada.operacionCausal?.operacionId,
    'operacionCausal.operacionId'
  );
  const tipo = String(entrada.operacionCausal?.tipo || '');
  const version = Number(entrada.operacionCausal?.version);
  if (!CODIGO.test(tipo) || !Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('La operación causal no posee contrato válido.');
  }
  const real = normalizarActor(entrada.actores?.real, 'actores.real');
  const efectivo = normalizarActor(entrada.actores?.efectivo, 'actores.efectivo');
  const destinatario = entrada.actores?.destinatarioUsuarioId == null
    ? null
    : decimalPositivo(
        entrada.actores.destinatarioUsuarioId,
        'actores.destinatarioUsuarioId'
      );
  const scope = normalizarScope(entrada.scope);
  const conteosFinales = Array.isArray(entrada.dependencias?.conteosFinales)
    ? structuredClone(entrada.dependencias.conteosFinales)
    : null;
  const conjuntos = entrada.dependencias?.conjuntosEstructurales;
  if (!conteosFinales || !conjuntos || !Array.isArray(conjuntos.monitores) ||
      !Array.isArray(conjuntos.perfilesServidor)) {
    throw new TypeError('Las dependencias actuales del agente no son válidas.');
  }
  return congelar({
    agenteActual: { ...structuredClone(entrada.agenteActual), id: agenteId },
    operacionCausal: {
      operacionId: bytesAUuidV7Auditoria(operacionId),
      tipo,
      version
    },
    actores: { real, efectivo, destinatarioUsuarioId: destinatario },
    scope,
    dependencias: {
      conteosFinales,
      conjuntosEstructurales: {
        ...structuredClone(conjuntos),
        monitores: normalizarIds(conjuntos.monitores, 'dependencias.monitores'),
        perfilesServidor: normalizarIds(
          conjuntos.perfilesServidor,
          'dependencias.perfilesServidor'
        )
      }
    }
  });
}

function normalizarActor(actor, campo) {
  return congelar({
    usuarioId: decimalPositivo(actor?.usuarioId, `${campo}.usuarioId`)
  });
}

function normalizarScope(scope) {
  const nivel = String(scope?.nivel || '');
  if (nivel !== 'sitio') throw new TypeError('El agente actual exige scope de sitio.');
  const ids = {};
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    ids[campo] = scope?.[campo] == null
      ? null
      : decimalPositivo(scope[campo], `scope.${campo}`);
  }
  if (ids.tenantId === null || ids.empresaId === null || ids.sitioId === null) {
    throw new TypeError('El scope actual del agente está incompleto.');
  }
  return congelar({ nivel, ...ids });
}

function crearEntradaNeutralizacion({
  agenteActual,
  operacionCausal,
  actores,
  scope,
  contextoSesion
}) {
  const sesionAuditoriaId = contextoSesion.sesionAuditoriaIdBytes
    ? bytesAUuidV7Auditoria(contextoSesion.sesionAuditoriaIdBytes)
    : null;
  const entrada = {
    operacionId: derivarIdentidadEfecto(
      operacionCausal,
      agenteActual.id,
      'sesion-invalidacion'
    ),
    causaOperacionId: operacionCausal.operacionId,
    agenteId: agenteActual.id,
    sesionAuditoriaId,
    actor: { tipo: 'usuario', id: actores.real.usuarioId },
    actorEfectivo: actores.efectivo.usuarioId === actores.real.usuarioId
      ? null
      : { tipo: 'usuario', id: actores.efectivo.usuarioId },
    origen: 'tarea_sistema',
    scope: {
      tenantId: scope.tenantId,
      empresaId: scope.empresaId,
      sitioId: scope.sitioId
    }
  };
  if (!sesionAuditoriaId) return entrada;
  return {
    ...entrada,
    huellaIntencion: createHash('sha256')
      .update(canonicalizarRfc8785(entrada), 'utf8')
      .digest()
  };
}

function crearDescriptoresObligaciones({
  agenteActual,
  operacionCausal,
  actores,
  dependencias,
  neutralizacionSesion
}) {
  const agenteId = agenteActual.id;
  const objetivos = [];
  const operacionesSesion = new Set(
    neutralizacionSesion.retiradasPendientes.map(({ operacionId }) => operacionId)
  );
  if (neutralizacionSesion.operacion?.operacionId) {
    operacionesSesion.add(neutralizacionSesion.operacion.operacionId);
  }
  for (const operacionSesionId of [...operacionesSesion].sort()) {
    objetivos.push({
      tipo: 'retirar_sesion_redis',
      objetivo: { agenteId, operacionSesionId }
    });
  }
  for (const generacionPerfil of [
    ...dependencias.conjuntosEstructurales.perfilesServidor
  ].sort(compararDecimales)) {
    objetivos.push(
      {
        tipo: 'retirar_perfil_servidor_redis',
        objetivo: { agenteId, generacionPerfil }
      },
      {
        tipo: 'retirar_agenda_servidor_redis',
        objetivo: { agenteId, generacionPerfil }
      }
    );
  }
  if (dependencias.conjuntosEstructurales.monitores.length > 0) {
    objetivos.push({
      tipo: 'invalidar_catalogo_monitores',
      objetivo: { agenteId }
    });
  }
  if (actores.destinatarioUsuarioId !== null) {
    objetivos.push({
      tipo: 'publicar_invalidacion_portal',
      objetivo: { destinatarioUsuarioId: actores.destinatarioUsuarioId }
    });
  }
  return objetivos.map(({ tipo, objetivo }) => ({
    obligacionId: derivarIdentidadEfecto(
      operacionCausal,
      agenteId,
      `obligacion:${tipo}:${canonicalizarRfc8785(objetivo)}`
    ),
    operacionId: operacionCausal.operacionId,
    tipo,
    objetivo
  }));
}

function crearObligacionAgente(entrada) {
  return crearObligacionPostcommitEliminacionAgente({
    perfil: PERFIL_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE,
    version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
    ...entrada
  });
}

function derivarIdentidadEfecto(operacionCausal, agenteId, efecto) {
  const padreBytes = uuidV7AuditoriaABytes(
    operacionCausal.operacionId,
    'operacionCausal.operacionId'
  );
  const etiqueta = [
    `${operacionCausal.tipo}@${operacionCausal.version}`,
    `agente:${agenteId}`,
    efecto
  ].join('\0');
  const salida = createHash('sha256')
    .update(padreBytes)
    .update('\0', 'utf8')
    .update(etiqueta, 'utf8')
    .digest()
    .subarray(0, 16);
  padreBytes.copy(salida, 0, 0, 6);
  salida[6] = 0x70 | (salida[6] & 0x0f);
  salida[8] = 0x80 | (salida[8] & 0x3f);
  if (timingSafeEqual(salida, padreBytes)) salida[15] ^= 0x01;
  return bytesAUuidV7Auditoria(salida);
}

function conteo(conteos, categoria) {
  const encontrado = conteos.find((item) => item.categoria === categoria);
  if (!encontrado || !/^(0|[1-9][0-9]*)$/u.test(String(encontrado.cantidad))) {
    throw estructuraModificada(`El impacto final no contiene ${categoria}.`);
  }
  return String(encontrado.cantidad);
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!DECIMAL_POSITIVO.test(texto)) throw new TypeError(`${campo} no es válido.`);
  return texto;
}

function normalizarIds(valores, campo) {
  const normalizados = valores.map((valor, indice) =>
    decimalPositivo(valor, `${campo}[${indice}]`)
  );
  if (new Set(normalizados).size !== normalizados.length) {
    throw new TypeError(`${campo} contiene identidades duplicadas.`);
  }
  return normalizados;
}

function compararDecimales(a, b) {
  const izquierda = BigInt(a);
  const derecha = BigInt(b);
  return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
}

function fechaValida(valor, campo) {
  const fecha = valor instanceof Date ? new Date(valor) : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new TypeError(`${campo} no es una fecha válida.`);
  }
  return fecha;
}

function estructuraModificada(mensaje) {
  return new ErrorPreparacionEliminacionAgregadoAgente(
    'agente_eliminacion_estructura_modificada',
    mensaje
  );
}

function exigirPuerto(puerto, metodo) {
  if (typeof puerto?.[metodo] !== 'function') {
    throw new Error(`El núcleo preparador exige el puerto ${metodo}.`);
  }
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
