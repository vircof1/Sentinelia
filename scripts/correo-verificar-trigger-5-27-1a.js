import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ErrorNormalizacionBuzonCorreo,
  VERSION_NORMALIZACION_BUZON_CORREO,
  exigirBuzonCanonicoCorreo,
  normalizarBuzonCorreo,
  normalizarNombrePresentacionCorreo
} from '../paquetes/correo/src/NormalizadorBuzonCorreo.js';
import {
  KeyringTecnicoCorreo,
  crearKeyringTecnicoCorreoDesdeEntorno
} from '../paquetes/correo/src/KeyringTecnicoCorreo.js';
import { ValidadorConfiguracionCorreo } from '../paquetes/correo/src/ValidadorConfiguracionCorreo.js';
import { ServicioCorreoPortal } from '../paquetes/correo/src/ServicioCorreoPortal.js';
import { ServicioEmailPerfil } from '../paquetes/usuarios/src/ServicioEmailPerfil.js';
import { ValidadorJerarquiaUsuario } from '../paquetes/usuarios/src/ValidadorJerarquiaUsuario.js';

const CLAVE_A = Buffer.alloc(32, 0x31).toString('base64');
const CLAVE_B = Buffer.alloc(32, 0x32).toString('base64');

function verificarNormalizador() {
  assert.equal(VERSION_NORMALIZACION_BUZON_CORREO, 'buzon@1');
  assert.deepEqual(normalizarBuzonCorreo(' User+tag@BÜCHER.Example '), {
    version: 'buzon@1',
    presentacion: 'User+tag@BÜCHER.Example',
    canonico: 'User+tag@xn--bcher-kva.example'
  });
  assert.equal(normalizarBuzonCorreo('x@faß.de').canonico, 'x@xn--fa-hia.de');
  assert.equal(normalizarBuzonCorreo('Local@EXAMPLE.com').canonico, 'Local@example.com');
  assert.equal(exigirBuzonCanonicoCorreo('Local@example.com'), 'Local@example.com');
  assert.throws(
    () => exigirBuzonCanonicoCorreo('Local@EXAMPLE.com'),
    (error) => error instanceof ErrorNormalizacionBuzonCorreo &&
      error.codigo === 'buzon_correo_no_canonico'
  );

  for (const invalido of [
    null, '', 'sin-arroba.example', 'a@@example.com', 'a b@example.com',
    '.a@example.com', 'a.@example.com', 'a..b@example.com',
    '"a"@example.com', 'á@example.com', 'a@example', 'a@example.com.',
    'a@foo_bar.example', 'a@-foo.example', 'a@foo-.example',
    `a\r\nBcc:x@example.com`, `${'a'.repeat(65)}@example.com`,
    `${'a'.repeat(180)}@example.com`
  ]) {
    assert.throws(() => normalizarBuzonCorreo(invalido), ErrorNormalizacionBuzonCorreo);
  }
  assert.equal(normalizarNombrePresentacionCorreo(' Persona '), 'Persona');
  assert.throws(
    () => normalizarNombrePresentacionCorreo('Persona\r\nBcc: x@example.com'),
    ErrorNormalizacionBuzonCorreo
  );
}

function verificarConfiguracionLegada() {
  const validador = new ValidadorConfiguracionCorreo();
  const valida = validador.evaluar(configuracionValida({
    remitenteEmail: 'Alertas@BÜCHER.Example'
  }));
  assert.equal(valida.configurado, true);
  assert.equal(valida.remitenteEmailCanonico, 'Alertas@xn--bcher-kva.example');

  const invalida = validador.evaluar(configuracionValida({
    remitenteEmail: 'legado no canonicalizable'
  }));
  assert.equal(invalida.configurado, false);
  assert.equal(invalida.puedeDespachar, false);
  assert.equal(invalida.remitenteEmailCanonico, null);

  const cabecera = validador.evaluar(configuracionValida({
    remitenteNombre: 'Sentinelia\r\nBcc: tercero@example.com'
  }));
  assert.equal(cabecera.configurado, false);
}

async function verificarFronterasProductivas() {
  const creados = [];
  const enviados = [];
  const servicio = new ServicioCorreoPortal({
    servicioConfiguracionPortal: {
      obtenerConfiguracionActual: () => ({
        obtenerConfiguracionCorreo: () => configuracionValida({
          remitenteEmail: 'Alertas@BÜCHER.Example'
        })
      })
    },
    validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo(),
    repositorioColaCorreo: {
      crearPendienteLegacy: async (entrada) => (creados.push(entrada), entrada)
    },
    bloqueadorEnvioCorreoRedis: {},
    clienteSmtp: {
      enviar: async (_configuracion, mensaje) =>
        (enviados.push(mensaje), { messageId: '<fixture@example.com>' })
    }
  });

  await servicio.encolarCorreoPrueba({
    destinatarioEmail: ' Persona@BÜCHER.Example ',
    destinatarioNombre: 'Persona',
    asunto: 'Prueba',
    cuerpoTexto: 'Cuerpo',
    creadoPorUsuarioId: 1
  });
  assert.equal(creados[0].destinatarioEmail, 'Persona@xn--bcher-kva.example');
  assert.equal(creados[0].remitenteEmail, 'Alertas@xn--bcher-kva.example');

  await servicio.enviarCorreoVerificacionEmailPerfil({
    destinatarioEmail: 'Persona@BÜCHER.Example',
    destinatarioNombre: 'Persona',
    enlaceVerificacion: 'https://sentinelia.example/verificar',
    ttlMinutos: 20
  });
  assert.equal(enviados[0].destinatarioEmail, 'Persona@xn--bcher-kva.example');
  assert.equal(enviados[0].remitenteEmail, 'Alertas@xn--bcher-kva.example');

  const repositorioUsuarios = {
    buscarPorId: async () => ({ id: 7, activo: true, email: 'anterior@example.com' }),
    actualizarEmailNoValidado: async (entrada) => ({
      estado: 'actualizado',
      entrada
    })
  };
  const resultado = await new ServicioEmailPerfil({ repositorioUsuarios })
    .establecerEmailNoValidado({ idUsuario: 7, email: 'MiCuenta@BÜCHER.Example' });
  assert.equal(resultado.datos.email, 'MiCuenta@xn--bcher-kva.example');

  const validadorUsuarios = new ValidadorJerarquiaUsuario();
  assert.equal(
    validadorUsuarios.normalizarEmail('Persona@BÜCHER.Example'),
    'Persona@xn--bcher-kva.example'
  );
  validadorUsuarios.validarAltaBase({
    usuario: 'persona',
    email: 'Persona@BÜCHER.Example'
  });
}

