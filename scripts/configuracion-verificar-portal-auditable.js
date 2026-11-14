import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ServicioConfiguracionPortal } from '../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import {
  convertirValorConfiguracion,
  normalizarValorConfiguracionPersistible
} from '../paquetes/configuracion/src/tiposDatoConfiguracion.js';
import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { prepararIntencionAuditoriaV1 } from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';

const CONTEXTO = Object.freeze({
  idUsuario: 7,
  idUsuarioReal: 5,
  nivelScope: 'portal',
  permisos: Object.freeze({
    administrarConfiguracion: true,
    verAuditoria: true
  })
});

async function main() {
  await verificarBootstrapYSincronizacion();
  await verificarActualizacionRestablecimientoYNoOp();
  verificarNormalizacionOrigenPublico();
  await verificarMinimizacionSmtpYRespuesta();
  await verificarRetencionGlobal();
  await verificarCorreoOperativoYRollback();
  await verificarContratoConfiguracionActual();
  console.log(
    '[gate:configuracion] OK: cambios=atomicos sync=auditable no_ops=0 ' +
    'smtp=minimizado bind=despliegue retencion=NULL_o_1..36500 ' +
    'version=SQL_durable_y_Redis_post_commit'
  );
}

async function verificarBootstrapYSincronizacion() {
  const fixture = crearFixture();
  const resultado = await fixture.servicio.bootstrapYcargar();
  assert.equal(resultado.clavesCreadas.length, DEFINICIONES.length);
  assert.equal(fixture.eventos.length, 1);
  const evento = fixture.eventos[0];
  assert.equal(evento.tipo, 'configuracion.portal_sincronizada');
  assert.equal(evento.actorReal.tipo, 'sistema');
  assert.equal(evento.actorReal.id, 'sentinelia-system');
  assert.equal(evento.origen, 'bootstrap');
  assert.equal(evento.productor, 'bootstrap');
  assert.equal(prepararIntencionAuditoriaV1(evento).huella.length, 32);
  assert.equal(evento.payload.despues['correo.smtp_claveConfigurada'], false);
  assert.equal(JSON.stringify(evento).includes('smtp_password'), false);
  assert.ok(fixture.traza.indexOf('commit') < fixture.traza.indexOf('redis_publicar'));

  fixture.estado.delete('pow.redis_prefijo');
  const manual = await fixture.servicio.sincronizarDefiniciones(CONTEXTO);
  assert.deepEqual(manual.clavesCreadas, ['pow.redis_prefijo']);
  assert.equal(fixture.eventos.at(-1).actorReal.id, '5');
  assert.deepEqual(fixture.eventos.at(-1).payload.camposCambiados, [
    'pow.redis_prefijo'
  ]);
}

async function verificarActualizacionRestablecimientoYNoOp() {
  const fixture = crearFixture();
  await fixture.servicio.bootstrapYcargar();
  const eventosIniciales = fixture.eventos.length;
  const cambio = await fixture.servicio.actualizarValor({
    clave: 'portal.nombre_visible',
    valor: 'Cabina operativa',
    contextoUsuarioActual: CONTEXTO
  });
  assert.equal(cambio.cambioEfectivo, true);
  assert.equal(fixture.eventos.at(-1).tipo, 'configuracion.portal_actualizada');
  assert.deepEqual(fixture.eventos.at(-1).payload, {
    resultado: 'actualizado',
    camposCambiados: ['portal.nombre_visible'],
    antes: { 'portal.nombre_visible': 'Sentinelia' },
    despues: { 'portal.nombre_visible': 'Cabina operativa' }
  });
  const versionAntesNoOp = fixture.versionador.version;
  fixture.versionador.version = 1;
  await fixture.servicio.actualizarValor({
    clave: 'portal.nombre_visible',
    valor: 'Cabina operativa',
    contextoUsuarioActual: CONTEXTO
  });
  assert.equal(fixture.eventos.length, eventosIniciales + 1);
  assert.equal(fixture.versionador.version, versionAntesNoOp);
  fixture.versionador.version = null;
  await fixture.servicio.listarConfiguraciones();
  assert.equal(fixture.versionador.version, versionAntesNoOp);
  await fixture.versionador.publicarVersion(versionAntesNoOp - 1);
  assert.equal(fixture.versionador.version, versionAntesNoOp);
  await fixture.servicio.restablecerValorPorDefecto(
    'portal.nombre_visible', CONTEXTO
  );
  assert.equal(fixture.eventos.at(-1).tipo, 'configuracion.portal_restablecida');
  assert.equal(fixture.estado.get('portal.nombre_visible'), 'Sentinelia');

}

