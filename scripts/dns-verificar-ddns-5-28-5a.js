import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoordinadorDnsRuntime }
  from '../apps/sentinelia-runtime/src/dns/CoordinadorDnsRuntime.js';
import { crearPublicadorProductivoBindDns }
  from '../apps/sentinelia-runtime/src/dns/crearPublicadorProductivoBindDns.js';
import { RepositorioOutboxAuditoriaRuntime }
  from '../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import { RegistradorOutboxPublicacionDns }
  from '../paquetes/dns/src/RegistradorOutboxPublicacionDns.js';
import { RepositorioCoordinacionGeneracionesDns }
  from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion();
const nombreBase = `sentinelia_ddns_5_28_5a_${Date.now()}_${process.pid}`;

async function main() {
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.5a requiere SQL real.');
  for (const ejecutable of ['/usr/bin/named-checkconf', '/usr/bin/named-checkzone']) {
    await fs.access(ejecutable);
  }
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinelia-ddns-5a-'));
  let clienteSql;
  let errorPrincipal;
  try {
    clienteSql = await prepararBaseTemporal();
    await verificarDosRuntimes({ clienteSql, raiz });
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try { await clienteSql?.cerrar(); } catch (error) { errorPrincipal ||= error; }
    try { await eliminarBaseTemporal(); } catch (error) { errorPrincipal ||= error; }
    try { await fs.rm(raiz, { recursive: true, force: true }); } catch (error) { errorPrincipal ||= error; }
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log('[dns] OK 5.28.5a: sql=autoridad runtimes=2 lease=fencing bind=real tipos=A+AAAA+CNAME+MX+NullMX activacion=unica recarga=confirmada consolidacion=posterior legacy=bloqueado');
}

async function verificarDosRuntimes({ clienteSql, raiz }) {
  await crearCatalogoMultiformato(clienteSql);
  const rutas = {
    artefactos: path.join(raiz, 'artefactos'),
    selector: path.join(raiz, 'selector.conf'),
    lock: path.join(raiz, 'publicacion.lock'),
    root: path.join(raiz, 'named-root.conf')
  };
  await fs.mkdir(rutas.artefactos);
  await fs.writeFile(
    rutas.selector,
    '# sentinelia-bind-selector-v1\n' +
      '# generacion=999\n' +
      `# hashProyeccion=${'0'.repeat(64)}\n` +
      `include "${path.join(rutas.artefactos, 'generacion-999', 'sentinelia-named.conf')}";\n`
  );
  await fs.writeFile(rutas.lock, '');
  await fs.writeFile(rutas.root, `include "${rutas.selector}";\n`);

  const outbox = new RepositorioOutboxAuditoriaRuntime(clienteSql);
  const repositorio = new RepositorioCoordinacionGeneracionesDns({
    clienteSql,
    registradorObligaciones: new RegistradorOutboxPublicacionDns({
      repositorioOutbox: outbox
    }),
    bloquearCatalogoEnTransaccion
  });
  const pendienteAnterior = await repositorio.crearGeneracionPorMutacionAtomica();
  assert.equal(pendienteAnterior.estado, 'pendiente');
  const entorno = {
    DNS_ACTIVO: 'false',
    BIND_PUBLICADOR_COORDINADO_ACTIVO: 'true',
    BIND_RAIZ_ARTEFACTOS: rutas.artefactos,
    BIND_SELECTOR_ACTIVO: rutas.selector,
    BIND_LOCK_FILE: rutas.lock,
    BIND_NAMED_CONF_ACTIVO: rutas.root,
    BIND_NAMED_EXECUTABLE: '/usr/sbin/named',
    BIND_NAMED_ARGUMENTOS_JSON: '[]',
    BIND_RNDC_EXECUTABLE: '/usr/bin/true',
    BIND_RNDC_ARGUMENTOS_JSON: '[]',
    BIND_CHECKCONF_EXECUTABLE: '/usr/bin/named-checkconf',
    BIND_CHECKZONE_EXECUTABLE: '/usr/bin/named-checkzone'
  };
  const composicionA = crearPublicadorProductivoBindDns({
    clienteSql,
    repositorioCoordinacion: repositorio,
    instanciaId: 'runtime-ddns-5a-a',
    entorno
  });
  const composicionB = crearPublicadorProductivoBindDns({
    clienteSql,
    repositorioCoordinacion: repositorio,
    instanciaId: 'runtime-ddns-5a-b',
    entorno
  });
  await composicionA.configuracion.validarSistema();
  const servicioLegado = {
    llamadas: 0,
    async publicarConfiguracionVigente() { this.llamadas += 1; },
    async exportarDefinicionesRuntime() {
      return { resumen: { totalZonas: 0, totalRegistros: 0 }, zonas: [] };
    }
  };
  const crearRuntime = (composicion) => new CoordinadorDnsRuntime({
    servicioDns: servicioLegado,
    cargadorCatalogoDnsRuntime: {
      async cargarInicial() {
        return { serializarResumen: () => ({ totalZonas: 0, totalRegistros: 0 }) };
      }
    },
    publicadorCoordinado: composicion.publicador,
    repositorioCoordinacion: repositorio
  });
  const [resultadoA, resultadoB] = await Promise.all([
    crearRuntime(composicionA).arrancar(),
    crearRuntime(composicionB).arrancar()
  ]);

  assert.equal(servicioLegado.llamadas, 0);
  assert.equal(
    [resultadoA, resultadoB].filter((resultado) =>
      resultado.ultimoResultado?.operacion?.estado === 'consolidada'
    ).length,
    1,
    JSON.stringify([resultadoA, resultadoB])
  );
  const [operaciones] = await clienteSql.ejecutar(
    `SELECT estado, efecto_posible, recarga_confirmada_en_utc,
            CAST(resumen_recarga_zonas AS CHAR) AS resumen_recarga_zonas,
            CAST(resumen_recarga_artefactos AS CHAR) AS resumen_recarga_artefactos,
            CAST(resumen_recarga_cambios AS CHAR) AS resumen_recarga_cambios,
            manifiesto_diagnostico,
            CAST(fencing_token AS CHAR) AS fencing_token,
            CAST(obligacion_outbox_id AS CHAR) AS obligacion_outbox_id,
            terminada_en_utc
       FROM operaciones_publicacion_dns`
  );
  assert.equal(operaciones.length, 2);
  const anterior = operaciones.find(({ estado }) => estado === 'superada');
  const consolidada = operaciones.find(({ estado }) => estado === 'consolidada');
  assert.ok(anterior?.terminada_en_utc);
  assert.equal(Boolean(anterior.efecto_posible), false);
  assert.equal(Boolean(consolidada.efecto_posible), true);
  assert.ok(consolidada.recarga_confirmada_en_utc);
  assert.deepEqual(
    [
      consolidada.resumen_recarga_zonas,
      consolidada.resumen_recarga_artefactos,
      consolidada.resumen_recarga_cambios
    ],
    ['1', '3', '1']
  );
  assert.equal(
    (typeof consolidada.manifiesto_diagnostico === 'string'
      ? JSON.parse(consolidada.manifiesto_diagnostico)
      : consolidada.manifiesto_diagnostico).perfil,
    'sentinelia-bind-diagnostico-v1'
  );
  assert.ok(BigInt(consolidada.fencing_token) > 0n);
  assert.ok(BigInt(consolidada.obligacion_outbox_id) > 0n);
  const [reconciliacion] = await clienteSql.ejecutar(
    'SELECT estado FROM reconciliacion_inicial_dns WHERE id = 1'
  );
  assert.equal(reconciliacion[0].estado, 'satisfecha');
  const selector = await fs.readFile(rutas.selector, 'utf8');
  assert.match(selector, /sentinelia-bind-selector-v1/);
  assert.match(selector, /generacion=2/);
  const contenidoPublicado = await leerArbol(rutas.artefactos);
  for (const patron of [
    /\sIN\s+A\s+192\.0\.2\.81/u,
    /\sIN\s+AAAA\s+2001:db8::81/u,
    /\sIN\s+CNAME\s+destino\.example\./u,
    /\sIN\s+MX\s+10\s+mail\.example\./u,
    /\sIN\s+MX\s+0\s+\./u
  ]) assert.match(contenidoPublicado, patron);
}

async function crearCatalogoMultiformato(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.5a','tenant-5285a')"
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,'integral-5285a.example.','ns.example.','hostmaster.example.')`,
    [tenant.insertId]
  );
  for (const [host, tipo, valor, prioridad] of [
    ['@', 'NS', 'ns.example.', null],
    ['a', 'A', '192.0.2.81', null],
    ['aaaa', 'AAAA', '2001:db8::81', null],
    ['alias', 'CNAME', 'destino.example.', null],
    ['correo', 'MX', 'mail.example.', 10],
    ['sin-correo', 'MX', '.', 0]
  ]) {
    await sql.ejecutar(
      `INSERT INTO registros_dns
         (zona_id,tenant_id,host_relativo,tipo_registro,valor_principal,
          prioridad,ttl_segundos,categoria_origen)
       VALUES (?,?,?,?,?,?,300,'ddns')`,
      [zona.insertId, tenant.insertId, host, tipo, valor, prioridad]
    );
  }
}

async function leerArbol(raiz) {
  const entradas = await fs.readdir(raiz, { withFileTypes: true });
  const contenidos = [];
  for (const entrada of entradas) {
    const ruta = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) contenidos.push(await leerArbol(ruta));
    else contenidos.push(await fs.readFile(ruta, 'utf8'));
  }
  return contenidos.join('\n');
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id, id FOR UPDATE');
}

async function prepararBaseTemporal() {
  validarNombreBase(nombreBase);
  const clienteSql = new ClienteSql({ ...configuracion.sql, baseDatos: nombreBase });
  await clienteSql.crearBaseDatosSiNoExiste();
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  return clienteSql;
}

async function eliminarBaseTemporal() {
  validarNombreBase(nombreBase);
  const administracion = new ClienteSql({ ...configuracion.sql, baseDatos: '' });
  try {
    await administracion.ejecutar(`DROP DATABASE IF EXISTS \`${nombreBase}\``);
  } finally {
    await administracion.cerrar();
  }
}

function validarNombreBase(nombre) {
  if (!/^sentinelia_ddns_5_28_5a_[a-zA-Z0-9_]+$/.test(nombre)) {
    throw new Error('Nombre temporal SQL no seguro.');
  }
}

await main();
