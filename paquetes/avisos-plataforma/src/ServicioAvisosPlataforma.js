import {
  GRAVEDADES_AVISO_PLATAFORMA,
  obtenerCausaAvisoPlataforma
} from './CatalogoAvisosPlataforma.js';
import {
  construirClaveCausalAvisoPlataforma
} from './ClaveCausalAvisoPlataforma.js';
import {
  generarIdAvisoPlataforma,
  validarIdAvisoPlataforma
} from './IdentidadAvisoPlataforma.js';

const RANGO_GRAVEDAD = new Map(
  GRAVEDADES_AVISO_PLATAFORMA.map((gravedad, indice) => [gravedad, indice])
);

export class ServicioAvisosPlataforma {
  constructor({ repositorioAvisos } = {}) {
    if (typeof repositorioAvisos?.aplicarAtomico !== 'function') {
      throw new Error('ServicioAvisosPlataforma requiere repositorio transaccional.');
    }
    this.repositorioAvisos = repositorioAvisos;
  }

  detectar(entrada = {}, { conexion = null } = {}) {
    const solicitud = validarBase(entrada, [
      'actor',
      'causalidad',
      'claveCausal',
      'contextoHumano',
      'correlacionId',
      'efectivoEnUtc',
      'eventoId',
      'resumen'
    ]);
    validarActorRuntime(solicitud.actor);
    const causa = obtenerCausaAvisoPlataforma(solicitud.claveCausal);
    const operacion = {
      claveCausalHex: solicitud.clave.hashHex,
      eventoId: solicitud.eventoId,
      tipoSolicitud: 'deteccion',
      decidir: ({ ciclo, ahoraSql }) => decidirDeteccion({
        solicitud,
        causa,
        ciclo,
        ahoraSql
      })
    };
    return conexion
      ? this.repositorioAvisos.aplicarEnTransaccion(operacion, { conexion })
      : this.repositorioAvisos.aplicarAtomico(operacion);
  }

  cambiarGravedad(entrada = {}, { conexion = null } = {}) {
    const solicitud = validarBase(entrada, [
      'actor',
      'causalidad',
      'claveCausal',
      'correlacionId',
      'efectivoEnUtc',
      'eventoId',
      'gravedad'
    ]);
    validarActorRuntime(solicitud.actor);
    exigir(RANGO_GRAVEDAD.has(entrada.gravedad), 'La gravedad no pertenece al catálogo.');
    solicitud.gravedad = entrada.gravedad;
    const operacion = {
      claveCausalHex: solicitud.clave.hashHex,
      eventoId: solicitud.eventoId,
      tipoSolicitud: 'gravedad',
      decidir: ({ ciclo, ahoraSql }) => decidirGravedad({ solicitud, ciclo, ahoraSql })
    };
    return conexion
      ? this.repositorioAvisos.aplicarEnTransaccion(operacion, { conexion })
      : this.repositorioAvisos.aplicarAtomico(operacion);
  }

  resolver(entrada = {}, { conexion = null } = {}) {
    const solicitud = validarBase(entrada, [
      'actor',
      'causalidad',
      'claveCausal',
      'correlacionId',
      'efectivoEnUtc',
      'eventoId',
      'viaResolucion'
    ]);
    exigir(
      ['causa_desaparecida', 'administrativa'].includes(entrada.viaResolucion),
      'viaResolucion no pertenece al contrato cerrado.'
    );
    solicitud.viaResolucion = entrada.viaResolucion;
    const causa = obtenerCausaAvisoPlataforma(solicitud.claveCausal);
    if (solicitud.viaResolucion === 'administrativa') {
      validarActorUsuario(solicitud.actor);
      exigir(
        causa.admiteResolucionAdministrativa,
        'La causa no admite resolución administrativa.'
      );
    } else {
      validarActorRuntime(solicitud.actor);
    }
    const operacion = {
      claveCausalHex: solicitud.clave.hashHex,
      eventoId: solicitud.eventoId,
      tipoSolicitud: 'resolucion',
      decidir: ({ ciclo, ahoraSql }) => decidirResolucion({
        solicitud,
        ciclo,
        ahoraSql
      })
    };
    return conexion
      ? this.repositorioAvisos.aplicarEnTransaccion(operacion, { conexion })
      : this.repositorioAvisos.aplicarAtomico(operacion);
  }
}

