import { sanearDiagnosticoOperacionDurable } from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ESTADOS_PUBLICACION_DNS } from './EstadosPublicacionDns.js';

export class ServicioConsolidacionPublicacionBindDns {
  constructor({ coordinador } = {}) {
    if (!coordinador?.consolidar || !coordinador?.registrarFallo || !coordinador?.avanzar) {
      throw new Error('La consolidación BIND requiere coordinador durable completo.');
    }
    this.coordinador = coordinador;
  }

  async confirmarAplicada({ lease, operacion, resultado } = {}) {
    exigirLeaseOperacion(lease, operacion);
    if (operacion.estado !== ESTADOS_PUBLICACION_DNS.RECARGA_CONFIRMADA ||
        !operacion.recargaConfirmadaEnUtc) {
      throw new Error('Solo una recarga observada y confirmada puede producir dns.publicacion_aplicada.');
    }
    const consolidada = await this.coordinador.consolidar(lease, {
      resultado: normalizarResultado(resultado)
    });
    return Object.freeze({
      accion: 'publicacion_aplicada',
      operacion: consolidada.operacion
    });
  }

  async confirmarFalloEstablePrevioEfecto({
    lease,
    operacion,
    diagnostico,
    resultado = {},
    demoraReintentoSegundos = 5
  } = {}) {
    exigirLeaseOperacion(lease, operacion);
    if (operacion.estado !== ESTADOS_PUBLICACION_DNS.PENDIENTE || operacion.efectoPosible) {
      throw new Error('Solo un fallo estable anterior al efecto filesystem puede producir dns.publicacion_fallida.');
    }
    const fallo = await this.coordinador.registrarFallo(lease, {
      ...sanearDiagnosticoOperacionDurable(diagnostico),
      permanente: true,
      demoraReintentoSegundos,
      resumen: normalizarResultado(resultado)
    });
    return Object.freeze({
      accion: 'publicacion_fallida',
      operacion: fallo.operacion
    });
  }

  async dejarRecargaRecuperable({ lease, operacion, diagnostico } = {}) {
    exigirLeaseOperacion(lease, operacion);
    if (!operacion.efectoPosible ||
        ![
          ESTADOS_PUBLICACION_DNS.EFECTO_INICIADO,
          ESTADOS_PUBLICACION_DNS.RECUPERACION_PENDIENTE
        ].includes(operacion.estado)) {
      throw new Error('Solo una operación con efecto posible sin recarga observada puede quedar recuperable.');
    }
    const recuperable = await this.coordinador.avanzar(lease, {
      transicion: 'recuperacion_pendiente',
      datos: { diagnostico: sanearDiagnosticoOperacionDurable(diagnostico) }
    });
    return Object.freeze({
      accion: 'recarga_recuperable',
      operacion: recuperable.operacion
    });
  }
}

function exigirLeaseOperacion(lease, operacion) {
  if (!lease || !operacion || String(lease.operacionId) !== String(operacion.generacionDns)) {
    throw new Error('La consolidación BIND requiere lease y operación de la misma generación.');
  }
}

function normalizarResultado(resultado = {}) {
  return Object.freeze({
    zonas: decimalNoNegativo(resultado.zonas ?? 0, 'resultado.zonas'),
    artefactos: decimalNoNegativo(resultado.artefactos ?? 0, 'resultado.artefactos'),
    cambios: decimalNoNegativo(resultado.cambios ?? 0, 'resultado.cambios'),
    diagnostico: resultado.diagnostico || null
  });
}

function decimalNoNegativo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/.test(texto)) {
    throw new Error(`${nombre} debe ser decimal canónico no negativo.`);
  }
  return texto;
}
