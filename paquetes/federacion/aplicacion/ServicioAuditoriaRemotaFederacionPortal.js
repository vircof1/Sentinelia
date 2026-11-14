import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import { validarPayloadAuditoriaFederada } from '../src/PayloadAuditoriaFederada.js';
import {
  evaluarEvidenciaAuditoriaFederada
} from '../adaptadores/EvaluadorEvidenciaAuditoriaFederada.js';

const VISTAS = new Set(['resumen', 'actividad', 'historico']);

export class ServicioAuditoriaRemotaFederacionPortal {
  constructor({ repositorio, servicioAutorizacion } = {}) {
    if (typeof repositorio?.listarEventos !== 'function' ||
        typeof repositorio?.listarAnclajesRetencion !== 'function') {
      throw new Error('La vista de auditoría remota requiere lectura de eventos y retención.');
    }
    if (typeof servicioAutorizacion?.puedeVerAuditoria !== 'function') {
      throw new Error('La vista de auditoría remota requiere autorización explícita.');
    }
    this.repositorio = repositorio;
    this.autorizacion = servicioAutorizacion;
  }

  async obtener(contextoUsuarioActual, {
    installationOrigenId,
    vista = 'resumen',
    resultadoValidacion = null,
    claveCadenaOrigen = null,
    desdeUtc = null,
    hastaUtc = null,
    limite = 200
  } = {}) {
    if (!this.autorizacion.puedeVerAuditoria(contextoUsuarioActual)) {
      throw errorHttp(403, 'auditoria_federada_no_autorizada',
        'No tienes permiso para consultar auditoría federada.');
    }
    if (!VISTAS.has(vista)) {
      throw errorHttp(400, 'vista_auditoria_federada_invalida',
        'La vista de auditoría remota solicitada no existe.');
    }
    const procedencia = validarInstalacion(installationOrigenId);
    const scope = scopeEfectivo(contextoUsuarioActual);
    const fechaDesde = normalizarFechaOpcional(desdeUtc, 'desdeUtc');
    const fechaHasta = normalizarFechaOpcional(hastaUtc, 'hastaUtc', { finDia: true });
    if (fechaDesde.consulta !== null && fechaHasta.consulta !== null &&
        fechaHasta.consulta <= fechaDesde.consulta) {
      throw errorHttp(400, 'rango_auditoria_federada_invalido',
        'La fecha final debe ser posterior a la fecha inicial.');
    }
    const filtros = {
      installationOrigenId: procedencia,
      scope,
      resultadoValidacion: normalizarResultado(resultadoValidacion),
      claveCadenaOrigen: normalizarCadena(claveCadenaOrigen),
      desdeUtc: fechaDesde.consulta,
      hastaUtc: fechaHasta.consulta,
      limite: normalizarLimite(limite)
    };
    const consultarAnclajes = vista !== 'actividad';
    const [registros, anclajesRecibidos] = await Promise.all([
      this.repositorio.listarEventos(filtros),
      consultarAnclajes
        ? this.repositorio.listarAnclajesRetencion({
          installationOrigenId: procedencia,
          scope,
          claveCadenaOrigen: filtros.claveCadenaOrigen,
          limite: 200
        })
        : Promise.resolve(Object.freeze([]))
    ]);
    const eventos = registros.map(presentarEvento);
    const anclajes = anclajesRecibidos.map(presentarAnclaje);
    const cadenas = resumirCadenas(eventos);
    return Object.freeze({
      installationOrigenId: procedencia,
      vista,
      filtros: Object.freeze({
        resultadoValidacion: filtros.resultadoValidacion,
        claveCadenaOrigen: filtros.claveCadenaOrigen,
        desdeUtc: fechaDesde.formulario,
        hastaUtc: fechaHasta.formulario,
        limite: filtros.limite
      }),
      eventos: Object.freeze(eventos),
      cadenas: Object.freeze(cadenas),
      anclajes: Object.freeze(anclajes),
      resumen: Object.freeze({
        eventos: eventos.length,
        verificadas: contar(eventos, 'resultadoValidacionReceptor', 'verificada'),
        noVerificables: contar(eventos, 'resultadoValidacionReceptor', 'noVerificable'),
        invalidas: contar(eventos, 'resultadoValidacionReceptor', 'invalida'),
        cadenas: cadenas.length,
        eventosSinCadena: eventos.filter((evento) => !evento.claveCadenaOrigen).length,
        fragmentosConAtencion: cadenas.filter((cadena) =>
          cadena.estadoFragmento !== 'fragmentoVerificado').length,
        anclajesRetencion: anclajes.length,
        limiteAlcanzado: eventos.length === filtros.limite
      })
    });
  }
}

