import {
  parse as parsearUuid,
  stringify as serializarUuid,
  v7 as generarUuidV7,
  validate as validarUuid,
  version as obtenerVersionUuid
} from 'uuid';

const PATRON_UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function generarIdAvisoPlataforma() {
  return generarUuidV7();
}

export function validarIdAvisoPlataforma(valor, nombre = 'avisoId') {
  if (
    typeof valor !== 'string' ||
    !PATRON_UUID_V7.test(valor) ||
    !validarUuid(valor) ||
    obtenerVersionUuid(valor) !== 7
  ) {
    throw new Error(`${nombre} debe ser un UUIDv7 textual canónico.`);
  }
  return valor;
}

export function idAvisoPlataformaABytes(valor, nombre = 'avisoId') {
  validarIdAvisoPlataforma(valor, nombre);
  return Buffer.from(parsearUuid(valor));
}

export function bytesAIdAvisoPlataforma(valor, nombre = 'avisoId') {
  if (!(valor instanceof Uint8Array) || valor.byteLength !== 16) {
    throw new Error(`${nombre} binario debe contener exactamente 16 bytes.`);
  }
  return validarIdAvisoPlataforma(serializarUuid(valor), nombre);
}
