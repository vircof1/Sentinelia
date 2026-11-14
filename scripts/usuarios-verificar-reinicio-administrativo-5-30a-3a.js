import assert from 'node:assert/strict';

import {
  ASUNTO_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO,
  crearMensajeReinicioPasswordAdministrativo,
  extraerPasswordProvisionalMensajeReinicioAdministrativo
} from '../paquetes/correo/src/CodecMensajeReinicioPasswordAdministrativo.js';
import { ServicioAutenticacion } from '../paquetes/usuarios/src/ServicioAutenticacion.js';
import {
  GeneradorPasswordProvisional
} from '../paquetes/usuarios/src/GeneradorPasswordProvisional.js';

const fecha = '2026-09-08T18:27:31.123Z';

verificarGenerador();
verificarCompatibilidadPolitica();
verificarCodecCerrado();
console.log(
  '[usuarios] OK 5.30a.3a: password=csprng_ascii longitud=politica_bcrypt ' +
  'mensaje=texto_utc_versionado extraccion=exacta fallo=cerrado secretos=acotados'
);

function verificarGenerador() {
  const generador = new GeneradorPasswordProvisional();
  const muestras = new Set();
  for (let indice = 0; indice < 512; indice += 1) {
    const password = generador.generar({ longitudMinima: 8 });
    assert.match(password, /^[A-Za-z0-9_-]{24}$/u);
    muestras.add(password);
  }
  assert.equal(muestras.size, 512);
  assert.equal(generador.generar({ longitudMinima: 40 }).length, 40);
  assert.equal(generador.generar({ longitudMinima: 72 }).length, 72);
  assert.throws(() => generador.generar({ longitudMinima: 0 }), /entre 1 y 72/u);
  assert.throws(() => generador.generar({ longitudMinima: 73 }), /entre 1 y 72/u);
  const determinista = new GeneradorPasswordProvisional({
    randomBytes: (longitud) => Buffer.alloc(longitud, 0)
  });
  assert.equal(determinista.generar({ longitudMinima: 24 }), 'A'.repeat(24));
}

function verificarCompatibilidadPolitica() {
  const autenticacion = new ServicioAutenticacion({
    repositorioUsuarios: {},
    servicioConfiguracionPortal: {
      obtenerConfiguracionActual() {
        return {
          obtenerConfiguracionUsuarios() {
            return { passwordLongitudMinima: 72 };
          }
        };
      }
    }
  });
  const password = new GeneradorPasswordProvisional().generar({
    longitudMinima: autenticacion.obtenerLongitudMinimaPassword()
  });
  assert.doesNotThrow(() =>
    autenticacion.validarPasswordNueva(password, password)
  );
  assert.equal(Buffer.byteLength(password, 'utf8'), 72);
}

function verificarCodecCerrado() {
  const password = 'AbCdEfGhIjKlMnOpQrStUv_1';
  const mensaje = crearMensajeReinicioPasswordAdministrativo({
    nombrePortal: '  Sentinelia\nOperativa  ',
    passwordProvisional: password,
    aplicadoEnUtc: fecha
  });
  assert.equal(mensaje.asunto, ASUNTO_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO);
  assert.match(mensaje.cuerpoTexto, /Portal: Sentinelia Operativa/u);
  assert.match(mensaje.cuerpoTexto, /Aplicada en UTC: 2026-09-08T18:27:31\.123Z/u);
  assert.match(mensaje.cuerpoTexto, /próximo inicio de sesión/u);
  assert.equal(
    extraerPasswordProvisionalMensajeReinicioAdministrativo({
      asunto: mensaje.asunto,
      cuerpoTexto: mensaje.cuerpoTexto
    }),
    password
  );
  assert.equal(Object.values(mensaje).filter((valor) => valor === password).length, 0);
  assert.doesNotMatch(mensaje.cuerpoTexto, /usuario|operador/iu);

  for (const alterado of [
    { asunto: 'Otro asunto', cuerpoTexto: mensaje.cuerpoTexto },
    { asunto: mensaje.asunto, cuerpoTexto: mensaje.cuerpoTexto + '\n' },
    {
      asunto: mensaje.asunto,
      cuerpoTexto: mensaje.cuerpoTexto.replace('@1/mensaje', '@2/mensaje')
    },
    {
      asunto: mensaje.asunto,
      cuerpoTexto: mensaje.cuerpoTexto.replace(password, 'no válido')
    }
  ]) {
    assert.throws(
      () => extraerPasswordProvisionalMensajeReinicioAdministrativo(alterado),
      (error) =>
        error.codigo === 'MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO_INVALIDO' &&
        !error.message.includes(password)
    );
  }
  assert.throws(
    () => crearMensajeReinicioPasswordAdministrativo({
      nombrePortal: 'Sentinelia',
      passwordProvisional: password,
      aplicadoEnUtc: fecha,
      usuario: 'objetivo'
    }),
    /no es válido/u
  );
}