function presentarEvento(registro) {
  const payload = validarPayloadAuditoriaFederada(registro.payload);
  const vista = payload.vistaAutorizada;
  const validacion = validarCoherenciaPersistida(registro, payload);
  return Object.freeze({
    proyeccionId: registro.proyeccionId,
    generacionId: registro.generacionId,
    elementoOrigenId: registro.elementoOrigenId,
    ocurrenciaOrigenId: registro.ocurrenciaOrigenId,
    eventoOrigenId: payload.eventoOrigenId,
    tipoEvento: vista.tipo ?? vista.tipoEvento,
    versionContrato: vista.versionContrato,
    flujo: vista.flujo,
    scopeOrigen: sanear(vista.scope),
    sujeto: sanear(vista.sujeto),
    actorReal: sanear(vista.actorReal),
    actorEfectivo: sanear(vista.actorEfectivo),
    modoActuacion: vista.modoActuacion ?? null,
    origen: vista.origen ?? null,
    correlacionId: vista.correlacionId ?? null,
    causalidad: sanear(vista.causalidad),
    productor: vista.productor ?? null,
    rolEvento: vista.rolEvento ?? null,
    efectivoEnOrigenUtc: vista.efectivoEnUtc,
    registradoEnOrigenUtc: vista.registradoEnUtc,
    payload: sanear(vista.payload),
    claveCadenaDeclaradaOrigen: vista.claveCadena ?? null,
    secuenciaDeclaradaOrigen: vista.secuencia ?? null,
    claveCadenaOrigen: registro.claveCadenaOrigen,
    secuenciaCadenaOrigen: registro.secuenciaCadenaOrigen,
    estadoVerificabilidadOrigen: registro.estadoVerificabilidadOrigen,
    resultadoValidacionReceptor: validacion.estado,
    causaValidacion: validacion.causa,
    hashesOrigen: validacion.hashesOrigen,
    anclaReceptor: registro.anclaReceptor,
    scopeRecepcion: registro.scopeRecepcion,
    completitud: registro.completitud,
    estadoProyeccion: registro.estadoProyeccion
  });
}

function validarCoherenciaPersistida(registro, payload) {
  const evaluada = evaluarEvidenciaAuditoriaFederada(payload);
  const evidencia = payload.evidenciaOrigen;
  const hashesPayload = evidencia.estado === 'verificable'
    ? Object.freeze({
      payload: evidencia.hashPayload,
      anterior: evidencia.hashAnterior,
      actual: evidencia.hashActual
    })
    : Object.freeze({ payload: null, anterior: null, actual: null });
  const divergencias = [];
  if (registro.eventoOrigenId !== payload.eventoOrigenId) {
    divergencias.push('identidadPersistidaDivergente');
  }
  if (registro.estadoVerificabilidadOrigen !== evidencia.estado) {
    divergencias.push('verificabilidadPersistidaDivergente');
  }
  if (registro.resultadoValidacionReceptor !== evaluada.estado) {
    divergencias.push('validacionPersistidaDivergente');
  }
  if ((registro.causaValidacion ?? null) !== (evaluada.causa ?? null)) {
    divergencias.push('causaValidacionPersistidaDivergente');
  }
  if (!hashesIguales(registro.hashesOrigen, hashesPayload)) {
    divergencias.push('evidenciaIndexadaDivergente');
  }
  const sobre = evidencia.estado === 'verificable' ? evidencia.sobreCanonico : null;
  if ((registro.claveCadenaOrigen ?? null) !== (sobre?.claveCadena ?? null) ||
      normalizarSecuencia(registro.secuenciaCadenaOrigen) !==
        normalizarSecuencia(sobre?.secuencia)) {
    divergencias.push('cadenaPersistidaDivergente');
  }
  return Object.freeze({
    estado: divergencias.length ? 'invalida' : evaluada.estado,
    causa: divergencias.length ? divergencias.join(',') : evaluada.causa,
    hashesOrigen: hashesPayload
  });
}

function hashesIguales(izquierda, derecha) {
  return ['payload', 'anterior', 'actual'].every((clave) =>
    (izquierda?.[clave] ?? null) === (derecha?.[clave] ?? null));
}

