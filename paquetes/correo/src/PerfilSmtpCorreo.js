import crypto from 'node:crypto';

import {
  PERFIL_MATERIAL_HMAC_CORREO,
  TIPOS_VALOR_HMAC_CORREO,
  VERSION_PRUEBA_SMTP_TRIGGER_CORREO,
  crearMaterialHmacConfiguracionCorreo
} from './ContratoTriggerCorreo.js';
import {
  CLAVES_CORREO_REQUIEREN_REVERIFICACION
} from './CatalogoConfiguracionCorreo.js';
import {
  VERSION_NORMALIZACION_BUZON_CORREO,
  normalizarBuzonCorreo,
  normalizarNombrePresentacionCorreo
} from './NormalizadorBuzonCorreo.js';

const BOOLEANAS = new Set([
  'correo.activo',
  'correo.smtp_secure',
  'correo.smtp_tls_permitir_inseguro'
]);
const ENTERAS = new Set([
  'correo.smtp_puerto',
  'correo.smtp_timeout_conexion_ms',
  'correo.smtp_timeout_saludo_ms',
  'correo.smtp_timeout_socket_ms'
]);

export class PerfilSmtpCorreo {
  constructor({ keyringTecnicoCorreo }) {
    if (!keyringTecnicoCorreo?.obtenerActiva || !keyringTecnicoCorreo?.obtener) {
      throw new Error('El perfil SMTP requiere el keyring técnico de correo.');
    }
    this.keyringTecnicoCorreo = keyringTecnicoCorreo;
  }

  crearPrueba(filasConfiguracion) {
    const material = crearMaterial(filasConfiguracion);
    const activa = this.keyringTecnicoCorreo.obtenerActiva();
    return Object.freeze({
      perfilVersion: VERSION_PRUEBA_SMTP_TRIGGER_CORREO,
      perfilBuzon: VERSION_NORMALIZACION_BUZON_CORREO,
      keyId: activa.keyId,
      huellaHmac: calcularHmac(activa.clave, material.materialUtf8)
    });
  }

  crearPruebaConKeyId(filasConfiguracion, keyId) {
    const clave = this.keyringTecnicoCorreo.obtener(keyId);
    if (!clave) throw new Error(`La clave HMAC ${keyId} no está disponible.`);
    return this.crearPruebaConClave(filasConfiguracion, { keyId, clave });
  }

  evaluarPrueba({ filasConfiguracion, estadoVerificacion, versionConfiguracion }) {
    if (!estadoVerificacion || Number(estadoVerificacion.verificado) !== 1) {
      return resultado(false, 'correo_smtp_no_verificado');
    }
    if (estadoVerificacion.perfil_version !== VERSION_PRUEBA_SMTP_TRIGGER_CORREO) {
      return resultado(false, 'correo_perfil_smtp_incompatible');
    }
    if (!/^[1-9][0-9]*$/u.test(String(estadoVerificacion.configuracion_version)) ||
        !/^[1-9][0-9]*$/u.test(String(versionConfiguracion))) {
      return resultado(false, 'correo_version_configuracion_invalida');
    }
    const clave = this.keyringTecnicoCorreo.obtener(estadoVerificacion.key_id);
    if (!clave) return resultado(false, 'correo_clave_hmac_ausente');
    let prueba;
    try {
      prueba = this.crearPruebaConClave(filasConfiguracion, {
        keyId: estadoVerificacion.key_id,
        clave
      });
    } catch {
      return resultado(false, 'correo_perfil_smtp_no_renderizable');
    }
    const esperada = normalizarHuella(estadoVerificacion.huella_hmac);
    if (!esperada || !crypto.timingSafeEqual(esperada, prueba.huellaHmac)) {
      return resultado(false, 'correo_huella_smtp_no_coincide');
    }
    return resultado(true, 'correo_smtp_verificado', prueba);
  }

  crearPruebaConClave(filasConfiguracion, { keyId, clave }) {
    const material = crearMaterial(filasConfiguracion);
    return Object.freeze({
      perfilVersion: VERSION_PRUEBA_SMTP_TRIGGER_CORREO,
      perfilBuzon: VERSION_NORMALIZACION_BUZON_CORREO,
      keyId,
      huellaHmac: calcularHmac(clave, material.materialUtf8)
    });
  }
}

function crearMaterial(filasConfiguracion) {
  const valores = filasConfiguracion instanceof Map
    ? filasConfiguracion
    : new Map((filasConfiguracion || []).map((fila) => [fila.clave, fila.valor]));
  const entradas = CLAVES_CORREO_REQUIEREN_REVERIFICACION.map((clave) => {
    if (!valores.has(clave)) throw new Error(`Falta ${clave} en el perfil SMTP.`);
    return normalizarEntrada(clave, valores.get(clave));
  });
  return crearMaterialHmacConfiguracionCorreo({
    perfil: PERFIL_MATERIAL_HMAC_CORREO,
    version: 1,
    perfilSmtp: VERSION_PRUEBA_SMTP_TRIGGER_CORREO,
    perfilBuzon: VERSION_NORMALIZACION_BUZON_CORREO,
    entradas
  });
}

function normalizarEntrada(clave, valor) {
  if (BOOLEANAS.has(clave)) {
    return { clave, tipo: TIPOS_VALOR_HMAC_CORREO.BOOLEANO, valor: booleano(valor) };
  }
  if (ENTERAS.has(clave)) {
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero)) throw new Error(`${clave} no es un entero seguro.`);
    return { clave, tipo: TIPOS_VALOR_HMAC_CORREO.ENTERO, valor: numero };
  }
  let texto = String(valor ?? '');
  if (clave === 'correo.remitente_email') {
    texto = normalizarBuzonCorreo(texto).canonico;
  } else if (clave === 'correo.remitente_nombre') {
    texto = normalizarNombrePresentacionCorreo(texto, { permitirVacio: false });
  } else if (clave === 'correo.smtp_auth_method') {
    texto = texto.trim().toUpperCase();
  } else if (clave === 'correo.smtp_password') {
    // La contraseña es una credencial opaca: su whitespace también es material.
    texto = String(valor ?? '');
  } else {
    texto = texto.trim();
  }
  return { clave, tipo: TIPOS_VALOR_HMAC_CORREO.TEXTO, valor: texto };
}

function booleano(valor) {
  const texto = String(valor).trim().toLowerCase();
  if (['1', 'true', 'si', 'yes', 'on'].includes(texto)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(texto)) return false;
  throw new Error('El perfil SMTP contiene un booleano no canónico.');
}

function calcularHmac(clave, material) {
  return crypto.createHmac('sha256', clave).update(material, 'utf8').digest();
}

function normalizarHuella(valor) {
  if (Buffer.isBuffer(valor) && valor.length === 32) return Buffer.from(valor);
  if (typeof valor === 'string' && /^[0-9a-f]{64}$/u.test(valor)) {
    return Buffer.from(valor, 'hex');
  }
  return null;
}

function resultado(puedeDespachar, codigo, prueba = null) {
  return Object.freeze({ puedeDespachar, codigo, prueba });
}