async function verificarKeyringIndependiente() {
  const keyring = new KeyringTecnicoCorreo({
    keyring: { anterior: CLAVE_A, activa: CLAVE_B },
    keyIdActiva: 'activa'
  });
  assert.equal(keyring.keyIdActiva, 'activa');
  assert.deepEqual(keyring.listarIds(), ['activa', 'anterior']);
  const copia = keyring.obtener('activa');
  copia.fill(0);
  assert.notDeepEqual(copia, keyring.obtener('activa'));
  assert.deepEqual(keyring.toJSON(), {
    keyIdActiva: 'activa',
    keyIds: ['activa', 'anterior']
  });
  assert.doesNotMatch(JSON.stringify(keyring), /MTExMTEx/u);
  assert.equal(
    crearKeyringTecnicoCorreoDesdeEntorno({
      CORREO_KEYRING: JSON.stringify({ activa: CLAVE_B }),
      CORREO_KEY_ID_ACTIVA: 'activa'
    }).obtenerActiva().clave.length,
    32
  );
  assert.throws(() => new KeyringTecnicoCorreo({
    keyring: { anterior: CLAVE_A },
    keyIdActiva: 'activa'
  }));
  assert.throws(() => new KeyringTecnicoCorreo({
    keyring: { activa: 'no-es-base64' },
    keyIdActiva: 'activa'
  }));

  const env = await readFile(new URL('../.env.ejemplo', import.meta.url), 'utf8');
  const correo = env.match(/^CORREO_KEYRING=\{"[^"]+":"([^"]+)"\}$/mu)?.[1];
  const agentes = env.match(/^AGENTES_SESION_KEYRING=\{"[^"]+":"([^"]+)"\}$/mu)?.[1];
  assert.ok(correo);
  assert.ok(agentes);
  assert.equal(correo, 'REEMPLAZAR_POR_BASE64_CANONICO_DE_32_BYTES');
  assert.equal(agentes, 'REEMPLAZAR_POR_BASE64_CANONICO_DE_32_BYTES');
  const independiente = crearKeyringTecnicoCorreoDesdeEntorno({
    CORREO_KEYRING: JSON.stringify({ activa: CLAVE_B }),
    CORREO_KEY_ID_ACTIVA: 'activa',
    AGENTES_SESION_KEYRING: JSON.stringify({ activa: CLAVE_A })
  });
  assert.deepEqual(independiente.obtenerActiva().clave, Buffer.from(CLAVE_B, 'base64'));
  assert.notDeepEqual(independiente.obtenerActiva().clave, Buffer.from(CLAVE_A, 'base64'));

  const [web, runtime] = await Promise.all([
    readFile(new URL('../apps/sentinelia-web/src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-runtime/src/BootstrapRuntime.js', import.meta.url), 'utf8')
  ]);
  for (const fuente of [web, runtime]) {
    assert.match(fuente, /crearKeyringTecnicoCorreoDesdeEntorno\(process\.env\)/u);
  }
}

function configuracionValida(sobrescrituras = {}) {
  return {
    activo: true,
    operativoVerificado: true,
    smtpHost: 'smtp.example.com',
    smtpPuerto: 587,
    smtpSecure: false,
    smtpUsuario: '',
    smtpPassword: '',
    smtpAuthMethod: '',
    smtpTimeoutConexionMs: 10_000,
    smtpTimeoutSaludoMs: 10_000,
    smtpTimeoutSocketMs: 30_000,
    smtpTlsPermitirInseguro: false,
    remitenteEmail: 'alertas@example.com',
    remitenteNombre: 'Sentinelia',
    maxReintentos: 3,
    reintentoBaseSegundos: 60,
    bloqueoTtlSegundos: 90,
    runtimeLoteMaximo: 3,
    ...sobrescrituras
  };
}

async function main() {
  verificarNormalizador();
  verificarConfiguracionLegada();
  await verificarFronterasProductivas();
  await verificarKeyringIndependiente();
  console.log(
    '[correo-trigger] OK 5.27.1a: buzon@1 único, fronteras canonicalizadas y keyring técnico independiente'
  );
}

main().catch((error) => {
  console.error('[correo-trigger] ERROR 5.27.1a:', error);
  process.exitCode = 1;
});