function normalizarSecuencia(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function presentarAnclaje(anclaje) {
  return Object.freeze({
    ...anclaje,
    hashActualUltimoRetirado: limitar(anclaje.hashActualUltimoRetirado, 64),
    hashAnclaLocal: limitar(anclaje.hashAnclaLocal, 64)
  });
}

function resumirCadenas(eventos) {
  const grupos = new Map();
  for (const evento of eventos) {
    const clave = evento.claveCadenaOrigen;
    if (!clave) continue;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(evento);
  }
  return [...grupos.entries()].map(([claveCadenaOrigen, miembros]) => {
    const ordenados = [...miembros].sort(compararSecuencia);
    let huecos = 0;
    let enlacesIncoherentes = 0;
    for (let indice = 1; indice < ordenados.length; indice += 1) {
      const anterior = ordenados[indice - 1];
      const actual = ordenados[indice];
      const secuenciaAnterior = enteroGrande(anterior.secuenciaCadenaOrigen);
      const secuenciaActual = enteroGrande(actual.secuenciaCadenaOrigen);
      if (secuenciaAnterior === null || secuenciaActual === null ||
          secuenciaActual !== secuenciaAnterior + 1n) {
        huecos += 1;
        continue;
      }
      if (anterior.hashesOrigen?.actual && actual.hashesOrigen?.anterior &&
          anterior.hashesOrigen.actual !== actual.hashesOrigen.anterior) {
        enlacesIncoherentes += 1;
      }
    }
    const invalidas = contar(miembros, 'resultadoValidacionReceptor', 'invalida');
    const noVerificables = contar(miembros, 'resultadoValidacionReceptor', 'noVerificable');
    const todasVerificadas = miembros.length > 0 &&
      miembros.every((evento) => evento.resultadoValidacionReceptor === 'verificada');
    const estadoFragmento = invalidas || enlacesIncoherentes
      ? 'fragmentoInvalido'
      : todasVerificadas && huecos === 0
        ? 'fragmentoVerificado'
        : noVerificables === miembros.length
          ? 'fragmentoNoVerificable'
          : 'fragmentoParcial';
    return Object.freeze({
      claveCadenaOrigen,
      eventos: miembros.length,
      verificadas: contar(miembros, 'resultadoValidacionReceptor', 'verificada'),
      noVerificables,
      invalidas,
      huecosVisibles: huecos,
      enlacesIncoherentes,
      primeraSecuenciaVisible: ordenados[0]?.secuenciaCadenaOrigen ?? null,
      ultimaSecuenciaVisible: ordenados.at(-1)?.secuenciaCadenaOrigen ?? null,
      estadoFragmento
    });
  }).sort((a, b) => a.claveCadenaOrigen.localeCompare(b.claveCadenaOrigen));
}

function compararSecuencia(a, b) {
  const izquierda = enteroGrande(a.secuenciaCadenaOrigen);
  const derecha = enteroGrande(b.secuenciaCadenaOrigen);
  if (izquierda === null) return derecha === null ? 0 : 1;
  if (derecha === null) return -1;
  return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
}

function enteroGrande(valor) {
  try {
    const texto = String(valor ?? '');
    return /^(0|[1-9][0-9]*)$/u.test(texto) ? BigInt(texto) : null;
  } catch { return null; }
}

function sanear(valor, profundidad = 0) {
  if (valor === null || valor === undefined || typeof valor === 'boolean' ||
      typeof valor === 'number') return valor ?? null;
  if (typeof valor === 'string') return limitar(valor, 2000);
  if (profundidad >= 6) return '[contenido acotado]';
  if (Array.isArray(valor)) {
    return Object.freeze(valor.slice(0, 50).map((entrada) =>
      sanear(entrada, profundidad + 1)));
  }
  return Object.freeze(Object.fromEntries(Object.entries(valor).slice(0, 100)
    .map(([clave, contenido]) => [limitar(clave, 128), sanear(contenido, profundidad + 1)])));
}

function validarInstalacion(valor) {
  try {
    return String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: String(valor || '')
    }));
  } catch {
    throw errorHttp(400, 'installation_auditoria_federada_invalida',
      'Selecciona una instalación remota válida.');
  }
}

function normalizarResultado(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  if (!['verificada', 'noVerificable', 'invalida'].includes(texto)) {
    throw errorHttp(400, 'resultado_auditoria_federada_invalido',
      'El filtro de verificabilidad no es válido.');
  }
  return texto;
}

function normalizarCadena(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  if (texto.length > 128 || !/^[\x20-\x7e]+$/u.test(texto)) {
    throw errorHttp(400, 'cadena_auditoria_federada_invalida',
      'La clave de cadena no es válida.');
  }
  return texto;
}

function normalizarFechaOpcional(valor, campo, { finDia = false } = {}) {
  const texto = String(valor ?? '').trim();
  if (!texto) return Object.freeze({ consulta: null, formulario: null });
  const soloDia = /^\d{4}-\d{2}-\d{2}$/u.test(texto);
  const fecha = new Date(soloDia ? `${texto}T00:00:00.000Z` : texto);
  if (Number.isNaN(fecha.getTime())) {
    throw errorHttp(400, 'fecha_auditoria_federada_invalida',
      `El filtro ${campo} no contiene una fecha válida.`);
  }
  if (soloDia && finDia) fecha.setUTCDate(fecha.getUTCDate() + 1);
  return Object.freeze({
    consulta: fecha.toISOString(),
    formulario: soloDia ? texto : fecha.toISOString().slice(0, 10)
  });
}

function normalizarLimite(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) return 200;
  return Math.min(numero, 500);
}

function scopeEfectivo(contexto) {
  return Object.freeze({
    nivel: contexto?.nivelScope,
    tenantId: contexto?.tenantId ?? null,
    empresaId: contexto?.empresaId ?? null,
    sitioId: contexto?.sitioId ?? null
  });
}

function contar(elementos, campo, valor) {
  return elementos.filter((elemento) => elemento[campo] === valor).length;
}

function limitar(valor, maximo) { return String(valor ?? '').slice(0, maximo); }
function errorHttp(statusCode, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { statusCode, codigo });
}
