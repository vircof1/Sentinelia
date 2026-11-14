import {
  CAPACIDADES_COMPLETITUD_FEDERACION
} from '../../../../paquetes/federacion/src/CatalogosFederacion.js';
import {
  obtenerContratoFamiliaFederacion
} from '../../../../paquetes/federacion/src/ContratosFamiliasFederacion.js';

const PATRON_CODIGO_SEGURO = /^[a-z0-9_]{1,96}$/u;
const ERRORES_TERMINALES_NOMBRE = new Set([
  'ErrorAdaptadoresFamiliasFederacion',
  'ErrorPayloadEstructuraOrganizativaFederacion',
  'ErrorPayloadContextoOperativoAgentesSesionesFederacion',
  'ErrorPayloadTelemetriaFederacion',
  'ErrorPayloadMonitoresFederacion',
  'ErrorPayloadTriggersInformativosFederacion',
  'ErrorPayloadAuditoriaFederada',
  'ErrorPayloadAvisosFederados'
]);
const ERRORES_TERMINALES_CODIGO = new Set([
  'campo_base_materializacion_ausente',
  'ocurrencia_materializable_ausente',
  'ocurrencia_materializacion_no_corresponde',
  'adaptador_familia_no_registrado',
  'adaptador_familia_no_productivo'
]);

export class ProcesadorMaterializacionFederacionRuntime {
  constructor({
    clienteSql,
    repositorioTrabajos,
    repositorioInbox,
    registroFamilias,
    propietario,
    limiteLote = 10,
    leaseMs = 60_000,
    reintentoBaseMs = 1_000,
    reintentoMaximoMs = 60_000,
    notificarBloqueo = null,
    reloj = () => new Date()
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El materializador federado del runtime requiere SQL operativo.');
    }
    if (
      typeof repositorioTrabajos?.reclamarPendientes !== 'function' ||
      typeof repositorioTrabajos?.completarEnTransaccion !== 'function' ||
      typeof repositorioTrabajos?.fallar !== 'function'
    ) {
      throw new Error('El materializador federado requiere el repositorio durable completo.');
    }
    if (typeof repositorioInbox?.obtenerOcurrenciaMaterializable !== 'function') {
      throw new Error('El materializador federado requiere acceso al inbox durable.');
    }
    if (typeof registroFamilias?.obtenerProductivo !== 'function') {
      throw new Error('El materializador federado requiere el registro productivo de familias.');
    }
    if (typeof propietario !== 'string' || !propietario.trim()) {
      throw new Error('El materializador federado requiere una identidad de runtime.');
    }
    exigirEnteroPositivo(limiteLote, 'limiteLote');
    exigirEnteroPositivo(leaseMs, 'leaseMs');
    exigirEnteroPositivo(reintentoBaseMs, 'reintentoBaseMs');
    exigirEnteroPositivo(reintentoMaximoMs, 'reintentoMaximoMs');
    if (reintentoBaseMs > reintentoMaximoMs) {
      throw new Error('El reintento base no puede superar el máximo.');
    }
    if (typeof reloj !== 'function') {
      throw new Error('El materializador federado requiere un reloj.');
    }
    if (notificarBloqueo !== null && typeof notificarBloqueo !== 'function') {
      throw new Error('notificarBloqueo debe ser una función cuando se declara.');
    }
    this.clienteSql = clienteSql;
    this.repositorioTrabajos = repositorioTrabajos;
    this.repositorioInbox = repositorioInbox;
    this.registroFamilias = registroFamilias;
    this.propietario = propietario.trim();
    this.limiteLote = limiteLote;
    this.leaseMs = leaseMs;
    this.reintentoBaseMs = reintentoBaseMs;
    this.reintentoMaximoMs = reintentoMaximoMs;
    this.reloj = reloj;
    this.notificarBloqueo = notificarBloqueo;
    this.ejecucionActiva = null;
  }

  procesarPendientes({ origen = 'runtime', numeroTick = null } = {}) {
    if (this.ejecucionActiva) {
      return Promise.resolve(Object.freeze({
        origen,
        numeroTick,
        omitida: true,
        causa: 'materializacion_en_curso',
        totalReclamadas: 0,
        totalMaterializadas: 0,
        totalReintentables: 0,
        totalBloqueadas: 0,
        totalLeasePerdido: 0,
        totalErroresCoordinacion: 0
      }));
    }
    this.ejecucionActiva = this.#procesar({ origen, numeroTick });
    return this.ejecucionActiva.finally(() => {
      this.ejecucionActiva = null;
    });
  }

