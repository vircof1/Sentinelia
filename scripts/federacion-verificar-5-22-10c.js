import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ConfiguracionPortal } from
  '../paquetes/configuracion/src/ConfiguracionPortal.js';
import { ServicioConfiguracionPortal } from
  '../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { obtenerDefinicionesConfiguracionPortal } from
  '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { KeyringFederacionDespliegue } from
  '../paquetes/federacion/adaptadores/KeyringFederacionDespliegue.js';
import { ResolutorConfiguracionFederacionPortal } from
  '../paquetes/federacion/aplicacion/ResolutorConfiguracionFederacionPortal.js';
import {
  CONFIGURACIONES_GLOBALES_FEDERACION,
  crearFachadaPuertoFederacion,
  proyectarCapacidadesConfiguracionFederacion
} from '../paquetes/federacion/src/index.js';

const CLAVE_BASE64 = Buffer.alloc(32, 23).toString('base64');

function crearConfiguracionEntorno() {
  return {
    portal: { nombreVisible: 'Sentinelia' },
    federacion: {
      activacionFederacion: false,
      origenPublico: null,
      proxiesConfiables: [],
      toleranciaTemporalMs: 5000,
      loteMaximoOcurrencias: 200,
      loteMaximoBytes: 1048576,
      ocurrenciaMaximaBytes: 262144,
      capacidadReceptoraOcurrencias: 1000,
      ttlEstadoOperativoMs: 300000,
      silencioRelacionMs: 120000,
      consolidacionReinicioMs: 60000,
      retencionMaximaDias: 90,
      keyringReferenciaDespliegue: 'sentinelia/federacion/v1'
    },
    dns: {
      activo: false, listenOn: '127.0.0.1', listenOnV6: '::1',
      allowQuery: 'any', recursion: false, forwardersHabilitados: false,
      forwarders: ''
    },
    monitores: {
      compactacionCercaFalloPorcentaje: 10,
      compactacionSerieVariacionPorcentaje: 10,
      retencionEventosDias: 45,
      runtimeBloqueoTtlSegundos: 30
    },
    agentes: {
      sessionTtlSegundos: 900, heartbeatIntervalSegundos: 30,
      heartbeatGraceSegundos: 90, loginFallosMaximos: 5,
      cuarentenaSegundos: 900
    },
    correo: {
      activo: false, smtpHost: '', smtpPuerto: 587, smtpSecure: false,
      smtpUsuario: '', smtpPassword: '', smtpAuthMethod: '',
      smtpTimeoutConexionMs: 10000, smtpTimeoutSaludoMs: 10000,
      smtpTimeoutSocketMs: 30000, smtpTlsPermitirInseguro: false,
      remitenteEmail: '', remitenteNombre: 'Sentinelia', maxReintentos: 3,
      reintentoBaseSegundos: 60, bloqueoTtlSegundos: 90,
      runtimeLoteMaximo: 3
    },
    pow: {
      activo: true, redisPrefijo: 'sentinelia:pow:', ttlDesafioSegundos: 300,
      tiempoObjetivoMs: 1500, tiempoMinimoMs: 750, tiempoMaximoMs: 8000,
      ventanaIntentosSegundos: 900, incrementoPorIntentoMs: 250,
      incrementoPorFalloMs: 700, costeMinimo: 16, costeMaximo: 24,
      hashratePorDefecto: 60000, hashrateMinimo: 25000,
      hashrateMaximo: 1500000, benchmarkClienteMs: 180
    }
  };
}

