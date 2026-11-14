import { uuidV7AuditoriaABytes }
  from '../../auditoria/src/UuidV7Auditoria.js';

export class FinalizadorConvergenciaPostcommitOperacionesAdministrativas {
  constructor({ finalizadores = [] } = {}) {
    this.finalizadores = new Map();
    for (const entrada of finalizadores) {
      const clave = contrato(entrada?.tipo, entrada?.version);
      if (this.finalizadores.has(clave) ||
          typeof entrada?.finalizador?.finalizarEnTransaccion !== 'function') {
        throw new Error('El catálogo de convergencia contiene una entrada inválida.');
      }
      this.finalizadores.set(clave, entrada.finalizador);
    }
    if (this.finalizadores.size === 0) {
      throw new Error('El catálogo de convergencia no puede estar vacío.');
    }
  }

  async finalizarEnTransaccion({ operacionId } = {}, { conexion } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('La convergencia común exige una conexión prestada.');
    }
    const [filas] = await conexion.execute(
      `SELECT tipo,version_contrato
         FROM operaciones_administrativas
        WHERE operacion_id=? FOR UPDATE`,
      [uuidV7AuditoriaABytes(operacionId)]
    );
    if (!filas[0]) {
      return Object.freeze({
        completada: true,
        notificacion: null,
        destinatarioUsuarioId: null,
        motivo: 'operacion_compactada'
      });
    }
    const finalizador = this.finalizadores.get(
      contrato(filas[0].tipo, filas[0].version_contrato)
    );
    if (!finalizador) {
      throw new Error('La operación no posee finalizador postcommit registrado.');
    }
    return finalizador.finalizarEnTransaccion({ operacionId }, { conexion });
  }
}

function contrato(tipo, version) {
  const nombre = String(tipo || '');
  const numero = Number(version);
  if (!nombre || !Number.isInteger(numero) || numero < 1) {
    throw new TypeError('El contrato de convergencia no es válido.');
  }
  return `${nombre}@${numero}`;
}
