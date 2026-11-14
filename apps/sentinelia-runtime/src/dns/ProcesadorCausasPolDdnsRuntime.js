import {
  LeaseOperacionDurablePerdido
} from '../../../../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';

export class ProcesadorCausasPolDdnsRuntime {
  constructor({
    coordinador,
    repositorioConcesiones,
    procesarConcesionEnTransaccion,
    demoraReintentoSegundos = 5
  } = {}) {
    if (typeof coordinador?.reclamarSiguiente !== 'function' ||
        typeof coordinador?.renovar !== 'function' ||
        typeof coordinador?.avanzar !== 'function' ||
        typeof coordinador?.consolidar !== 'function' ||
        typeof coordinador?.registrarFallo !== 'function') {
      throw new Error('El fan-out POL DDNS requiere coordinación durable completa.');
    }
    if (typeof repositorioConcesiones?.listarObservadasAptasPorAgente !== 'function') {
      throw new Error('El fan-out POL DDNS requiere consultar concesiones observadas aptas.');
    }
    if (typeof procesarConcesionEnTransaccion !== 'function') {
      throw new Error('El fan-out POL DDNS requiere una unidad transaccional por concesión.');
    }
    this.coordinador = coordinador;
    this.repositorioConcesiones = repositorioConcesiones;
    this.procesarConcesionEnTransaccion = procesarConcesionEnTransaccion;
    this.demoraReintentoSegundos = normalizarDemora(demoraReintentoSegundos);
  }

  async procesarSiguiente() {
    const reclamada = await this.coordinador.reclamarSiguiente();
    if (reclamada === null) return null;
    const { lease, intentos, operacion } = reclamada;
    const causa = Object.freeze({
      causaId: lease.operacionId,
      ...operacion
    });
    try {
      const candidatas = causa.familiaDireccion === null
        ? []
        : await this.repositorioConcesiones
          .listarObservadasAptasPorAgente(causa.agenteId);
      await this.coordinador.avanzar(lease, { transicion: 'fanout_preparado' });
      const resultados = [];
      for (const concesion of candidatas) {
        await this.coordinador.renovar(lease);
        try {
          resultados.push(Object.freeze({
            concesionId: concesion.concesionId,
            ok: true,
            resultado: await this.procesarConcesionEnTransaccion({
              causa,
              concesion
            })
          }));
        } catch (error) {
          resultados.push(Object.freeze({
            concesionId: concesion.concesionId,
            ok: false,
            codigo: codigoError(error)
          }));
        }
      }
      const fallidos = resultados.filter((resultado) => !resultado.ok);
      if (fallidos.length > 0) {
        await this.coordinador.registrarFallo(lease, {
          codigo: 'fanout_pol_ddns_incompleto',
          mensaje: `Fallaron ${fallidos.length} de ${resultados.length} concesiones DDNS.`,
          permanente: false,
          demoraReintentoSegundos: this.demoraReintentoSegundos,
          resumen: { total: resultados.length, fallidos: fallidos.length }
        });
        return respuesta(causa, intentos, 'reintentable', resultados);
      }
      await this.coordinador.consolidar(lease, {
        resultado: { total: resultados.length }
      });
      return respuesta(causa, intentos, 'completada', resultados);
    } catch (error) {
      if (error instanceof LeaseOperacionDurablePerdido) throw error;
      await this.coordinador.registrarFallo(lease, {
        codigo: codigoError(error),
        mensaje: error?.message || 'No se pudo preparar el fan-out POL DDNS.',
        permanente: false,
        demoraReintentoSegundos: this.demoraReintentoSegundos
      });
      return respuesta(causa, intentos, 'reintentable', []);
    }
  }
}

function respuesta(causa, intento, estado, resultados) {
  return Object.freeze({
    causaId: causa.causaId,
    estado,
    intento,
    total: resultados.length,
    correctos: resultados.filter((resultado) => resultado.ok).length,
    fallidos: resultados.filter((resultado) => !resultado.ok).length,
    resultados: Object.freeze([...resultados])
  });
}

function codigoError(error) {
  return String(error?.codigo || error?.code || 'fanout_pol_ddns_fallido')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .slice(0, 64) || 'fanout_pol_ddns_fallido';
}

function normalizarDemora(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 300) {
    throw new TypeError('La demora del fan-out POL DDNS debe estar entre 1 y 300 segundos.');
  }
  return numero;
}
