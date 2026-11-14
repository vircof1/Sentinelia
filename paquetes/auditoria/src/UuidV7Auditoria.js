import {
  parse as parsearUuid,
  stringify as serializarUuid,
  v7 as generarUuidV7,
  validate as validarUuid,
  version as obtenerVersionUuid
} from 'uuid';

const PATRON_UUID_V7_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function generarUuidV7Auditoria() {
  const uuid = generarUuidV7();
  validarUuidV7Auditoria(uuid);
  return uuid;
}

export function validarUuidV7Auditoria(valor, nombre = 'uuid') {
  exigir(
    typeof valor === 'string' && PATRON_UUID_V7_CANONICO.test(valor),
    `${nombre} debe ser un UUIDv7 textual canónico en minúsculas.`
  );
  exigir(validarUuid(valor) && obtenerVersionUuid(valor) === 7, `${nombre} no es un UUIDv7 RFC 9562 válido.`);
  return valor;
}

export function uuidV7AuditoriaABytes(valor, nombre = 'uuid') {
  validarUuidV7Auditoria(valor, nombre);
  return Buffer.from(parsearUuid(valor));
}

export function bytesAUuidV7Auditoria(bytes, nombre = 'uuid') {
  exigir(bytes instanceof Uint8Array && bytes.byteLength === 16, `${nombre} binario debe contener exactamente 16 bytes.`);
  const valor = serializarUuid(bytes);
  validarUuidV7Auditoria(valor, nombre);
  return valor;
}

function exigir(condicion, mensaje) {
  if (!condicion) {
    throw new Error(mensaje);
  }
}