function verificarDefinicionesYPersistencia() {
  const definiciones = obtenerDefinicionesConfiguracionPortal(
    crearConfiguracionEntorno()
  );
  const porClave = new Map(definiciones.map((definicion) => [definicion.clave, definicion]));
  const clavesFederacion = Object.values(CONFIGURACIONES_GLOBALES_FEDERACION)
    .map(({ clave }) => clave);
  assert.equal(clavesFederacion.length, 13);
  assert.deepEqual(
    [...porClave.keys()].filter((clave) => clave.startsWith('federacion.')).sort(),
    [...clavesFederacion].sort()
  );
  for (const clave of clavesFederacion) assert.ok(porClave.has(clave));
  assert.equal(porClave.get('federacion.keyring_referencia_despliegue').editable, false);
  assert.equal(porClave.get('federacion.proxies_confiables').tipoEntrada, 'textarea');

  const valores = new Map(definiciones.map(({ clave, valorPorDefecto }) =>
    [clave, valorPorDefecto]));
  const portal = new ConfiguracionPortal({ definiciones, valoresPersistidos: valores, version: 7 });
  assert.equal(portal.obtenerConfiguracionFederacion().activacionFederacion, false);
  valores.set('federacion.activacion', 'true');
  const activaSoloEmision = new ConfiguracionPortal({
    definiciones,
    valoresPersistidos: valores,
    version: 8
  }).obtenerConfiguracionFederacion();
  assert.equal(activaSoloEmision.origenPublico, null);
  assert.deepEqual(activaSoloEmision.proxiesConfiables, []);
  assert.deepEqual(
    proyectarCapacidadesConfiguracionFederacion(activaSoloEmision),
    {
      activacionGlobal: true,
      bloqueos: {
        emision: [],
        recepcion: ['origenPublicoAusente', 'proxiesConfiablesAusentes']
      },
      emisionDisponible: true,
      perfil: 'sentinelia-federacion-capacidades-configuracion-v1',
      recepcionPreparada: false,
      version: 1
    }
  );
  valores.set('federacion.origen_publico', 'https://sentinelia.example');
  valores.set('federacion.proxies_confiables', '127.0.0.1\n10.0.0.0/8');
  const activa = new ConfiguracionPortal({ definiciones, valoresPersistidos: valores, version: 9 })
    .obtenerConfiguracionFederacion();
  assert.equal(activa.origenPublico, 'https://sentinelia.example');
  assert.deepEqual(activa.proxiesConfiables, ['10.0.0.0/8', '127.0.0.1']);

  const invalida = new Map(valores);
  invalida.set('federacion.origen_publico', 'http://inseguro.example');
  assert.throws(() => new ConfiguracionPortal({
    definiciones,
    valoresPersistidos: invalida,
    version: 10
  }).obtenerConfiguracionFederacion(), /HTTPS/);
}

async function verificarKeyringYResolucionViva() {
  const keyring = new KeyringFederacionDespliegue({
    referencia: 'sentinelia/federacion/v1',
    keyring: { activa: CLAVE_BASE64 },
    keyIdActiva: 'activa'
  });
  const fachada = crearFachadaPuertoFederacion('keyring', keyring);
  assert.deepEqual(Object.keys(fachada), [
    'validarDisponibilidad',
    'obtenerClaveActiva',
    'obtenerClavePorId'
  ]);
  assert.equal(fachada.obtenerClaveActiva().clave.length, 32);
  const serializado = JSON.stringify(keyring);
  assert.ok(!serializado.includes(CLAVE_BASE64));
  assert.throws(() => keyring.validarDisponibilidad({ referencia: 'otra' }),
    /no corresponde/);

  const definiciones = obtenerDefinicionesConfiguracionPortal(crearConfiguracionEntorno());
  const valores = new Map(definiciones.map(({ clave, valorPorDefecto }) =>
    [clave, valorPorDefecto]));
  valores.set('federacion.activacion', 'true');
  valores.set('federacion.origen_publico', 'https://sentinelia.example');
  valores.set('federacion.proxies_confiables', '127.0.0.1');
  const portal = new ConfiguracionPortal({ definiciones, valoresPersistidos: valores, version: 11 });
  let actualizaciones = 0;
  const servicio = {
    async asegurarActualizada() { actualizaciones += 1; },
    obtenerConfiguracionActual() { return portal; }
  };
  const resolutor = new ResolutorConfiguracionFederacionPortal({
    servicioConfiguracionPortal: servicio,
    clienteSql: {
      async verificarUsoHorarioUtc() {
        return { sessionTimeZone: '+00:00', diferenciaSegundos: 0 };
      }
    },
    keyring
  });
  const resuelta = await resolutor.cargarActual();
  assert.equal(actualizaciones, 1);
  assert.equal(resuelta.configuracion.activacionFederacion, true);
  assert.equal(resuelta.relojSql.diferenciaSegundos, 0);
  assert.equal(resuelta.keyring.keyIdActiva, 'activa');
  assert.ok(!JSON.stringify(resuelta).includes(CLAVE_BASE64));

  await assert.rejects(new ResolutorConfiguracionFederacionPortal({
    servicioConfiguracionPortal: servicio,
    clienteSql: { async verificarUsoHorarioUtc() { return { diferenciaSegundos: 0 }; } }
  }).cargarActual(), /keyring de despliegue válido/);
}

