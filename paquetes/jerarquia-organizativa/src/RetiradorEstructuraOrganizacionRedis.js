export class RetiradorEstructuraOrganizacionRedis {
  constructor({
    clienteRedis,
    claveVersion = 'sentinelia:organizacion:estructura:version',
    canalInvalidaciones = 'sentinelia:organizacion:estructura:invalidaciones'
  } = {}) {
    if (typeof clienteRedis?.incr !== 'function' ||
        typeof clienteRedis?.publish !== 'function') {
      throw new Error('La retirada de estructura exige Redis operativo.');
    }
    this.clienteRedis = clienteRedis;
    this.claveVersion = texto(claveVersion, 'claveVersion');
    this.canalInvalidaciones = texto(canalInvalidaciones, 'canalInvalidaciones');
  }

  async retirar(objetivo) {
    const raiz = normalizarRaiz(objetivo);
    const version = Number(await this.clienteRedis.incr(this.claveVersion));
    const receptores = Number(await this.clienteRedis.publish(
      this.canalInvalidaciones,
      JSON.stringify({ perfil: 'estructura_organizacion_retirada_v1', version, raiz })
    ) || 0);
    return Object.freeze({ versionEstructura: version, receptores });
  }
}

function normalizarRaiz(objetivo = {}) {
  const tipo = String(objetivo.tipo || '');
  const id = String(objetivo.id || '');
  if (!['tenant', 'empresa', 'sitio'].includes(tipo) || !/^[1-9][0-9]*$/u.test(id)) {
    throw new TypeError('La retirada Redis exige una raíz organizativa válida.');
  }
  return Object.freeze({ tipo, id });
}

function texto(valor, campo) {
  const normalizado = String(valor || '').trim();
  if (!normalizado) throw new TypeError(`${campo} no puede estar vacío.`);
  return normalizado;
}
