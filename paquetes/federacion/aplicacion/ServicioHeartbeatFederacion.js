import { generarUuidV7Auditoria, validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  FAMILIAS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from '../src/CatalogosFederacion.js';

export class ServicioHeartbeatFederacion {
  constructor({ servicioSesiones, repositorioSql, repositorioPresencia,
    resolverConfiguracion, servicioAvisos = null, servicioConflictos = null,
    guardiaActivacion = null } = {}) {
    exigirMetodo(servicioSesiones, 'validarBearer', 'servicioSesiones');
    exigirMetodo(repositorioSql, 'registrar', 'repositorioSql');
    exigirMetodo(repositorioPresencia, 'publicar', 'repositorioPresencia');
    if (typeof resolverConfiguracion !== 'function') {
      throw new Error('El heartbeat requiere configuración federada dinámica.');
    }
    this.servicioSesiones = servicioSesiones;
    this.repositorioSql = repositorioSql;
    this.repositorioPresencia = repositorioPresencia;
    this.resolverConfiguracion = resolverConfiguracion;
    this.servicioAvisos = servicioAvisos;
    this.servicioConflictos = servicioConflictos;
    if (guardiaActivacion !== null &&
        typeof guardiaActivacion?.exigirActiva !== 'function') {
      throw new Error('guardiaActivacion debe implementar exigirActiva().');
    }
    this.guardiaActivacion = guardiaActivacion;
  }

  async registrar({ token, ...entrada } = {}) {
    await this.guardiaActivacion?.exigirActiva('heartbeat');
    validarEntrada(entrada);
    const sesion = await this.servicioSesiones.validarBearer(token);
    if (sesion.relacionId !== entrada.relacionId ||
        sesion.sesionId !== entrada.sesionId ||
        sesion.bootRemotoId !== entrada.bootEmisorId) {
      const error = new Error('El heartbeat no pertenece a la sesión autenticada.');
      error.codigo = 'HEARTBEAT_FEDERADO_RECHAZADO';
      error.statusCode = 403;
      throw error;
    }
    const configuracion = await this.resolverConfiguracion();
    if (!Number.isSafeInteger(configuracion?.toleranciaTemporalMs) ||
        configuracion.toleranciaTemporalMs < 0 ||
        configuracion.toleranciaTemporalMs > 300000) {
      throw new Error('La tolerancia temporal federada viva no es válida.');
    }
    const compatibilidad = normalizarCompatibilidad(entrada.compatibilidad);
    const compatible = esCompatibilidadExacta(compatibilidad);
    const resultado = await this.repositorioSql.registrar({
      heartbeatRequestId: entrada.heartbeatRequestId,
      relacionId: entrada.relacionId,
      sesionId: entrada.sesionId,
      installationRemotaId: sesion.installationRemotaId,
      bootRemotoId: entrada.bootEmisorId,
      seq: entrada.seq,
      clienteEnviaEnUtc: entrada.clienteEnviaEnUtc,
      compatibilidad,
      compatible,
      muestraTemporalAnterior: entrada.muestraTemporalAnterior,
      muestraId: generarUuidV7Auditoria(),
      avisoEventoId: generarUuidV7Auditoria(),
      toleranciaTemporalMs: configuracion.toleranciaTemporalMs,
      presenciaTtlSegundos: this.repositorioPresencia.ttlSegundos
    });
    const ttlPresenciaSegundos = resultado.repetida
      ? calcularTtlRestantePresencia(
          resultado.respuesta.muestraTemporal.servidorRecibeEnUtc,
          this.repositorioPresencia.ttlSegundos
        )
      : this.repositorioPresencia.ttlSegundos;
    if (ttlPresenciaSegundos > 0) {
      await this.repositorioPresencia.publicar({
        relacionId: entrada.relacionId,
        sesionId: entrada.sesionId,
        installationRemotaId: sesion.installationRemotaId,
        bootRemotoId: entrada.bootEmisorId,
        fencingToken: sesion.fencingToken,
        versionRevocacion: sesion.versionRevocacion,
        seq: entrada.seq,
        observadoEnUtc: resultado.respuesta.muestraTemporal.servidorRecibeEnUtc,
        compatibilidad: resultado.respuesta.relacion.compatibilidad,
        estadoTemporal: resultado.respuesta.relacion.temporal.estado
      }, { ttlSegundos: ttlPresenciaSegundos });
    }
    await this.#sincronizarAvisoTemporal(resultado);
    if (ttlPresenciaSegundos > 0) {
      await this.#observarIdentidad(
        sesion.installationRemotaId,
        configuracion.consolidacionReinicioMs
      );
    }
    return resultado.respuesta;
  }

  async #observarIdentidad(installationRemotaId, consolidacionReinicioMs) {
    if (!this.servicioConflictos) return Object.freeze({ estado: 'no_disponible' });
    if (!Number.isSafeInteger(consolidacionReinicioMs) || consolidacionReinicioMs < 0 ||
        consolidacionReinicioMs > 3600000) {
      throw new Error('El margen de consolidación federado vivo no es válido.');
    }
    const presencias = await this.repositorioPresencia.listarPorInstalacion(
      installationRemotaId
    );
    return this.servicioConflictos.observar({
      installationRemotaId,
      presencias,
      consolidacionReinicioMs
    });
  }

  async #sincronizarAvisoTemporal(resultado) {
    const estado = resultado.respuesta.relacion.temporal.estado;
    if (estado === 'pendiente' || !this.servicioAvisos) return;
    const base = {
      eventoId: resultado.avisoEventoId,
      correlacionId: resultado.respuesta.heartbeatRequestId,
      efectivoEnUtc: resultado.respuesta.muestraTemporal.servidorRecibeEnUtc,
      causalidad: null,
      actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
      claveCausal: {
        versionCatalogo: 1,
        tipoCodigo: 'tiempo',
        causaCodigo: 'desfase_temporal_fuera_tolerancia',
        objetoTipo: 'instalacion_federada',
        objetoId: resultado.installationRemotaId,
        relacionId: resultado.respuesta.relacion.relacionId,
        flujoId: null,
        scope: resultado.scope
      }
    };
    if (estado === 'noTolerable') {
      await this.servicioAvisos.detectar({
        ...base,
        contextoHumano: {
          relacionId: resultado.respuesta.relacion.relacionId,
          installationRemotaId: resultado.installationRemotaId
        },
        resumen: {
          desfaseEstimadoMs: String(
            resultado.respuesta.relacion.temporal.desfaseEstimadoMs
          ),
          toleranciaTemporalMs: String(
            resultado.respuesta.relacion.temporal.toleranciaTemporalMs
          )
        }
      });
    } else {
      await this.servicioAvisos.resolver({
        ...base,
        viaResolucion: 'causa_desaparecida'
      });
    }
  }
}

