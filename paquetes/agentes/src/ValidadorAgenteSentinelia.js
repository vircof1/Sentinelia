import {
  normalizarEstadoAccesoAgente,
  normalizarEstadoAdministrativoAgente
} from './EstadosAgenteSentinelia.js';

const PATRON_GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ValidadorAgenteSentinelia {
  normalizarDefinicionBase({
    guid,
    tenantId,
    empresaId,
    sitioId,
    nombre,
    descripcion = '',
    secretoHash,
    estadoAdministrativo = 'activo',
    estadoAcceso = 'normal',
    cuarentenaHastaUtc = null
  }) {
    return {
      guid: this.normalizarGuid(guid),
      tenantId: this.normalizarId(tenantId, 'El tenant del agente es obligatorio.'),
      empresaId: this.normalizarId(
        empresaId,
        'La empresa del agente es obligatoria.'
      ),
      sitioId: this.normalizarId(sitioId, 'El sitio del agente es obligatorio.'),
      nombre: this.normalizarNombre(nombre),
      descripcion: this.normalizarDescripcion(descripcion),
      secretoHash: this.normalizarSecretoHash(secretoHash),
      estadoAdministrativo:
        normalizarEstadoAdministrativoAgente(estadoAdministrativo),
      estadoAcceso: normalizarEstadoAccesoAgente(estadoAcceso),
      cuarentenaHastaUtc: this.normalizarFechaOpcional(cuarentenaHastaUtc)
    };
  }

  normalizarGuid(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();

    if (!PATRON_GUID.test(normalizado)) {
      throw new Error('El GUID técnico del agente no es válido.');
    }

    return normalizado;
  }

  normalizarId(valor, mensaje) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      throw new Error(mensaje);
    }

    return convertido;
  }

  normalizarNombre(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length < 3 || normalizado.length > 160) {
      throw new Error('El nombre del agente debe tener entre 3 y 160 caracteres.');
    }

    return normalizado;
  }

  normalizarDescripcion(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length > 512) {
      throw new Error('La descripción del agente no puede superar 512 caracteres.');
    }

    return normalizado || null;
  }

  normalizarSecretoHash(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length < 20 || normalizado.length > 255) {
      throw new Error('El hash del secreto persistente del agente no es válido.');
    }

    return normalizado;
  }

  normalizarEstadoAdministrativo(valor) {
    return normalizarEstadoAdministrativoAgente(valor);
  }

  normalizarFechaOpcional(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    const fecha = new Date(String(valor).replace(' ', 'T'));

    if (Number.isNaN(fecha.getTime())) {
      throw new Error('La fecha de cuarentena del agente no es válida.');
    }

    return valor;
  }
}
