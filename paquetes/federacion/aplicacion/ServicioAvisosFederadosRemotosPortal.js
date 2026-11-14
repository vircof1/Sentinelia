import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import { validarPayloadAvisosFederados } from '../src/PayloadAvisosFederados.js';

const VISTAS = new Set(['actuales', 'actividad', 'historico']);
const CLAVES_SENSIBLES =
  /password|passwd|contrasena|secret|secreto|token|api[_-]?key|authorization|credential|credencial|cookie/iu;

export class ServicioAvisosFederadosRemotosPortal {
  constructor({ repositorio, servicioAutorizacion } = {}) {
    if (typeof repositorio?.listarEstados !== 'function' ||
        typeof repositorio?.listarTransiciones !== 'function') {
      throw new Error('La vista de avisos remotos requiere un repositorio de lectura completo.');
    }
    if (typeof servicioAutorizacion?.puedeVerDiagnosticoFederacion !== 'function') {
      throw new Error('La vista de avisos remotos requiere autorización explícita.');
    }
    this.repositorio = repositorio;
    this.autorizacion = servicioAutorizacion;
  }

  async obtener(contextoUsuarioActual, {
    installationOrigenId,
    vista = 'actuales',
    desdeUtc = null,
    hastaUtc = null
  } = {}) {
    if (!this.autorizacion.puedeVerDiagnosticoFederacion(contextoUsuarioActual)) {
      throw errorHttp(403, 'avisos_federados_no_autorizados',
        'Los avisos de la instalación remota no son visibles.');
    }
    if (!VISTAS.has(vista)) {
      throw errorHttp(400, 'vista_avisos_federados_invalida',
        'La vista de avisos remotos solicitada no existe.');
    }
    const procedencia = validarInstalacion(installationOrigenId);
    const scope = scopeEfectivo(contextoUsuarioActual);
    const filtros = { installationOrigenId: procedencia, scope };
    const limiteTransiciones = vista === 'historico' ? 500 : 200;
    const [estadosRecibidos, transicionesRecibidas] = await Promise.all([
      this.repositorio.listarEstados({ ...filtros, limite: 500 }),
      vista === 'actuales'
        ? Promise.resolve(Object.freeze([]))
        : this.repositorio.listarTransiciones({
          ...filtros,
          desdeUtc: normalizarFechaOpcional(desdeUtc, 'desdeUtc'),
          hastaUtc: normalizarFechaOpcional(hastaUtc, 'hastaUtc'),
          limite: limiteTransiciones
        })
    ]);
    const puedeVerActor = Boolean(contextoUsuarioActual?.permisos?.verAuditoria);
    const estados = estadosRecibidos.map((registro) =>
      presentarEstado(registro, puedeVerActor));
    const transiciones = transicionesRecibidas.map((registro) =>
      presentarTransicion(registro, puedeVerActor));
    return Object.freeze({
      installationOrigenId: procedencia,
      vista,
      estados: Object.freeze(estados),
      transiciones: Object.freeze(transiciones),
      resumen: Object.freeze({
        total: estados.length,
        pendientes: contar(estados, 'estadoCiclo', 'pendiente'),
        resueltos: contar(estados, 'estadoCiclo', 'resuelto'),
        obsoletos: contar(estados, 'estadoCiclo', 'obsoleto'),
        criticosPendientes: estados.filter((aviso) =>
          aviso.estadoCiclo === 'pendiente' && aviso.gravedad === 'critica').length,
        transiciones: transiciones.length,
        limiteEstadosAlcanzado: estadosRecibidos.length === 500,
        limiteTransicionesAlcanzado: transicionesRecibidas.length === limiteTransiciones
      })
    });
  }
}

function presentarEstado(registro, puedeVerActor) {
  const payload = validarPayloadAvisosFederados(registro.payload);
  return Object.freeze({
    ...metadatosRegistro(registro),
    avisoOrigenId: payload.avisoOrigenId,
    tipoCodigo: payload.tipoCodigo,
    causaCodigo: payload.causaCodigo,
    estadoCiclo: payload.estadoCiclo,
    gravedad: payload.gravedad,
    objetoAfectado: payload.objetoAfectado,
    primeraDeteccionUtc: payload.primeraDeteccionUtc,
    ultimaDeteccionUtc: payload.ultimaDeteccionUtc,
    resueltoEnUtc: payload.resueltoEnUtc,
    obsoletoEnUtc: payload.obsoletoEnUtc,
    contadorDetecciones: payload.contadorDetecciones,
    contextoHumano: sanear(payload.contextoHumano),
    resumen: sanear(payload.resumen),
    actor: presentarActor(payload.actorUltimaTransicion, puedeVerActor)
  });
}

function presentarTransicion(registro, puedeVerActor) {
  const payload = validarPayloadAvisosFederados(registro.payload);
  return Object.freeze({
    ...metadatosRegistro(registro),
    avisoOrigenId: payload.avisoOrigenId,
    ordinal: payload.ordinal,
    tipo: payload.transicionTipo,
    estadoAnterior: payload.estadoAnterior,
    estadoNuevo: payload.estadoNuevo,
    gravedadAnterior: payload.gravedadAnterior,
    gravedadNueva: payload.gravedadNueva,
    efectivoEnUtc: payload.efectivoEnUtc,
    registradoEnUtc: payload.registradoEnUtc,
    contadorDetecciones: payload.contadorDetecciones,
    detalle: sanear(payload.detalle),
    contextoHumano: sanear(payload.contextoHumano),
    resumen: sanear(payload.resumen),
    actor: presentarActor(payload.actor, puedeVerActor)
  });
}

function metadatosRegistro(registro) {
  return {
    proyeccionId: registro.proyeccionId,
    elementoOrigenId: registro.elementoOrigenId,
    scopeRecepcion: registro.scopeRecepcion,
    completitud: registro.completitud,
    estadoProyeccion: registro.estadoProyeccion
  };
}

function presentarActor(actor, puedeVerActor) {
  if (!actor || actor.estado === 'omitida') return Object.freeze({ estado: 'omitida' });
  if (actor.estado === 'visible' && puedeVerActor) {
    return Object.freeze({
      estado: 'visible',
      tipo: actor.tipo,
      nombreVisible: String(actor.nombreVisible || '').slice(0, 191)
    });
  }
  return Object.freeze({ estado: 'opaca' });
}

function sanear(valor, profundidad = 0) {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'number') {
    return valor;
  }
  if (typeof valor === 'string') return valor.slice(0, 1000);
  if (profundidad >= 5) return '[contenido acotado]';
  if (Array.isArray(valor)) {
    return Object.freeze(valor.slice(0, 30).map((entrada) =>
      sanear(entrada, profundidad + 1)));
  }
  return Object.freeze(Object.fromEntries(Object.entries(valor || {})
    .filter(([clave]) => !CLAVES_SENSIBLES.test(clave))
    .slice(0, 60)
    .map(([clave, contenido]) => [clave, sanear(contenido, profundidad + 1)])));
}

function validarInstalacion(valor) {
  try {
    return String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: String(valor || '')
    }));
  } catch {
    throw errorHttp(400, 'installation_avisos_federados_invalida',
      'Selecciona una instalación remota válida.');
  }
}

function normalizarFechaOpcional(valor, campo) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw errorHttp(400, 'fecha_avisos_federados_invalida',
      `El filtro ${campo} no contiene una fecha válida.`);
  }
  return fecha.toISOString();
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

function errorHttp(statusCode, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { statusCode, codigo });
}
