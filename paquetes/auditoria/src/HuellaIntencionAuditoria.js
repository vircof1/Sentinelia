import { createHash } from 'node:crypto';
import {
  PERFIL_JCS_AUDITORIA_V1,
  canonicalizarJcsAuditoriaV1
} from './PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1,
  construirSobreCanonicoAuditoriaV1
} from './SobreCanonicoAuditoria.js';

export const VERSION_HUELLA_INTENCION_AUDITORIA_V1 =
  'sentinelia-auditoria-intencion-v1';
export const VERSION_HUELLA_EVENTO_ID_AUDITORIA_V1 =
  'sentinelia-auditoria-evento-id-v1';

const SEPARADOR_DOMINIO = Buffer.from([0]);
const DOMINIO_INTENCION = Buffer.from(
  VERSION_HUELLA_INTENCION_AUDITORIA_V1,
  'utf8'
);
const DOMINIO_EVENTO_ID = Buffer.from(
  VERSION_HUELLA_EVENTO_ID_AUDITORIA_V1,
  'utf8'
);
const CAMPOS_INTENCION = Object.freeze([
  'eventoId',
  'tipo',
  'versionContrato',
  'flujo',
  'claveCadena',
  'actorReal',
  'actorEfectivo',
  'modoActuacion',
  'sujeto',
  'origen',
  'scope',
  'correlacionId',
  'causalidad',
  'productor',
  'claveOperacion',
  'rolEvento',
  'efectivoEnUtc',
  'versionCanonicalizador',
  'versionEncadenado',
  'payload'
]);

export function prepararIntencionAuditoriaV1(entrada = {}) {
  exigirObjetoPlano(entrada, 'intención');
  const entradaCanonica = { ...entrada };
  delete entradaCanonica.actor;
  exigirClavesExactas(entradaCanonica, CAMPOS_INTENCION, 'intención');

  const sobreValidado = construirSobreCanonicoAuditoriaV1({
    ...entradaCanonica,
    secuencia: entradaCanonica.tipo === 'cadena.iniciada' ? '1' : '2',
    registradoEnUtc: entradaCanonica.efectivoEnUtc
  });
  const intencion = Object.fromEntries(
    CAMPOS_INTENCION.map((campo) => [campo, sobreValidado[campo]])
  );
  const canonico = canonicalizarJcsAuditoriaV1(intencion);
  const huella = sha256(
    DOMINIO_INTENCION,
    SEPARADOR_DOMINIO,
    Buffer.from(canonico, 'utf8')
  );

  congelarProfundo(intencion);
  return Object.freeze({ intencion, canonico, huella });
}

export function obtenerHuellaEventoIdAuditoriaV1(eventoIdBinario) {
  exigir(
    eventoIdBinario instanceof Uint8Array && eventoIdBinario.byteLength === 16,
    'eventoId binario debe contener exactamente 16 bytes.'
  );
  return sha256(
    DOMINIO_EVENTO_ID,
    SEPARADOR_DOMINIO,
    Buffer.from(eventoIdBinario)
  );
}

export function construirIntencionGenesisAuditoriaV1({
  eventoId,
  flujo,
  claveCadena,
  tenantId,
  origen,
  correlacionId,
  efectivoEnUtc
}) {
  const scopeCadena = {
    tenantId: tenantId == null ? null : String(tenantId),
    empresaId: null,
    sitioId: null
  };
  return {
    eventoId,
    tipo: 'cadena.iniciada',
    versionContrato: 1,
    flujo,
    claveCadena,
    actorReal: { tipo: 'sistema', id: 'sentinelia-system' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'cadena_auditoria', id: claveCadena },
    origen,
    scope: scopeCadena,
    correlacionId,
    causalidad: null,
    productor: 'auditoria_nucleo',
    claveOperacion: `genesis:v1:${claveCadena}`,
    rolEvento: 'principal',
    efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      flujo,
      claveCadena,
      scopeCadena,
      versiones: {
        contrato: 1,
        canonicalizador: PERFIL_JCS_AUDITORIA_V1,
        encadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }
  };
}

function sha256(...partes) {
  const hash = createHash('sha256');
  for (const parte of partes) hash.update(parte);
  return hash.digest();
}

function exigirClavesExactas(objeto, esperadas, nombre) {
  const claves = Reflect.ownKeys(objeto);
  exigir(
    claves.every((clave) => typeof clave === 'string'),
    `${nombre} contiene claves no representables en JSON.`
  );
  const actuales = claves.sort();
  const objetivo = [...esperadas].sort();
  exigir(
    actuales.length === objetivo.length &&
      actuales.every((clave, indice) => clave === objetivo[indice]),
    `${nombre} contiene campos ausentes o desconocidos.`
  );
}

function exigirObjetoPlano(valor, nombre) {
  exigir(
    valor !== null &&
      typeof valor === 'object' &&
      !Array.isArray(valor) &&
      Object.getPrototypeOf(valor) === Object.prototype,
    `${nombre} debe ser un objeto JSON plano.`
  );
}

function congelarProfundo(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelarProfundo(hijo);
    Object.freeze(valor);
  }
  return valor;
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