function decidirDeteccion({ solicitud, causa, ciclo, ahoraSql }) {
  validarNoFuturo(solicitud.efectivoSql, ahoraSql);
  if (ciclo?.estadoCiclo === 'pendiente') {
    const aviso = {
      ...ciclo,
      ultimaDeteccionUtc: maxFecha(ciclo.ultimaDeteccionUtc, solicitud.efectivoSql),
      contadorDetecciones: ciclo.contadorDetecciones + 1,
      contextoHumano: solicitud.contextoHumano,
      resumen: solicitud.resumen,
      eventoUltimaTransicionId: solicitud.eventoId
    };
    return decisionActualizar({
      solicitud,
      aviso,
      anterior: ciclo,
      transicionTipo: 'confirmacion_tecnica',
      resultado: 'consolidado',
      detalle: { causa: 'deteccion_repetida' },
      ahoraSql
    });
  }

  if (ciclo) {
    const fronteraTerminal = ciclo.resueltoEnUtc || ciclo.obsoletoEnUtc ||
      ciclo.ultimaDeteccionUtc;
    if (solicitud.efectivoSql < fronteraTerminal) {
      return { tipo: 'sin_cambios' };
    }
  }

  const reabre = ciclo?.estadoCiclo === 'resuelto';
  const avisoId = generarIdAvisoPlataforma();
  const aviso = {
    avisoId,
    versionCatalogo: solicitud.claveCausal.versionCatalogo,
    tipoCodigo: solicitud.claveCausal.tipoCodigo,
    causaCodigo: solicitud.claveCausal.causaCodigo,
    claveCausalHex: solicitud.clave.hashHex,
    estadoCiclo: 'pendiente',
    gravedad: causa.gravedadInicial,
    scope: solicitud.claveCausal.scope,
    objetoTipo: solicitud.claveCausal.objetoTipo,
    objetoId: solicitud.claveCausal.objetoId,
    relacionId: solicitud.claveCausal.relacionId,
    flujoId: solicitud.claveCausal.flujoId,
    cicloAnteriorId: ciclo?.avisoId || null,
    primeraDeteccionUtc: solicitud.efectivoSql,
    ultimaDeteccionUtc: solicitud.efectivoSql,
    resueltoEnUtc: null,
    obsoletoEnUtc: null,
    contadorDetecciones: 1,
    contextoHumano: solicitud.contextoHumano,
    resumen: solicitud.resumen,
    correlacionAperturaId: solicitud.correlacionId,
    eventoAperturaId: solicitud.eventoId,
    eventoUltimaTransicionId: solicitud.eventoId
  };
  const historico = crearHistorico({
    aviso,
    solicitud,
    ordinal: 1,
    transicionTipo: reabre ? 'reapertura' : 'apertura',
    estadoAnterior: null,
    gravedadAnterior: null,
    detalle: {
      causa: reabre ? 'recurrencia_posterior' : 'primera_deteccion'
    },
    ahoraSql
  });
  return {
    tipo: 'insertar',
    resultado: reabre ? 'reabierto' : 'abierto',
    aviso,
    historico,
    auditoria: crearAuditoria({
      solicitud,
      aviso,
      tipoEvento: reabre
        ? 'plataforma.aviso_reabierto'
        : 'plataforma.aviso_abierto',
      estadoAntes: reabre ? 'resuelto' : null,
      gravedadAntes: reabre ? ciclo.gravedad : null,
      cicloAnteriorId: ciclo?.avisoId || null
    })
  };
}

