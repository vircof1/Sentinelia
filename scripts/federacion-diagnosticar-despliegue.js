import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';

import { ConfiguracionPortal } from
  '../paquetes/configuracion/src/ConfiguracionPortal.js';
import { RepositorioConfiguracion } from
  '../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { obtenerDefinicionesConfiguracionPortal } from
  '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { AuditorKeyringFederacionSql } from
  '../paquetes/federacion/adaptadores/AuditorKeyringFederacionSql.js';
import { KeyringFederacionDespliegue } from
  '../paquetes/federacion/adaptadores/KeyringFederacionDespliegue.js';
import { RepositorioIdentidadFederacionSql } from
  '../paquetes/federacion/adaptadores/RepositorioIdentidadFederacionSql.js';
import { ResolutorConfiguracionFederacionPortal } from
  '../paquetes/federacion/aplicacion/ResolutorConfiguracionFederacionPortal.js';
import { ResolutorRedPublicaFederacion } from
  '../paquetes/federacion/aplicacion/ResolutorRedPublicaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from
  '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from
  '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

export async function diagnosticarDespliegueFederacion({
  entorno = process.env,
  escribir = console.log
} = {}) {
  const configuracion = obtenerConfiguracionAplicacion();
  if (!configuracion.sql.estaCompleta) {
    throw fallo('SQL_CONFIGURACION_INCOMPLETA');
  }

  const clienteSql = new ClienteSql(configuracion.sql);
  const clienteRedis = createClient({ url: configuracion.redis.url });
  // El diagnóstico solo publica códigos de etapa; el cliente no debe volcar una
  // URL de conexión o credenciales incluidas en el error de transporte.
  clienteRedis.on('error', () => {});
  try {
    const relojSql = await paso('SQL_NO_OPERATIVO', () =>
      clienteSql.verificarUsoHorarioUtc());
    const migraciones = await paso('MIGRACIONES_NO_INTEGRAS', async () => {
      const ejecutor = new EjecutorMigraciones({
        clienteSql,
        repositorioMigraciones: new RepositorioMigraciones(clienteSql),
        rutaMigraciones: obtenerRutaMigraciones()
      });
      const [disponibles, filasAplicadas] = await Promise.all([
        ejecutor.cargarMigracionesDisponibles(),
        clienteSql.consultar(
          `SELECT nombre_archivo,checksum_sha1,fecha_aplicacion
             FROM control_migraciones
            ORDER BY nombre_archivo`
        )
      ]);
      const aplicadas = new Map(filasAplicadas.map((fila) => [
        fila.nombre_archivo,
        {
          nombreArchivo: fila.nombre_archivo,
          checksum: fila.checksum_sha1,
          fechaAplicacion: fila.fecha_aplicacion || null
        }
      ]));
      const resultado = ejecutor.auditarIntegridadMigraciones({
        migracionesDisponibles: disponibles,
        migracionesAplicadas: aplicadas
      });
      if (!resultado.ok) throw new Error('La integridad no es válida.');
      await ejecutor.verificarPostcondicionesAplicadas({
        migraciones: disponibles,
        aplicadas
      });
      if (resultado.totalAplicadas !== resultado.totalDisponibles) {
        throw new Error('Existen migraciones pendientes.');
      }
      return resultado;
    });
    const redis = await paso('REDIS_NO_OPERATIVO', async () => {
      await clienteRedis.connect();
      const salud = await clienteRedis.ping();
      if (salud !== 'PONG') throw new Error('Redis no respondió PONG.');
      return clienteRedis;
    });
    const portal = await paso('CONFIGURACION_PORTAL_INVALIDA', () =>
      cargarConfiguracionPortal({ clienteSql, configuracion }));
    const servicioConfiguracionPortal = crearServicioConfiguracion(portal);
    const keyring = await paso('KEYRING_DESPLIEGUE_INVALIDO', () =>
      crearKeyringOpcional(entorno));
    const fotografia = await paso('FEDERACION_DESPLIEGUE_INVALIDO', () =>
      new ResolutorConfiguracionFederacionPortal({
        servicioConfiguracionPortal,
        clienteSql,
        keyring,
        auditorKeyring: new AuditorKeyringFederacionSql(clienteSql)
      }).cargarActual());
    const redPublica = await paso('PROXY_CONFIABLE_INVALIDO', async () => {
      const resolutor = new ResolutorRedPublicaFederacion({
        servicioConfiguracionPortal
      });
      return resolutor.inicializar();
    });
    const identidad = await paso('IDENTIDAD_INSTALACION_NO_INICIALIZADA', async () => {
      const valor = await new RepositorioIdentidadFederacionSql(clienteSql)
        .obtenerIdentidadInstalacion();
      if (!valor) throw new Error('Falta installationId durable.');
      return valor;
    });

    const resumen = Object.freeze({
      sqlUtc: relojSql.diferenciaSegundos === 0,
      migraciones: migraciones.totalAplicadas,
      redis: redis.isReady === true,
      installationIdInicializada: Boolean(identidad.installationId),
      federacionActiva: fotografia.configuracion.activacionFederacion,
      origenPublicoConfigurado: Boolean(fotografia.configuracion.origenPublico),
      proxiesConfiables: redPublica.totalProxiesConfiables,
      keyringDisponible: fotografia.keyring.disponible,
      clavesKeyring: fotografia.keyring.keyIds.length,
      sobresCifradosInventariados: Number(fotografia.keyring.totalSobres || 0)
    });
    escribir(
      '[federacion] DIAGNOSTICO_DESPLIEGUE_OK ' + JSON.stringify(resumen)
    );
    return resumen;
  } finally {
    await Promise.allSettled([
      clienteRedis.isOpen ? clienteRedis.quit() : Promise.resolve(),
      clienteSql.cerrar()
    ]);
  }
}