async function verificarCambioAtomicoDelConjunto() {
  const definiciones = obtenerDefinicionesConfiguracionPortal(
    crearConfiguracionEntorno()
  );
  const repositorio = new RepositorioConfiguracionFalso(definiciones);
  const auditoria = { eventos: [], async registrarEnTransaccion(evento) {
    this.eventos.push(evento);
  } };
  const versionador = {
    version: null,
    async obtenerVersionActual() { return this.version; },
    async publicarVersion(version) { this.version = Number(version); return this.version; }
  };
  const servicio = new ServicioConfiguracionPortal({
    repositorioConfiguracion: repositorio,
    versionadorConfiguracionRedis: versionador,
    definiciones,
    fronteraTransaccional: { async ejecutar(trabajo) { return trabajo({ execute() {} }); } },
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-08-01T12:00:00.000Z')
  });
  await servicio.bootstrapYcargar();
  const contexto = {
    nivelScope: 'portal',
    idUsuarioReal: '1',
    idUsuario: '1',
    permisos: { administrarConfiguracion: true }
  };
  await servicio.actualizarValor({
    clave: 'federacion.origen_publico',
    valor: 'https://sentinelia.example',
    contextoUsuarioActual: contexto
  });
  await servicio.actualizarValor({
    clave: 'federacion.proxies_confiables',
    valor: '127.0.0.1',
    contextoUsuarioActual: contexto
  });
  await servicio.actualizarValor({
    clave: 'federacion.activacion',
    valor: 'true',
    contextoUsuarioActual: contexto
  });
  assert.equal(
    servicio.obtenerConfiguracionActual()
      .obtenerConfiguracionFederacion().activacionFederacion,
    true
  );
  const versionAntes = repositorio.version;
  const eventosAntes = auditoria.eventos.length;
  await assert.rejects(servicio.actualizarValor({
    clave: 'federacion.ocurrencia_maxima_bytes',
    valor: '2097152',
    contextoUsuarioActual: contexto
  }), /lote completo/);
  assert.equal(repositorio.version, versionAntes);
  assert.equal(auditoria.eventos.length, eventosAntes);
  assert.equal(
    Number(repositorio.valores.get('federacion.ocurrencia_maxima_bytes')),
    262144
  );
  await assert.rejects(servicio.actualizarValor({
    clave: 'federacion.keyring_referencia_despliegue',
    valor: 'otra',
    contextoUsuarioActual: contexto
  }), /no es editable/);
}

async function verificarRegistro() {
  const [servicio, validadorAuditoria, entornoEjemplo] = await Promise.all([
    readFile(new URL('../paquetes/configuracion/src/ServicioConfiguracionPortal.js', import.meta.url), 'utf8'),
    readFile(new URL('../paquetes/auditoria/src/ValidadorContratoAuditoria.js', import.meta.url), 'utf8'),
    readFile(new URL('../.env.ejemplo', import.meta.url), 'utf8')
  ]);
  assert.match(servicio, /cargarValoresFederacionBloqueados/);
  for (const { clave } of Object.values(CONFIGURACIONES_GLOBALES_FEDERACION)) {
    assert.ok(
      validadorAuditoria.includes(`'${clave}'`),
      `La configuración ${clave} debe pertenecer a la allowlist auditable.`
    );
  }
  for (const variable of [
    'FEDERACION_ACTIVA',
    'PORTAL_ORIGEN_PUBLICO',
    'PORTAL_PROXIES_REVERSOS_CONFIABLES',
    'FEDERACION_KEYRING_REFERENCIA'
  ]) assert.ok(entornoEjemplo.includes(variable));
}

class RepositorioConfiguracionFalso {
  constructor(definiciones) {
    this.valores = new Map(definiciones.map(({ clave, valorPorDefecto }) =>
      [clave, valorPorDefecto]));
    this.version = 1;
  }
  async cargarValores() { return new Map(this.valores); }
  async cargarEstadoDespliegueCorreo() {
    return {
      origen_portal_autoritativo: 0,
      verificacion_smtp_autoritativa: 0,
      guard_verificacion_legacy_activo: 0
    };
  }
  async cargarValoresEnTransaccion() { return new Map(this.valores); }
  async bloquearAutoridadCorreoEnTransaccion() {
    return {
      valores: new Map(this.valores),
      estadoVerificacion: { verificado: 0 },
      estadoDespliegue: await this.cargarEstadoDespliegueCorreo(),
      versionConfiguracion: String(this.version)
    };
  }
  async cargarMetadatosCorreoEnTransaccion() { return []; }
  async invalidarEstadoVerificacionCorreoEnTransaccion() {}
  async promoverEstadoVerificacionCorreoEnTransaccion() {}
  async bloquearValorEnTransaccion(clave) {
    return this.valores.has(clave)
      ? { clave, valor: this.valores.get(clave), tipo_dato: 'texto' }
      : null;
  }
  async actualizarValorEnTransaccion(clave, valor) { this.valores.set(clave, valor); }
  async sincronizarDefinicionesEnTransaccion() { return Object.freeze([]); }
  async obtenerVersionEnTransaccion() { return String(this.version); }
  async incrementarVersionEnTransaccion() {
    this.version += 1;
    return String(this.version);
  }
}

verificarDefinicionesYPersistencia();
await verificarKeyringYResolucionViva();
await verificarCambioAtomicoDelConjunto();
await verificarRegistro();

console.log('[federacion] OK 5.22.10c: configuracion=13 sql=autoridad redis=version keyring=externo reloj=utc');