function decidirGravedad({ solicitud, ciclo, ahoraSql }) {
  validarNoFuturo(solicitud.efectivoSql, ahoraSql);
  exigir(ciclo?.estadoCiclo === 'pendiente', 'No existe un aviso pendiente para cambiar su gravedad.');
  if (ciclo.gravedad === solicitud.gravedad) return { tipo: 'sin_cambios' };
  const sube = RANGO_GRAVEDAD.get(solicitud.gravedad) > RANGO_GRAVEDAD.get(ciclo.gravedad);
  const aviso = {
    ...ciclo,
    gravedad: solicitud.gravedad,
    eventoUltimaTransicionId: solicitud.eventoId
  };
  return decisionActualizar({
    solicitud,
    aviso,
    anterior: ciclo,
    transicionTipo: sube ? 'escalado' : 'desescalado',
    resultado: sube ? 'escalado' : 'desescalado',
    detalle: { causa: 'regla_local_gravedad' },
    ahoraSql
  });
}

function decidirResolucion({ solicitud, ciclo, ahoraSql }) {
  validarNoFuturo(solicitud.efectivoSql, ahoraSql);
  if (!ciclo || ciclo.estadoCiclo !== 'pendiente') return { tipo: 'sin_cambios' };
  exigir(
    solicitud.efectivoSql >= ciclo.ultimaDeteccionUtc,
    'La resolución no puede preceder a la última detección consolidada.'
  );
  const aviso = {
    ...ciclo,
    estadoCiclo: 'resuelto',
    resueltoEnUtc: solicitud.efectivoSql,
    eventoUltimaTransicionId: solicitud.eventoId
  };
  return decisionActualizar({
    solicitud,
    aviso,
    anterior: ciclo,
    transicionTipo: 'resolucion',
    resultado: 'resuelto',
    detalle: { via: solicitud.viaResolucion },
    ahoraSql
  });
}

function decisionActualizar({
  solicitud,
  aviso,
  anterior,
  transicionTipo,
  resultado,
  detalle,
  ahoraSql
}) {
  return {
    tipo: 'actualizar',
    resultado,
    aviso,
    historico: crearHistorico({
      aviso,
      solicitud,
      ordinal: anterior.ultimoOrdinal + 1,
      transicionTipo,
      estadoAnterior: anterior.estadoCiclo,
      gravedadAnterior: anterior.gravedad,
      detalle,
      ahoraSql
    }),
    auditoria: crearAuditoria({
      solicitud,
      aviso,
      tipoEvento: transicionTipo === 'resolucion'
        ? 'plataforma.aviso_resuelto'
        : 'plataforma.aviso_actualizado',
      estadoAntes: anterior.estadoCiclo,
      gravedadAntes: anterior.gravedad,
      cicloAnteriorId: null
    })
  };
}

function crearHistorico({
  aviso,
  solicitud,
  ordinal,
  transicionTipo,
  estadoAnterior,
  gravedadAnterior,
  detalle,
  ahoraSql
}) {
  return {
    avisoId: aviso.avisoId,
    ordinal,
    transicionTipo,
    estadoAnterior,
    estadoNuevo: aviso.estadoCiclo,
    gravedadAnterior,
    gravedadNueva: aviso.gravedad,
    contadorDetecciones: aviso.contadorDetecciones,
    efectivoEnUtc: solicitud.efectivoSql,
    registradoEnUtc: ahoraSql,
    eventoAuditoriaId: solicitud.eventoId,
    correlacionId: solicitud.correlacionId,
    detalle,
    contextoHumano: aviso.contextoHumano,
    resumen: aviso.resumen
  };
}

function crearAuditoria({
  solicitud,
  aviso,
  tipoEvento,
  estadoAntes,
  gravedadAntes,
  cicloAnteriorId
}) {
  return {
    avisoId: aviso.avisoId,
    eventoId: solicitud.eventoId,
    correlacionId: solicitud.correlacionId,
    efectivoEnUtc: solicitud.efectivoEnUtc,
    tipoEvento,
    estadoAntes,
    estadoDespues: aviso.estadoCiclo,
    gravedadAntes,
    gravedadDespues: aviso.gravedad,
    causaCodigo: aviso.causaCodigo,
    cicloAnteriorId,
    scope: aviso.scope,
    actor: solicitud.actor,
    causalidad: solicitud.causalidad
  };
}