function verificarNormalizacionOrigenPublico() {
  const definicion = {
    clave: 'portal.origen_publico',
    tipoDato: 'url',
    requerido: false
  };
  for (const valor of [
    'https://sentinelia.example',
    'https://sentinelia.example/'
  ]) {
    assert.equal(
      normalizarValorConfiguracionPersistible(valor, definicion),
      'https://sentinelia.example'
    );
    assert.equal(
      convertirValorConfiguracion(valor, definicion),
      'https://sentinelia.example'
    );
  }
  for (const valor of [
    'http://sentinelia.example',
    'https://sentinelia.example/ruta',
    'https://usuario@sentinelia.example',
    'https://sentinelia.example?dato=1'
  ]) {
    assert.throws(
      () => normalizarValorConfiguracionPersistible(valor, definicion),
      /origen HTTPS válido sin ruta/u
    );
  }
}

async function verificarMinimizacionSmtpYRespuesta() {
  const fixture = crearFixture();
  await fixture.servicio.bootstrapYcargar();
  fixture.estado.set('correo.operativo_verificado', 'true');
  fixture.estado.set('correo.smtp_password', 'secreto-anterior');
  const resultado = await fixture.servicio.actualizarValor({
    clave: 'correo.smtp_password',
    valor: 'secreto-nuevo',
    contextoUsuarioActual: CONTEXTO
  });
  assert.equal(resultado.valor, null);
  const evento = fixture.eventos.at(-1);
  assert.deepEqual(evento.payload.camposCambiados, [
    'correo.operativo_verificado',
    'correo.smtp_claveConfigurada'
  ]);
  assert.deepEqual(evento.payload.antes, {
    'correo.operativo_verificado': true,
    'correo.smtp_claveConfigurada': true
  });
  assert.deepEqual(evento.payload.despues, {
    'correo.operativo_verificado': false,
    'correo.smtp_claveConfigurada': true
  });
  assert.equal(JSON.stringify(evento).includes('secreto-'), false);
  const entrada = (await fixture.servicio.listarConfiguraciones())
    .find(({ clave }) => clave === 'correo.smtp_password');
  assert.equal(entrada.valorBruto, '');
  assert.equal(entrada.valorInterpretado, null);
  assert.equal(entrada.valorPorDefecto, null);
  assert.equal(entrada.valorPorDefectoBruto, '');
  assert.equal(entrada.tieneValor, true);
}

async function verificarRetencionGlobal() {
  const fixture = crearFixture();
  await fixture.servicio.bootstrapYcargar();
  await assert.rejects(() => fixture.servicio.actualizarValor({
    clave: 'auditoria.retencion_dias',
    valor: '30',
    contextoUsuarioActual: CONTEXTO
  }), /string numérico/);
  for (const valor of [0, -1, 36501, 1.5]) {
    await assert.rejects(() => fixture.servicio.actualizarValor({
      clave: 'auditoria.retencion_dias', valor,
      contextoUsuarioActual: CONTEXTO
    }), /no es válido/);
  }
  await assert.rejects(() => fixture.servicio.actualizarValor({
    clave: 'auditoria.retencion_dias', valor: 30,
    contextoUsuarioActual: {
      ...CONTEXTO,
      permisos: { administrarConfiguracion: true, verAuditoria: false }
    }
  }), /verAuditoria/);
  await fixture.servicio.actualizarValor({
    clave: 'auditoria.retencion_dias', valor: 30,
    contextoUsuarioActual: CONTEXTO
  });
  assert.equal(fixture.estado.get('auditoria.retencion_dias'), 30);
  assert.equal(
    fixture.servicio.obtenerConfiguracionActual()
      .obtenerConfiguracionAuditoria().retencionDias,
    30
  );
  await fixture.servicio.actualizarValor({
    clave: 'auditoria.retencion_dias', valor: null,
    contextoUsuarioActual: CONTEXTO
  });
  assert.equal(fixture.estado.get('auditoria.retencion_dias'), null);
}

