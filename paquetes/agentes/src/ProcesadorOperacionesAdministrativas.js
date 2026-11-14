import {
  LeaseOperacionDurablePerdido
} from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import {
  ErrorContratoEjecutorOperacionAdministrativa,
  MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA
} from './CatalogoEjecutoresOperacionesAdministrativas.js';
import {
  CAUSAS_REINTENTABLES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA,
  CAUSAS_TERMINALES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA,
  CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
} from '../../coordinacion-durable/src/DiagnosticosOperacionesAdministrativas.js';

export class ErrorEjecucionOperacionAdministrativa extends Error {
  constructor(codigo, mensaje, { permanente = false, causa = null } = {}) {
    const esPermanente = Boolean(permanente);
    const catalogo = esPermanente ? CODIGOS_TERMINALES : CODIGOS_REINTENTABLES;
    if (!catalogo.has(codigo)) {
      throw new Error(
        `El diagnóstico ${codigo || '(vacío)'} no pertenece al catálogo ` +
          `${esPermanente ? 'terminal' : 'reintentable'}.`
      );
    }
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorEjecucionOperacionAdministrativa';
    this.codigo = codigo;
    this.permanente = esPermanente;
    this.esErrorOperacionAdministrativa = true;
  }
}

export class ProcesadorOperacionesAdministrativas {
  constructor({ coordinador, catalogoEjecutores } = {}) {
    if (typeof coordinador?.reclamarSiguiente !== 'function') {
      throw new Error('El procesador administrativo exige coordinación durable.');
    }
    if (typeof catalogoEjecutores?.resolver !== 'function') {
      throw new Error('El procesador administrativo exige un catálogo cerrado.');
    }
    this.coordinador = coordinador;
    this.catalogoEjecutores = catalogoEjecutores;
  }

  async procesarSiguiente() {
    const reclamada = await this.coordinador.reclamarSiguiente();
    if (reclamada === null) return null;
    const { lease, intentos, operacion } = reclamada;

    try {
      const ejecutor = this.catalogoEjecutores.resolver(
        operacion.tipo,
        operacion.version
      );
      const comando = ejecutor.validarComando(operacion.comando);
      const contexto = Object.freeze({
        operacion,
        intento: intentos,
        lease,
        avanzar: async (fase) => this.coordinador.avanzar(
          lease,
          { transicion: fase }
        ),
        renovarLease: async () => this.coordinador.renovar(lease)
      });
      const resultado = await ejecutor.ejecutar(comando, contexto);
      const validado = ejecutor.validarResultado(resultado);
      if (
        ejecutor.modoConsolidacion ===
          MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA.EJECUTOR_TRANSACCIONAL
      ) {
        return Object.freeze({
          operacionId: operacion.operacionId,
          estado: validado.estado,
          intento: intentos
        });
      }
      const cierre = await this.coordinador.consolidar(
        lease,
        { resultado: validado }
      );
      return Object.freeze({
        operacionId: operacion.operacionId,
        estado: cierre.estado,
        intento: intentos
      });
    } catch (error) {
      if (error instanceof LeaseOperacionDurablePerdido) throw error;
      const fallo = clasificarFallo(error);
      const registrado = await this.coordinador.registrarFallo(lease, {
        ...fallo,
        demoraReintentoSegundos: calcularDemoraReintento(intentos)
      });
      return Object.freeze({
        operacionId: operacion.operacionId,
        estado: registrado.estado,
        intento: intentos,
        codigo: fallo.codigo
      });
    }
  }
}

export function clasificarFalloOperacionAdministrativa(error) {
  return clasificarFallo(error);
}

function clasificarFallo(error) {
  if (error instanceof ErrorContratoEjecutorOperacionAdministrativa) {
    return Object.freeze({
      codigo:
        CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
          .CONTRATO_INCOMPATIBLE,
      mensaje: error.message,
      permanente: true
    });
  }
  if (error?.code === 'ER_LOCK_DEADLOCK') {
    return Object.freeze({
      codigo:
        CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA.DEADLOCK_SQL,
      mensaje: 'La operación encontró un interbloqueo SQL y se reintentará.',
      permanente: false
    });
  }
  if (error?.code === 'ER_LOCK_WAIT_TIMEOUT') {
    return Object.freeze({
      codigo:
        CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
          .TIMEOUT_BLOQUEO_SQL,
      mensaje: 'La operación agotó la espera de bloqueo SQL y se reintentará.',
      permanente: false
    });
  }
  if (ERRORES_CONEXION_SQL.has(error?.code)) {
    return Object.freeze({
      codigo:
        CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
          .CONEXION_SQL_TRANSITORIA,
      mensaje: 'La conexión SQL se interrumpió de forma transitoria.',
      permanente: false
    });
  }
  if (error instanceof ErrorEjecucionOperacionAdministrativa) {
    return Object.freeze({
      codigo: error.codigo,
      mensaje: error.message,
      permanente: error.permanente
    });
  }
  if (error?.esErrorOperacionAdministrativa === true &&
      /^[a-z][a-z0-9_]{0,63}$/u.test(String(error.codigo || ''))) {
    return Object.freeze({
      codigo: error.codigo,
      mensaje: error.message,
      permanente: error.permanente === true
    });
  }
  return Object.freeze({
    codigo:
      CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
        .ERROR_PERMANENTE,
    mensaje: error?.message || 'La operación administrativa falló sin diagnóstico.',
    permanente: true
  });
}

function calcularDemoraReintento(intentos) {
  const exponente = Math.max(0, Math.min(Number(intentos) - 1, 6));
  return Math.min(5 * (2 ** exponente), 300);
}

const ERRORES_CONEXION_SQL = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST'
]);

const CODIGOS_REINTENTABLES = new Set([
  ...CAUSAS_REINTENTABLES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
]);

const CODIGOS_TERMINALES = new Set([
  'agente_eliminacion_estructura_modificada',
  'agente_eliminacion_identidad_federada_incompleta',
  'agente_eliminacion_impacto_no_seguro',
  'agente_eliminacion_sujeto_ausente',
  ...CAUSAS_TERMINALES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
]);