function validarBase(entrada, campos) {
  exigirObjetoPlano(entrada, 'solicitud');
  exigirClavesExactas(entrada, campos, 'solicitud');
  validarIdAvisoPlataforma(entrada.eventoId, 'eventoId');
  validarIdAvisoPlataforma(entrada.correlacionId, 'correlacionId');
  const efectivo = new Date(entrada.efectivoEnUtc);
  exigir(
    typeof entrada.efectivoEnUtc === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entrada.efectivoEnUtc) &&
      !Number.isNaN(efectivo.getTime()),
    'efectivoEnUtc debe ser UTC ISO 8601 con milisegundos.'
  );
  exigir(
    entrada.causalidad === null ||
      (esObjetoPlano(entrada.causalidad) &&
       Object.keys(entrada.causalidad).sort().join(',') === 'id,tipo'),
    'causalidad debe ser null o una referencia tipada exacta.'
  );
  const clave = construirClaveCausalAvisoPlataforma(entrada.claveCausal);
  const solicitud = {
    ...entrada,
    clave,
    efectivoSql: entrada.efectivoEnUtc.replace('T', ' ').replace('Z', '')
  };
  if ('contextoHumano' in entrada) validarJsonAcotado(entrada.contextoHumano, 'contextoHumano');
  if ('resumen' in entrada) validarJsonAcotado(entrada.resumen, 'resumen');
  return solicitud;
}

function validarActorRuntime(actor) {
  exigirObjetoPlano(actor, 'actor');
  exigirClavesExactas(actor, ['id', 'tipo'], 'actor');
  exigir(
    actor.tipo === 'runtime' && typeof actor.id === 'string' &&
      /^[\x21-\x7e]{1,191}$/.test(actor.id),
    'La transición técnica exige un actor runtime válido.'
  );
}

function validarActorUsuario(actor) {
  exigirObjetoPlano(actor, 'actor');
  exigirClavesExactas(actor, ['efectivo', 'modo', 'real', 'tipo'], 'actor');
  exigir(actor.tipo === 'usuario', 'La resolución administrativa exige actor usuario.');
  exigir(
    ['directo', 'impersonado'].includes(actor.modo),
    'El modo de actuación del usuario no es válido.'
  );
  validarIdentidadUsuario(actor.real, 'actor.real');
  if (actor.efectivo !== null) validarIdentidadUsuario(actor.efectivo, 'actor.efectivo');
  exigir(
    (actor.modo === 'directo' && actor.efectivo === null) ||
      (actor.modo === 'impersonado' && actor.efectivo !== null),
    'El actor efectivo no concuerda con el modo de actuación.'
  );
  exigir(
    actor.modo === 'directo',
    'La resolución administrativa de un aviso exige sesión directa.'
  );
}

function validarIdentidadUsuario(actor, nombre) {
  exigirObjetoPlano(actor, nombre);
  exigirClavesExactas(actor, ['id', 'tipo'], nombre);
  exigir(
    actor.tipo === 'usuario' && /^[1-9][0-9]*$/.test(String(actor.id)),
    `${nombre} debe ser una identidad de usuario canónica.`
  );
}

function validarJsonAcotado(valor, nombre) {
  exigirObjetoPlano(valor, nombre);
  let serializado;
  try {
    serializado = JSON.stringify(valor);
  } catch {
    throw new Error(`${nombre} debe ser JSON serializable.`);
  }
  exigir(Buffer.byteLength(serializado, 'utf8') <= 16384, `${nombre} supera el límite.`);
}

function validarNoFuturo(efectivoSql, ahoraSql) {
  exigir(efectivoSql <= ahoraSql, 'La transición no puede registrarse en el futuro SQL.');
}

function maxFecha(a, b) {
  return a >= b ? a : b;
}

function esObjetoPlano(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) &&
    Object.getPrototypeOf(valor) === Object.prototype;
}

function exigirObjetoPlano(valor, nombre) {
  exigir(esObjetoPlano(valor), `${nombre} debe ser un objeto JSON plano.`);
}

function exigirClavesExactas(valor, claves, nombre) {
  const actuales = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  exigir(
    actuales.length === esperadas.length &&
      actuales.every((clave, indice) => clave === esperadas[indice]),
    `${nombre} contiene campos ausentes o desconocidos.`
  );
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