  async #procesar({ origen, numeroTick }) {
    const trabajos = await this.repositorioTrabajos.reclamarPendientes({
      propietario: this.propietario,
      limite: this.limiteLote,
      leaseMs: this.leaseMs
    });
    const resumen = {
      origen,
      numeroTick,
      omitida: false,
      causa: null,
      totalReclamadas: trabajos.length,
      totalMaterializadas: 0,
      totalReintentables: 0,
      totalBloqueadas: 0,
      totalLeasePerdido: 0,
      totalErroresCoordinacion: 0
    };
    for (const trabajo of trabajos) {
      let resultado;
      try {
        resultado = await this.#procesarTrabajo(trabajo);
      } catch {
        resumen.totalErroresCoordinacion += 1;
        continue;
      }
      if (resultado === 'materializada') resumen.totalMaterializadas += 1;
      if (resultado === 'reintentable') resumen.totalReintentables += 1;
      if (resultado === 'bloqueada') resumen.totalBloqueadas += 1;
      if (resultado === 'lease_perdido') resumen.totalLeasePerdido += 1;
    }
    return Object.freeze(resumen);
  }

  async #procesarTrabajo(trabajo) {
    try {
      const ocurrencia = await this.repositorioInbox
        .obtenerOcurrenciaMaterializable(trabajo.inboxId);
      validarCorrespondenciaTrabajo(trabajo, ocurrencia);
      const adaptador = this.registroFamilias.obtenerProductivo({
        familia: ocurrencia.familia,
        versionFamilia: ocurrencia.familiaVersion
      });
      const payload = extraerPayload(ocurrencia);
      const payloadNormalizado = ocurrencia.operacion === 'actualizacion'
        ? adaptador.interfaces.payload.validarPayload(payload, {
          operacion: ocurrencia.operacion
        })
        : null;
      const requisitosPorCapacidad =
        crearRequisitosCompletitudMaterializacionFederacion({
          ocurrencia,
          payload: payloadNormalizado
        });
      const conexion = await this.clienteSql.obtenerConexion();
      try {
        await conexion.beginTransaction();
        await adaptador.interfaces.materializacion.materializarEnTransaccion({
          operacion: ocurrencia.operacion,
          payload: payloadNormalizado,
          contexto: contextoTrabajo(trabajo)
        }, { conexion });
        await this.repositorioTrabajos.completarEnTransaccion({
          ...contextoTrabajo(trabajo),
          requisitosPorCapacidad,
          cierreOperativoValidado: true
        }, { conexion });
        await conexion.commit();
      } catch (error) {
        await conexion.rollback().catch(() => {});
        throw error;
      } finally {
        conexion.release();
      }
      return 'materializada';
    } catch (error) {
      if (esFencingObsoleto(error)) return 'lease_perdido';
      if (esErrorTerminalMaterializacion(error) &&
          typeof this.repositorioTrabajos.bloquear === 'function') {
        const errorCodigo = codigoSeguro(error);
        try {
          await this.repositorioTrabajos.bloquear({
            ...contextoTrabajo(trabajo),
            errorCodigo
          });
        } catch (errorCierre) {
          if (esFencingObsoleto(errorCierre)) return 'lease_perdido';
          throw errorCierre;
        }
        if (this.notificarBloqueo) {
          await this.notificarBloqueo({ trabajo, errorCodigo }).catch(() => {});
        }
        return 'bloqueada';
      }
      try {
        await this.repositorioTrabajos.fallar({
          ...contextoTrabajo(trabajo),
          errorCodigo: codigoSeguro(error),
          reintentarDesdeUtc: this.#calcularReintento(trabajo.intentos)
        });
        return 'reintentable';
      } catch (errorCierre) {
        if (esFencingObsoleto(errorCierre)) return 'lease_perdido';
        throw errorCierre;
      }
    }
  }

  #calcularReintento(intentos) {
    const exponente = Math.min(Math.max(Number(intentos || 1) - 1, 0), 20);
    const demora = Math.min(
      this.reintentoBaseMs * (2 ** exponente),
      this.reintentoMaximoMs
    );
    return new Date(this.reloj().getTime() + demora);
  }
}

export function crearRequisitosCompletitudMaterializacionFederacion({
  ocurrencia,
  payload
} = {}) {
  const contrato = obtenerContratoFamiliaFederacion(ocurrencia?.familia);
  const requisitos = Object.fromEntries(
    CAPACIDADES_COMPLETITUD_FEDERACION.valores.map((capacidad) => [capacidad, []])
  );
  for (const capacidad of contrato.completitud.capacidadesBase) {
    requisitos[capacidad].push(requisito(
      `familia:${contrato.selector.campoBase}`,
      'cumplido',
      null
    ));
  }
  for (const capacidad of contrato.completitud.capacidadesNoAplicables) {
    requisitos[capacidad].push(requisito(
      `familia:${contrato.selector.campoBase}`,
      'noAplicable',
      null
    ));
  }
  if (ocurrencia.operacion === 'actualizacion') {
    incorporarSensibilidad(requisitos, contrato, payload);
    incorporarReferenciasNoVisibles(requisitos, contrato, payload);
  }
  return Object.freeze(Object.fromEntries(Object.entries(requisitos).map(
    ([capacidad, lista]) => [capacidad, Object.freeze(lista)]
  )));
}

