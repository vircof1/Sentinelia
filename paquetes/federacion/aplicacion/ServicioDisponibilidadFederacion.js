import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';
import { generarIdAvisoPlataforma } from '../../avisos-plataforma/src/IdentidadAvisoPlataforma.js';

export class ServicioDisponibilidadFederacion {
  constructor({
    clienteSql,
    repositorioDisponibilidad,
    repositorioCursores,
    servicioAvisosPlataforma = null,
    resolverToleranciaTemporalMs = async () => 5_000,
    actorRuntimeId = 'runtime-federacion-disponibilidad',
    guardiaActivacion = null
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function' ||
        typeof repositorioDisponibilidad?.registrarEnTransaccion !== 'function' ||
        typeof repositorioCursores?.aplicarHuecoIrrecuperableEnTransaccion !== 'function' ||
        (servicioAvisosPlataforma !== null &&
          typeof servicioAvisosPlataforma?.detectar !== 'function') ||
        typeof resolverToleranciaTemporalMs !== 'function') {
      throw new Error('La disponibilidad federada requiere persistencia, cursores y avisos válidos.');
    }
    this.repositorioDisponibilidad = repositorioDisponibilidad;
    this.repositorioCursores = repositorioCursores;
    this.servicioAvisosPlataforma = servicioAvisosPlataforma;
    this.resolverToleranciaTemporalMs = resolverToleranciaTemporalMs;
    this.actorRuntimeId = String(actorRuntimeId);
    if (guardiaActivacion !== null &&
        typeof guardiaActivacion?.exigirActiva !== 'function') {
      throw new Error('guardiaActivacion debe implementar exigirActiva().');
    }
    this.guardiaActivacion = guardiaActivacion;
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
  }

  async registrar(entrada) {
    await this.guardiaActivacion?.exigirActiva('registrar_disponibilidad');
    const toleranciaTemporalMs = await this.resolverToleranciaTemporalMs();
    if (!Number.isSafeInteger(toleranciaTemporalMs) ||
        toleranciaTemporalMs < 0 || toleranciaTemporalMs > 300_000) {
      throw new Error('La tolerancia temporal federada viva no es válida.');
    }
    return this.frontera.ejecutar(async (conexion) => {
      const declaracion = await this.repositorioDisponibilidad
        .registrarEnTransaccion(entrada, { conexion, toleranciaTemporalMs });
      if (declaracion.tipo !== 'huecoIrrecuperable') {
        return Object.freeze({ declaracion, progreso: null, aviso: null });
      }
      const yaAplicada = declaracion.aplicadaCursor;
      const progreso = await this.repositorioCursores
        .aplicarHuecoIrrecuperableEnTransaccion({
          declaracionId: declaracion.declaracionId
        }, { conexion });
      const aviso = !yaAplicada && this.servicioAvisosPlataforma
        ? await this.servicioAvisosPlataforma.detectar(
          solicitudAviso(declaracion, this.actorRuntimeId),
          { conexion }
        )
        : null;
      return Object.freeze({
        declaracion: Object.freeze({ ...declaracion, aplicadaCursor: true }),
        progreso,
        aviso
      });
    });
  }
}

function solicitudAviso(declaracion, actorRuntimeId) {
  const eventoId = generarIdAvisoPlataforma();
  return {
    eventoId,
    correlacionId: generarIdAvisoPlataforma(),
    efectivoEnUtc: declaracion.recibidaEnUtc,
    actor: { tipo: 'runtime', id: actorRuntimeId },
    causalidad: { tipo: 'declaracionDisponibilidad', id: declaracion.declaracionId },
    claveCausal: {
      versionCatalogo: 1,
      tipoCodigo: 'generacion',
      causaCodigo: 'hueco_irrecuperable',
      objetoTipo: 'generacion_federada',
      objetoId: declaracion.generacionId,
      relacionId: declaracion.relacionId,
      flujoId: declaracion.flujoId,
      scope: declaracion.scopeRecepcion
    },
    contextoHumano: {
      declaracionId: declaracion.declaracionId,
      familia: declaracion.familia,
      rango: {
        inicio: declaracion.inicioPosicion,
        fin: declaracion.finPosicion
      },
      causa: declaracion.causa
    },
    resumen: {
      codigo: 'hueco_irrecuperable_validado',
      mensaje: 'Una frontera federada contiene datos que ninguna ruta autorizada puede recuperar.'
    }
  };
}
