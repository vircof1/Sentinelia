const CANAL_DEFECTO = 'sentinelia:buzon-usuarios:v1:invalidaciones';

export class CanalInvalidacionesBuzonUsuariosRedis {
  constructor({ clienteRedis, canal = CANAL_DEFECTO, reloj = () => new Date() } = {}) {
    if (typeof clienteRedis?.publish !== 'function' ||
        typeof clienteRedis?.duplicate !== 'function') {
      throw new Error('El canal del buzón requiere Redis con pub/sub.');
    }
    if (typeof reloj !== 'function') throw new Error('El reloj del canal no es válido.');
    this.clienteRedis = clienteRedis;
    this.canal = nombreCanal(canal);
    this.reloj = reloj;
    this.suscriptor = null;
  }

  async publicar({ destinatarioUsuarioId, firmaBuzon } = {}) {
    const mensaje = normalizarMensaje({
      version: 1,
      destinatarioUsuarioId,
      firmaBuzon,
      emitidaEnUtc: this.reloj().toISOString()
    });
    return this.clienteRedis.publish(this.canal, JSON.stringify(mensaje));
  }

  async suscribir(onInvalidacion) {
    if (this.suscriptor) throw new Error('El canal del buzón ya está suscrito.');
    if (typeof onInvalidacion !== 'function') throw new Error('Falta el receptor del buzón.');
    const suscriptor = this.clienteRedis.duplicate();
    suscriptor.on('error', (error) => {
      console.error(`[buzon-usuarios] Redis no disponible: ${codigoSeguro(error)}`);
    });
    await suscriptor.connect();
    await suscriptor.subscribe(this.canal, (contenido) => {
      try {
        if (typeof contenido !== 'string' || contenido.length > 2048) {
          throw new Error('La invalidación excede el tamaño admitido.');
        }
        return onInvalidacion(normalizarMensaje(JSON.parse(contenido)));
      } catch (error) {
        console.error(
          `[buzon-usuarios] Invalidación descartada: ${codigoSeguro(error)}`
        );
        return undefined;
      }
    });
    this.suscriptor = suscriptor;
  }

  async cerrar() {
    if (!this.suscriptor) return;
    const suscriptor = this.suscriptor;
    this.suscriptor = null;
    await suscriptor.unsubscribe(this.canal);
    await suscriptor.quit();
  }
}

function normalizarMensaje(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
      Object.keys(entrada).sort().join(',') !==
        'destinatarioUsuarioId,emitidaEnUtc,firmaBuzon,version' ||
      entrada.version !== 1) {
    throw new Error('La invalidación del buzón no cumple la versión 1.');
  }
  const destinatarioUsuarioId = String(entrada.destinatarioUsuarioId ?? '');
  if (!/^[1-9][0-9]*$/u.test(destinatarioUsuarioId)) {
    throw new Error('El destinatario de la invalidación no es válido.');
  }
  const firmaBuzon = String(entrada.firmaBuzon || '');
  if (!/^[0-9a-f]{64}$/u.test(firmaBuzon)) {
    throw new Error('La firma durable del buzón no es válida.');
  }
  const fecha = new Date(entrada.emitidaEnUtc);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString() !== entrada.emitidaEnUtc) {
    throw new Error('La fecha de invalidación no es UTC canónica.');
  }
  return Object.freeze({
    version: 1,
    destinatarioUsuarioId,
    firmaBuzon,
    emitidaEnUtc: entrada.emitidaEnUtc
  });
}

function nombreCanal(valor) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > 255 || !/^[\x21-\x7e]+$/u.test(texto)) {
    throw new Error('El nombre del canal del buzón no es válido.');
  }
  return texto;
}

function codigoSeguro(error) {
  return String(error?.codigo || error?.code || 'error_canal_buzon')
    .replace(/[^a-z0-9_.-]+/giu, '_')
    .slice(0, 64);
}
