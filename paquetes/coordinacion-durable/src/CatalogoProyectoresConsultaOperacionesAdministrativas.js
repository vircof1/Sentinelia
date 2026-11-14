export class CatalogoProyectoresConsultaOperacionesAdministrativas {
  #porContrato;

  constructor({ proyectores = [] } = {}) {
    if (!Array.isArray(proyectores) || proyectores.length === 0) {
      throw new Error('La consulta exige proyectores de operación explícitos.');
    }
    this.#porContrato = new Map();
    for (const proyector of proyectores) this.#registrar(proyector);
    Object.freeze(this);
  }

  async proyectarSujeto(contextoUsuarioActual, operacion) {
    const clave = claveContrato(operacion?.tipo, operacion?.version);
    const proyector = this.#porContrato.get(clave);
    if (!proyector) return null;
    return proyector.proyectarSujeto(contextoUsuarioActual, operacion);
  }

  listarContratos() {
    return Object.freeze([...this.#porContrato.keys()].sort());
  }

  #registrar(proyector) {
    if (typeof proyector?.proyectarSujeto !== 'function') {
      throw new Error('El proyector de consulta no satisface su puerto.');
    }
    const clave = claveContrato(proyector.tipo, proyector.version);
    if (this.#porContrato.has(clave)) {
      throw new Error(`El contrato ${clave} posee más de un proyector de consulta.`);
    }
    this.#porContrato.set(clave, Object.freeze({
      proyectarSujeto: proyector.proyectarSujeto.bind(proyector)
    }));
  }
}

function claveContrato(tipo, version) {
  const codigo = String(tipo || '');
  const revision = Number(version);
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(codigo) ||
      !Number.isSafeInteger(revision) || revision < 1 || revision > 65_535) {
    throw new Error('La identidad del contrato de consulta no es válida.');
  }
  return `${codigo}@${revision}`;
}