function extraerPayload(ocurrencia) {
  const contrato = obtenerContratoFamiliaFederacion(ocurrencia.familia);
  if (ocurrencia.operacion !== 'actualizacion') return null;
  const campo = ocurrencia.campos?.[contrato.selector.campoBase];
  if (!campo || campo.estado !== 'presente' || !Object.hasOwn(campo, 'valor')) {
    throw errorLocal(
      'campo_base_materializacion_ausente',
      'La actualización federada no contiene el conjunto funcional de su familia.'
    );
  }
  return campo.valor;
}

function incorporarSensibilidad(requisitos, contrato, payload) {
  const tipoRegistro = payload?.tipoRegistro ?? payload?.tipo ?? null;
  for (const [campo, politica] of Object.entries(contrato.sensibilidad)) {
    if (tipoRegistro && !politica.aplicaA.includes(tipoRegistro)) continue;
    const valor = payload?.[campo];
    const presente = valor !== undefined && valor !== null &&
      (typeof valor !== 'object' || valor.estado === undefined || valor.estado === 'presente');
    for (const capacidad of politica.capacidadesDegradadas) {
      requisitos[capacidad].push(requisito(
        `sensible:${campo}`,
        presente ? 'cumplido' : 'faltante',
        presente ? null : 'contenido_sensible_no_federado'
      ));
    }
  }
}

function incorporarReferenciasNoVisibles(requisitos, contrato, payload) {
  for (const [nombre, politica] of Object.entries(contrato.referenciasNoVisibles)) {
    if (politica.capacidadesDegradadas.length === 0) continue;
    const modo = payload?.[nombre]?.visibilidad ?? payload?.[nombre]?.modo ?? null;
    if (!politica.modos.includes(modo)) continue;
    for (const capacidad of politica.capacidadesDegradadas) {
      requisitos[capacidad].push(requisito(
        `referencia:${nombre}`,
        'faltante',
        `referencia_${modo}`
      ));
    }
  }
}

function validarCorrespondenciaTrabajo(trabajo, ocurrencia) {
  if (!ocurrencia || typeof ocurrencia !== 'object') {
    throw errorLocal(
      'ocurrencia_materializable_ausente',
      'El inbox no conserva la ocurrencia reclamada.'
    );
  }
  const comparaciones = [
    ['familia', trabajo.familia, ocurrencia.familia],
    ['operacion', trabajo.operacion, ocurrencia.operacion],
    ['installationOrigenId', trabajo.installationOrigenId, ocurrencia.installationOrigenId],
    ['elementoOrigenId', trabajo.elementoOrigenId, ocurrencia.elementoOrigenId],
    ['ocurrenciaOrigenId', trabajo.ocurrenciaOrigenId, ocurrencia.ocurrenciaOrigenId],
    ['secuenciaElemento', trabajo.secuenciaElemento, ocurrencia.secuenciaElemento]
  ];
  if (comparaciones.some(([, esperado, recibido]) =>
    esperado !== undefined && String(esperado) !== String(recibido))) {
    throw errorLocal(
      'ocurrencia_materializacion_no_corresponde',
      'La ocurrencia recuperada no corresponde al trabajo reclamado.'
    );
  }
}

function contextoTrabajo(trabajo) {
  return {
    entregaId: trabajo.entregaId,
    propietario: trabajo.propietario,
    fencingToken: trabajo.fencingToken
  };
}

function requisito(id, estado, causa) {
  return Object.freeze({ id, estado, causa });
}

function codigoSeguro(error) {
  const codigo = String(error?.codigo || '').trim();
  return PATRON_CODIGO_SEGURO.test(codigo)
    ? codigo
    : 'materializacion_federacion_error';
}

function esFencingObsoleto(error) {
  return String(error?.codigo || '').includes('fencing') &&
    String(error?.codigo || '').includes('obsoleto');
}

export function esErrorTerminalMaterializacion(error) {
  const codigo = String(error?.codigo || '');
  return ERRORES_TERMINALES_NOMBRE.has(error?.name) ||
    ERRORES_TERMINALES_CODIGO.has(codigo) ||
    codigo.endsWith('_divergente') ||
    codigo.includes('_no_corresponde') ||
    (codigo.startsWith('familia_') && codigo.endsWith('_incompatible'));
}

function errorLocal(codigo, mensaje) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  return error;
}

function exigirEnteroPositivo(valor, campo) {
  if (!Number.isSafeInteger(valor) || valor < 1) {
    throw new Error(`${campo} debe ser un entero positivo seguro.`);
  }
}