async function verificarCorreoOperativoYRollback() {
  const fixture = crearFixture();
  await fixture.servicio.bootstrapYcargar();
  await fixture.servicio.marcarCorreoOperativoVerificado(CONTEXTO);
  assert.equal(
    fixture.eventos.at(-1).tipo,
    'configuracion.correo_operativo_verificado'
  );
  assert.equal(fixture.eventos.at(-1).rolEvento, 'resultado');

  fixture.fallarAuditoria = true;
  const anterior = fixture.estado.get('portal.nombre_visible');
  await assert.rejects(() => fixture.servicio.actualizarValor({
    clave: 'portal.nombre_visible', valor: 'No persiste',
    contextoUsuarioActual: CONTEXTO
  }), /auditoría indisponible/);
  assert.equal(fixture.estado.get('portal.nombre_visible'), anterior);
  assert.equal(fixture.traza.at(-1), 'rollback');
}

async function verificarContratoConfiguracionActual() {
  const definiciones = await readFile(new URL(
    '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js',
    import.meta.url
  ), 'utf8');
  const dominio = await readFile(new URL(
    '../paquetes/configuracion/src/ConfiguracionPortal.js', import.meta.url
  ), 'utf8');
  const esquemaInicial = await readFile(new URL(
    '../migraciones/sql/0001_esquema_inicial.sql',
    import.meta.url
  ), 'utf8');
  const respuestasDns = await readFile(new URL(
    '../paquetes/dns/src/ServicioDns.js', import.meta.url
  ), 'utf8');
  for (const clave of [
    'dns.ruta_include_gestionado', 'dns.directorio_zonas',
    'dns.comando_recarga', 'dns.comando_checkconf', 'dns.comando_checkzone'
  ]) {
    assert.equal(definiciones.includes(`clave: '${clave}'`), false);
    assert.equal(dominio.includes(`obtenerValor('${clave}')`), false);
    assert.equal(esquemaInicial.includes(`'${clave}'`), false);
  }
  assert.match(esquemaInicial, /'auditoria\.retencion_dias'/u);
  assert.doesNotMatch(
    respuestasDns,
    /serializarResumenConfiguracionDns[\s\S]{0,500}(rutaIncludeGestionado|directorioZonas)/
  );
  const fixture = crearFixture();
  assert.throws(() => new ServicioConfiguracionPortal({
    repositorioConfiguracion: fixture.servicio.repositorioConfiguracion,
    versionadorConfiguracionRedis: fixture.versionador,
    definiciones: [{
      clave: 'dns.comando_recarga', tipoDato: 'texto',
      valorPorDefecto: 'rndc reload', descripcion: 'Legacy'
    }],
    fronteraTransaccional: fixture.servicio.fronteraTransaccional,
    servicioAuditoria: fixture.servicio.servicioAuditoria
  }), /despliegue BIND/);
}

