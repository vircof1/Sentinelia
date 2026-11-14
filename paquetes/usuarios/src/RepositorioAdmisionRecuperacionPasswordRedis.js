import crypto from 'node:crypto';

import { exigirBuzonCanonicoCorreo }
  from '../../correo/src/NormalizadorBuzonCorreo.js';
import {
  DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL,
  crearHuellaRecuperacionPasswordEmail
} from './ContratoRecuperacionPasswordEmail.js';

const RETENCION_MAXIMA_CATALOGO_SEGUNDOS = 86_400;

const SCRIPT_REGISTRAR_INTENTO = `
local tiempo = redis.call('TIME')
local ahora = tonumber(tiempo[1]) * 1000 + math.floor(tonumber(tiempo[2]) / 1000)
local retencionMs = tonumber(ARGV[7]) * 1000
local ventanas = {tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])}

for indice=1,3 do
  redis.call('ZREMRANGEBYSCORE', KEYS[indice], '-inf', ahora - retencionMs)
  redis.call('ZADD', KEYS[indice], ahora, ARGV[indice])
  redis.call('PEXPIRE', KEYS[indice], retencionMs)
end

local origen = redis.call('ZCOUNT', KEYS[1], ahora - ventanas[1] * 1000, '+inf')
local par = redis.call('ZCOUNT', KEYS[2], ahora - ventanas[2] * 1000, '+inf')
local global = redis.call('ZCOUNT', KEYS[3], ahora - ventanas[3] * 1000, '+inf')
local admitida = origen <= tonumber(ARGV[8]) and
  par <= tonumber(ARGV[9]) and global <= tonumber(ARGV[10])

return cjson.encode({
  admitida=admitida,
  ahoraMs=ahora,
  origen=origen,
  par=par,
  global=global
})
`;

export class RepositorioAdmisionRecuperacionPasswordRedis {
  constructor({
    clienteRedis,
    prefijo = 'sentinelia:usuarios:recuperacion-password:v1:admision:',
    retencionMaximaSegundos = RETENCION_MAXIMA_CATALOGO_SEGUNDOS
  } = {}) {
    if (typeof clienteRedis?.eval !== 'function') {
      throw new Error('La admisión de recuperación requiere Redis operativo.');
    }
    this.redis = clienteRedis;
    this.prefijo = prefijoSeguro(prefijo);
    this.retencionMaximaSegundos = entero(
      retencionMaximaSegundos,
      1,
      RETENCION_MAXIMA_CATALOGO_SEGUNDOS,
      'retencionMaximaSegundos'
    );
  }

  async registrarIntento({ buzonCanonico, origenRed, configuracion } = {}) {
    const buzon = exigirBuzonCanonicoCorreo(buzonCanonico);
    const origen = texto(origenRed, 255, 'origenRed');
    const politica = validarConfiguracion(configuracion, this.retencionMaximaSegundos);
    const huellaOrigen = crearHuellaRecuperacionPasswordEmail(
      DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL.BUZON_ORIGEN,
      `origen\0${origen}`
    );
    const huellaPar = crearHuellaRecuperacionPasswordEmail(
      DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL.BUZON_ORIGEN,
      `par\0${buzon}\0${origen}`
    );
    const intentoId = crypto.randomUUID();
    const resultado = await this.redis.eval(SCRIPT_REGISTRAR_INTENTO, {
      keys: [
        `${this.prefijo}origen:${huellaOrigen}`,
        `${this.prefijo}par:${huellaPar}`,
        `${this.prefijo}global`
      ],
      arguments: [
        `${intentoId}:origen`,
        `${intentoId}:par`,
        `${intentoId}:global`,
        String(politica.origenVentanaSegundos),
        String(politica.parVentanaSegundos),
        String(politica.globalVentanaSegundos),
        String(this.retencionMaximaSegundos),
        String(politica.origenIntentosMaximos),
        String(politica.parIntentosMaximos),
        String(politica.globalIntentosMaximos)
      ]
    });
    const evaluacion = JSON.parse(resultado);
    return Object.freeze({
      admitida: evaluacion.admitida === true,
      observadaEnUtc: new Date(Number(evaluacion.ahoraMs)).toISOString(),
      conteos: Object.freeze({
        origen: Number(evaluacion.origen),
        par: Number(evaluacion.par),
        global: Number(evaluacion.global)
      })
    });
  }
}

function validarConfiguracion(configuracion, retencionMaximaSegundos) {
  const politica = {
    origenVentanaSegundos: entero(configuracion?.recuperacionEmailOrigenVentanaSegundos,
      1, retencionMaximaSegundos, 'recuperacionEmailOrigenVentanaSegundos'),
    origenIntentosMaximos: entero(configuracion?.recuperacionEmailOrigenIntentosMaximos,
      1, 100_000, 'recuperacionEmailOrigenIntentosMaximos'),
    parVentanaSegundos: entero(configuracion?.recuperacionEmailParVentanaSegundos,
      1, retencionMaximaSegundos, 'recuperacionEmailParVentanaSegundos'),
    parIntentosMaximos: entero(configuracion?.recuperacionEmailParIntentosMaximos,
      1, 100_000, 'recuperacionEmailParIntentosMaximos'),
    globalVentanaSegundos: entero(configuracion?.recuperacionEmailGlobalVentanaSegundos,
      1, retencionMaximaSegundos, 'recuperacionEmailGlobalVentanaSegundos'),
    globalIntentosMaximos: entero(configuracion?.recuperacionEmailGlobalIntentosMaximos,
      1, 1_000_000, 'recuperacionEmailGlobalIntentosMaximos')
  };
  return Object.freeze(politica);
}

function prefijoSeguro(valor) {
  const prefijo = String(valor || '').trim();
  if (!prefijo || /[\r\n\s]/u.test(prefijo)) {
    throw new Error('El prefijo Redis de admisión no es válido.');
  }
  return prefijo.endsWith(':') ? prefijo : `${prefijo}:`;
}

function texto(valor, maximo, campo) {
  const normalizado = String(valor ?? '').trim();
  if (!normalizado || normalizado.length > maximo) {
    throw new Error(`${campo} no es válido.`);
  }
  return normalizado;
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe ser un entero entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

export const RETENCION_MAXIMA_ADMISION_RECUPERACION_PASSWORD_SEGUNDOS =
  RETENCION_MAXIMA_CATALOGO_SEGUNDOS;
