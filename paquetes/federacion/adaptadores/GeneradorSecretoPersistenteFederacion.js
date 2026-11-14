import { randomBytes } from 'node:crypto';

export class GeneradorSecretoPersistenteFederacion {
  constructor({ generarBytes = randomBytes } = {}) {
    if (typeof generarBytes !== 'function') {
      throw new Error('El secreto persistente requiere entropía criptográfica.');
    }
    this.generarBytes = generarBytes;
  }

  generar() {
    const bytes = this.generarBytes(48);
    if (!Buffer.isBuffer(bytes) || bytes.length !== 48) {
      throw new Error('La fuente debe entregar 384 bits para el secreto persistente.');
    }
    return `sfr1_${bytes.toString('base64url')}`;
  }
}

export class ProvisionadorCanjePendienteNoDisponible {
  async registrarEnTransaccion() {
    throw new DependenciaCredencialPersistenteNoDisponible();
  }
}

export class DependenciaCredencialPersistenteNoDisponible extends Error {
  constructor() {
    super('El almacenamiento protegido de la credencial persistente aún no está disponible.');
    this.name = 'DependenciaCredencialPersistenteNoDisponible';
    this.codigo = 'DEPENDENCIA_CREDENCIAL_PERSISTENTE_NO_DISPONIBLE';
    this.statusCode = 503;
  }
}