function calcularTtlRestantePresencia(observadoEnUtc, ttlSegundos) {
  const observadoMs = Date.parse(observadoEnUtc);
  if (!Number.isFinite(observadoMs)) {
    throw new Error('El replay de heartbeat no conserva un instante de presencia válido.');
  }
  return Math.max(0, Math.min(
    ttlSegundos,
    Math.floor((observadoMs + ttlSegundos * 1000 - Date.now()) / 1000)
  ));
}

function validarEntrada(entrada) {
  exigirObjetoExacto(entrada, [
    'bootEmisorId', 'clienteEnviaEnUtc', 'compatibilidad',
    'heartbeatRequestId', 'muestraTemporalAnterior', 'relacionId', 'seq', 'sesionId'
  ], 'heartbeat federado');
  exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
  exigirIdentidad(entrada.bootEmisorId, 'arranque', 'bootEmisorId');
  validarUuidV7Auditoria(entrada.heartbeatRequestId, 'heartbeatRequestId');
  validarUuidV7Auditoria(entrada.sesionId, 'sesionId');
  exigirSecuencia(entrada.seq);
  exigirFechaUtc(entrada.clienteEnviaEnUtc, 'clienteEnviaEnUtc');
  validarMuestra(entrada.muestraTemporalAnterior);
}

