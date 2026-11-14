import { createHash, randomBytes, randomUUID } from 'node:crypto';

const PREFIJO_SESSION_ID_AGENTE = 'ags_';
const PREFIJO_SESSION_TOKEN_AGENTE = 'sat_';

export class GeneradorSesionAgenteSentinelia {
  generarSessionId() {
    return `${PREFIJO_SESSION_ID_AGENTE}${randomUUID()}`;
  }

  generarSessionToken() {
    return `${PREFIJO_SESSION_TOKEN_AGENTE}${randomBytes(48).toString('base64url')}`;
  }

  generarParSesion() {
    const sessionId = this.generarSessionId();
    const sessionToken = this.generarSessionToken();

    return {
      sessionId,
      sessionToken,
      sessionTokenHash: calcularHuellaSesionAgente(sessionToken)
    };
  }
}

export function calcularHuellaSesionAgente(sessionToken) {
  const tokenNormalizado = String(sessionToken || '').trim();

  if (!tokenNormalizado) {
    throw new Error('El token de sesión del agente es obligatorio.');
  }

  return createHash('sha256').update(tokenNormalizado).digest('hex');
}