async function cargarConfiguracionPortal({ clienteSql, configuracion }) {
  const [valoresPersistidos, filasVersion] = await Promise.all([
    new RepositorioConfiguracion(clienteSql).cargarValores(),
    clienteSql.consultar(
      'SELECT CAST(version AS CHAR) AS version FROM cabecera_configuracion_portal WHERE id=1'
    )
  ]);
  if (!filasVersion[0] || !/^[1-9][0-9]*$/u.test(String(filasVersion[0].version))) {
    throw new Error('Falta la versión durable de configuración.');
  }
  return new ConfiguracionPortal({
    definiciones: obtenerDefinicionesConfiguracionPortal(configuracion),
    valoresPersistidos,
    version: Number(filasVersion[0].version)
  });
}

function crearServicioConfiguracion(portal) {
  return Object.freeze({
    async asegurarActualizada() { return portal; },
    obtenerConfiguracionActual() { return portal; },
    obtenerVersionActual() { return portal.version; }
  });
}

function crearKeyringOpcional(entorno) {
  const material = String(entorno?.FEDERACION_KEYRING || '').trim();
  const keyIdActiva = String(entorno?.FEDERACION_KEY_ID_ACTIVA || '').trim();
  if (!material && !keyIdActiva) return null;
  return new KeyringFederacionDespliegue({
    referencia: entorno.FEDERACION_KEYRING_REFERENCIA ||
      'sentinelia/federacion/v1',
    keyring: material,
    keyIdActiva
  });
}

async function paso(codigo, trabajo) {
  try {
    return await trabajo();
  } catch (error) {
    throw fallo(codigo, error);
  }
}

function fallo(codigo, causa = null) {
  const error = new Error(`El diagnóstico de despliegue falló en ${codigo}.`, {
    cause: causa
  });
  error.codigo = codigo;
  return error;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  diagnosticarDespliegueFederacion().catch((error) => {
    const codigo = String(error?.codigo || 'DIAGNOSTICO_DESPLIEGUE_FALLIDO')
      .replace(/[^A-Z0-9_]/gu, '_')
      .slice(0, 96);
    console.error(`[federacion] DIAGNOSTICO_DESPLIEGUE_FALLIDO codigo=${codigo}`);
    process.exitCode = 1;
  });
}