function validarMuestra(muestra) {
  if (muestra === null) return;
  exigirObjetoExacto(muestra, [
    'clienteEnviaEnUtc', 'clienteRecibeEnUtc', 'muestraId',
    'servidorEnviaEnUtc', 'servidorRecibeEnUtc'
  ], 'muestraTemporalAnterior');
  validarUuidV7Auditoria(muestra.muestraId, 'muestraId');
  for (const campo of [
    'clienteEnviaEnUtc', 'clienteRecibeEnUtc',
    'servidorEnviaEnUtc', 'servidorRecibeEnUtc'
  ]) exigirFechaUtc(muestra[campo], `muestraTemporalAnterior.${campo}`);
}

function normalizarCompatibilidad(valor) {
  exigirObjetoExacto(valor, [
    'familiasSoportadas', 'productoVersion', 'protocoloVersion', 'versionesFamilia'
  ], 'compatibilidad');
  if (!Number.isSafeInteger(valor.protocoloVersion) || valor.protocoloVersion < 1 ||
      typeof valor.productoVersion !== 'string' || valor.productoVersion.length < 1 ||
      valor.productoVersion.length > 64 || !Array.isArray(valor.familiasSoportadas)) {
    throw new Error('La declaración de compatibilidad no es válida.');
  }
  const familias = [...valor.familiasSoportadas];
  if (familias.some((familia) => typeof familia !== 'string') ||
      new Set(familias).size !== familias.length) {
    throw new Error('familiasSoportadas debe ser una lista única.');
  }
  exigirObjetoExacto(valor.versionesFamilia, familias, 'versionesFamilia');
  for (const familia of familias) {
    if (!/^[a-z][A-Za-z0-9]{0,63}$/u.test(familia) ||
        !Number.isSafeInteger(valor.versionesFamilia[familia]) ||
        valor.versionesFamilia[familia] < 1) {
      throw new Error('La versión de familia federada no es válida.');
    }
  }
  familias.sort();
  return Object.freeze({
    protocoloVersion: valor.protocoloVersion,
    productoVersion: valor.productoVersion,
    familiasSoportadas: Object.freeze(familias),
    versionesFamilia: Object.freeze(Object.fromEntries(
      familias.map((familia) => [familia, valor.versionesFamilia[familia]])
    ))
  });
}

function esCompatibilidadExacta(compatibilidad) {
  const locales = [...FAMILIAS_FEDERACION.valores].sort();
  return compatibilidad.protocoloVersion === VERSION_PROTOCOLO_FEDERACION &&
    compatibilidad.familiasSoportadas.length === locales.length &&
    compatibilidad.familiasSoportadas.every((familia, indice) =>
      familia === locales[indice] &&
      compatibilidad.versionesFamilia[familia] === VERSIONES_FAMILIA_FEDERACION[familia]
    );
}

function exigirFechaUtc(valor, campo) {
  if (typeof valor !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(valor) ||
      !Number.isFinite(Date.parse(valor)) || new Date(Date.parse(valor)).toISOString() !== valor) {
    throw new Error(`${campo} debe ser un instante UTC ISO con milisegundos.`);
  }
}

function exigirSecuencia(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]*$/u.test(valor) ||
      BigInt(valor) > 18446744073709551615n) {
    throw new Error('seq debe ser un entero decimal positivo de 64 bits.');
  }
}

function exigirIdentidad(valor, tipo, campo) {
  if (typeof valor !== 'string' ||
      !new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u').test(valor)) {
    throw new Error(`${campo} no es canónica.`);
  }
}

function exigirObjetoExacto(valor, claves, campo) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error(`${campo} debe ser un objeto JSON plano.`);
  }
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  if (observadas.length !== esperadas.length ||
      observadas.some((clave, indice) => clave !== esperadas[indice])) {
    throw new Error(`${campo} contiene campos ausentes o desconocidos.`);
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
