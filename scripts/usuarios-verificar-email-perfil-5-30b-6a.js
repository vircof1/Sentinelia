import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DespachadorCorreoRuntime }
  from '../apps/sentinelia-runtime/src/correo/DespachadorCorreoRuntime.js';
import { clasificarErrorSmtpTrigger }
  from '../paquetes/correo/src/ClienteSmtp.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

await verificarProyeccionesOperativas();
await verificarMetricasRuntime();
verificarErrorSmtpSaneado();
verificarGuardaArquitectonicaPublicada();

console.log(
  '[usuarios] OK 5.30b.6a: procedencia=backlog+metricas+diagnostico ' +
  'emisiones=clase+estado errores=codigo+mensaje_saneado ' +
  'smtp=solo_runtime historico_web=retirado'
);

async function verificarProyeccionesOperativas() {
  const consultas = [];
  const repositorio = new RepositorioColaCorreo({
    async consultar(sql) {
      consultas.push(sql);
      if (sql.includes('GROUP BY CASE')) {
        return [{
          origen: 'verificacion_email_perfil', total: 2,
          mas_antigua_utc: '2026-09-12 10:00:00.000', proposito: null
        }];
      }
      return [{
        origen: 'verificacion_email_perfil', proposito: null,
        clase_emision_email_perfil: 'inicial', estado: 'error_reintentable',
        causa_descarte: null, codigo_resultado: 'smtp_fallo_temporal',
        respuesta_saneada: '421 servicio temporalmente indisponible', total: 1
      }];
    }
  });
  const backlog = await repositorio.resumirBacklogDetenido();
  assert.equal(backlog.porOrigen[0].origen, 'verificacion_email_perfil');
  const diagnostico = await repositorio.resumirCicloSql();
  assert.deepEqual(diagnostico[0], {
    origen: 'verificacion_email_perfil',
    proposito: null,
    claseEmisionEmailPerfil: 'inicial',
    estado: 'error_reintentable',
    causaDescarte: null,
    codigoResultado: 'smtp_fallo_temporal',
    respuestaSaneada: '421 servicio temporalmente indisponible',
    total: 1
  });
  assert.match(consultas[1], /clase_emision_email_perfil/u);
  assert.match(consultas[1], /codigo_resultado/u);
  assert.match(consultas[1], /respuesta_saneada/u);
}

async function verificarMetricasRuntime() {
  const resultados = [{
    despachado: false,
    origenTipo: 'verificacion_email_perfil',
    salidaId: '91',
    estadoSalida: 'error_reintentable',
    codigo: 'smtp_fallo_temporal',
    respuestaSaneada: '421 buzón temporalmente indisponible'
  }, {
    despachado: true,
    origenTipo: 'verificacion_email_perfil',
    salidaId: '92',
    estadoSalida: 'enviado',
    codigo: 'smtp_aceptado',
    respuestaSaneada: '250 mensaje aceptado'
  }, { despachado: false, motivo: 'sin_salidas_reclamables' }];
  const runtime = new DespachadorCorreoRuntime({
    servicioCorreoPortal: {
      obtenerConfiguracionCorreoActual() {
        return {
          runtimeLoteMaximo: 10,
          smtpTimeoutConexionMs: 1,
          smtpTimeoutSaludoMs: 1,
          smtpTimeoutSocketMs: 1
        };
      }
    },
    servicioConfiguracionPortal: {
      obtenerEstadoDespliegueCorreoActual: () => ({ cola_sql_autoritativa: 1 })
    },
    despachadorCorreoSql: {
      reconciliarLeasesExpiradas: async () => ({ total: 0 }),
      despacharSiguiente: async () => resultados.shift()
    }
  });
  const resumen = await runtime.despacharPendientes({ origen: 'fixture' });
  assert.deepEqual(resumen.porProcedencia, [{
    origenTipo: 'verificacion_email_perfil',
    totalIntentados: 2,
    totalDespachados: 1,
    totalReintentables: 1,
    totalFallosFinales: 0,
    totalAmbiguos: 0,
    totalDescartados: 0
  }]);
  assert.deepEqual(resumen.correosProcesados.map((salida) => ({
    origenTipo: salida.origenTipo,
    codigo: salida.codigo,
    mensaje: salida.mensaje
  })), [{
    origenTipo: 'verificacion_email_perfil',
    codigo: 'smtp_fallo_temporal',
    mensaje: '421 buzón temporalmente indisponible'
  }, {
    origenTipo: 'verificacion_email_perfil',
    codigo: 'smtp_aceptado',
    mensaje: '250 mensaje aceptado'
  }]);
}

function verificarErrorSmtpSaneado() {
  const secreto = 'password-super-secreto-530b6a';
  const clasificado = clasificarErrorSmtpTrigger(Object.assign(
    new Error(`No conecta con ${secreto}`),
    { code: 'ECONNECTION', command: 'CONN' }
  ), { secretos: [secreto] });
  assert.equal(clasificado.codigo, 'smtp_fallo_previo_datos');
  assert.ok(clasificado.respuestaSaneada);
  assert.doesNotMatch(clasificado.respuestaSaneada, new RegExp(secreto, 'u'));
}

function verificarGuardaArquitectonicaPublicada() {
  const coordinador = leer(
    'paquetes/usuarios/src/ServicioEmisionInicialEmailPerfilCoordinada.js'
  );
  assert.doesNotMatch(coordinador,
    /ClienteSmtp|clienteSmtp|enviarCorreoVerificacionEmailPerfil|\.enviar\s*\(/u,
    'El coordinador de producción no puede conocer ni consumir SMTP.');

  const fuentes = listarJavaScript(join(raiz, 'apps'))
    .concat(listarJavaScript(join(raiz, 'paquetes')));
  const consumidoresIntento = fuentes.filter((ruta) =>
    /\.enviarIntentoSql(?:\s*\(|\.bind\s*\()/u.test(readFileSync(ruta, 'utf8')));
  assert.deepEqual(consumidoresIntento.map((ruta) => relative(raiz, ruta)), [
    'paquetes/correo/src/ClienteSmtp.js',
    'paquetes/correo/src/DespachadorCorreoSql.js'
  ], 'Solo el cliente SMTP y el despachador común pueden cruzar la frontera SQL.');

  const cambio = leer('paquetes/usuarios/src/ServicioCambioEmailPerfil.js');
  assert.equal(contar(cambio, /\.enviarCorreoVerificacionEmailPerfil\s*\(/gu), 0,
    'El servicio web no puede conservar el transporte SMTP histórico.');
  for (const ruta of fuentes) {
    const relativa = relative(raiz, ruta);
    if (relativa === 'paquetes/correo/src/ServicioCorreoPortal.js') continue;
    assert.doesNotMatch(readFileSync(ruta, 'utf8'),
      /\.enviarCorreoVerificacionEmailPerfil\s*\(/u,
      `SMTP histórico inesperado en ${relativa}.`);
  }
  const web = leer('apps/sentinelia-web/src/index.js');
  assert.match(web, /ServicioEmisionInicialEmailPerfilCoordinada/u);
  assert.match(web, /coordinadorEmisionEmailPerfil/u);
}

function leer(ruta) {
  return readFileSync(join(raiz, ruta), 'utf8');
}

function listarJavaScript(directorio) {
  return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) return listarJavaScript(ruta);
    return entrada.isFile() && extname(entrada.name) === '.js' ? [ruta] : [];
  });
}

function contar(texto, patron) {
  return [...texto.matchAll(patron)].length;
}