function crearFixture() {
  const estado = new Map();
  const eventos = [];
  const traza = [];
  const fixture = {
    estado,
    eventos,
    traza,
    fallarAuditoria: false,
    versionSql: 100
  };
  const repositorio = {
    async bloquearValorEnTransaccion(clave, { conexion }) {
      return conexion.estado.has(clave)
        ? { clave, valor: conexion.estado.get(clave) }
        : null;
    },
    async actualizarValorEnTransaccion(clave, valor, { conexion }) {
      if (!conexion.estado.has(clave)) throw new Error(`No existe ${clave}.`);
      conexion.estado.set(clave, valor);
      traza.push(`sql:${clave}`);
    },
    async sincronizarDefinicionesEnTransaccion(definiciones, { conexion }) {
      const creadas = [];
      for (const definicion of definiciones) {
        if (conexion.estado.has(definicion.clave)) continue;
        conexion.estado.set(definicion.clave, definicion.valorPorDefecto);
        creadas.push({
          clave: definicion.clave,
          valor: definicion.valorPorDefecto
        });
      }
      traza.push('sql:sincronizar');
      return creadas;
    },
    async obtenerVersionEnTransaccion({ conexion }) {
      return String(conexion.versionSql);
    },
    async incrementarVersionEnTransaccion({ conexion }) {
      conexion.versionSql += 1;
      traza.push('sql:version');
      return String(conexion.versionSql);
    },
    async cargarValores() {
      return new Map(estado);
    },
    async actualizarValor(clave, valor) {
      if (!estado.has(clave)) return false;
      estado.set(clave, valor);
      return true;
    }
  };
  const versionador = {
    version: null,
    async obtenerVersionActual() { return this.version; },
    async publicarVersion(version) {
      this.version = Math.max(this.version ?? 0, Number(version));
      traza.push('redis_publicar');
      return this.version;
    }
  };
  const frontera = {
    async ejecutar(trabajo) {
      traza.push('begin');
      const conexion = {
        estado: new Map(estado),
        eventos: [],
        versionSql: fixture.versionSql
      };
      try {
        const resultado = await trabajo(conexion);
        estado.clear();
        for (const [clave, valor] of conexion.estado) estado.set(clave, valor);
        eventos.push(...conexion.eventos);
        fixture.versionSql = conexion.versionSql;
        traza.push('commit');
        return resultado;
      } catch (error) {
        traza.push('rollback');
        throw error;
      }
    }
  };
  const auditoria = {
    async registrarEnTransaccion({ intencion }, { conexion }) {
      traza.push('auditar');
      if (fixture.fallarAuditoria) throw new Error('auditoría indisponible');
      validarEventoAuditableV1({
        tipo: intencion.tipo,
        actor: intencion.actorReal.tipo,
        origen: intencion.origen,
        sujeto: intencion.sujeto,
        flujo: intencion.flujo,
        productor: intencion.productor,
        rolEvento: intencion.rolEvento,
        payload: intencion.payload
      });
      conexion.eventos.push(intencion);
    }
  };
  fixture.versionador = versionador;
  fixture.servicio = new ServicioConfiguracionPortal({
    repositorioConfiguracion: repositorio,
    versionadorConfiguracionRedis: versionador,
    definiciones: DEFINICIONES,
    fronteraTransaccional: frontera,
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-07-25T12:00:00.000Z')
  });
  return fixture;
}

const DEFINICIONES = Object.freeze([
  {
    clave: 'portal.nombre_visible', tipoDato: 'texto',
    valorPorDefecto: 'Sentinelia', descripcion: 'Nombre', requerido: true
  },
  {
    clave: 'correo.operativo_verificado', tipoDato: 'booleano',
    valorPorDefecto: 'false', descripcion: 'Correo', requerido: true,
    visibleEnListado: false
  },
  {
    clave: 'correo.smtp_usuario', tipoDato: 'texto',
    valorPorDefecto: '', descripcion: 'Usuario SMTP'
  },
  {
    clave: 'correo.smtp_password', tipoDato: 'password',
    valorPorDefecto: '', descripcion: 'Clave SMTP'
  },
  {
    clave: 'pow.redis_prefijo', tipoDato: 'texto',
    valorPorDefecto: 'sentinelia:pow:', descripcion: 'Prefijo', requerido: true
  },
  {
    clave: 'auditoria.retencion_dias', tipoDato: 'entero_nulable',
    valorPorDefecto: null, minimo: 1, maximo: 36500,
    descripcion: 'Retención'
  }
]);

main().catch((error) => {
  console.error('[configuracion] Falló la verificación auditable del portal.');
  console.error(error);
  process.exitCode = 1;
});
