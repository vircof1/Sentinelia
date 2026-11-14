import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

const PREFIJO_SECRETO_AGENTE = 'sa_';

export class GeneradorCredencialesAgenteSentinelia {
  generarGuid() {
    return randomUUID();
  }

  generarSecretoPersistente() {
    return `${PREFIJO_SECRETO_AGENTE}${randomBytes(32).toString('base64url')}`;
  }

  async generarParCredenciales() {
    const guid = this.generarGuid();
    const secreto = this.generarSecretoPersistente();
    const secretoHash = await this.crearHashSecreto(secreto);

    return {
      guid,
      secreto,
      secretoHash
    };
  }

  async crearHashSecreto(secreto) {
    const secretoNormalizado = String(secreto || '').trim();

    if (secretoNormalizado.length < 32) {
      throw new Error('El secreto persistente del agente no es válido.');
    }

    return bcrypt.hash(secretoNormalizado, 12);
  }
}
