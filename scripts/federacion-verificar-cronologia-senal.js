import assert from 'node:assert/strict';
import {
  validarPayloadTelemetriaFederacion,
  PERFIL_PAYLOAD_TELEMETRIA_FEDERACION
} from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA }
  from '../paquetes/federacion/src/IdentidadFederada.js';
import { FuenteEntropiaCriptograficaNode }
  from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const fuenteOrigenId = String(generador.generar(
  TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
));
const consolidadaEnUtc = '2026-11-05T21:11:06.000Z';
for (const clave of ['sin_pol', 'reinicio_reciente']) {
  const base = {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION, version: 1,
    tipoRegistro: 'senal', fuenteOrigenId,
    categoria: 'runtime.servidor', clave, tag: '',
    codigoSenal: `runtime.servidor.${clave}`, tipoDato: 'booleano', unidad: '',
    nombreHumano: clave, descripcion: '', metadatosDescriptivos: null,
    consolidadaEnUtc
  };
  for (const ultimaDeclaracionUtc of [
    '2026-11-05T21:11:05.000Z', consolidadaEnUtc,
    '2026-11-05T21:12:00.000Z', null
  ]) {
    const entrada = { ...base, ultimaDeclaracionUtc };
    const resultado = validarPayloadTelemetriaFederacion(entrada);
    assert.deepEqual(resultado, entrada, 'Conservar ambas fechas sin corregirlas');
  }
  for (const campo of ['consolidadaEnUtc', 'ultimaDeclaracionUtc']) {
    for (const fecha of [
      '2026-11-05 21:11:05', '2026-11-05T21:11:05Z',
      '2026-11-05T22:11:05.000+01:00', '2026-02-30T21:11:05.000Z',
      ''
    ]) {
      assert.throws(() => validarPayloadTelemetriaFederacion({
        ...base, ultimaDeclaracionUtc: consolidadaEnUtc, [campo]: fecha
      }), error => error.codigo === 'fecha_telemetria_invalida');
    }
  }
  assert.throws(() => validarPayloadTelemetriaFederacion({
    ...base, ultimaDeclaracionUtc: undefined
  }), error => error.codigo === 'tipo_no_representable');
  assert.throws(() => validarPayloadTelemetriaFederacion({
    ...base, consolidadaEnUtc: null, ultimaDeclaracionUtc: null
  }), error => error.codigo === 'fecha_telemetria_invalida');
}
console.log('FED01_CRONOLOGIA_OK: declaracion anterior, igual, posterior y ausente; fechas UTC estrictas; sin mutacion');
