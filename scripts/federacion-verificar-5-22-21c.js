import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode }
  from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioIntercambioConcesionFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioIntercambioConcesionFederacionSql.js';
import { ServicioIntercambioConcesionFederacion }
  from '../paquetes/federacion/aplicacion/ServicioIntercambioConcesionFederacion.js';
import {
  PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION
} from '../paquetes/federacion/src/IntercambioDeclaracionConcesionFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const USUARIO_FIXTURE = 5_222_103;

await main();

async function main() {
  await verificarRegistroYContrato();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.22.21c necesita SQL configurado para probar persistencia durable.');
  const baseDatos = `sentinelia_fixture_52221c_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarIntercambio(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.21c: protocolo=autenticado_versionado ' +
    'declaracion=durable replay=exacto divergencia=rechazada ' +
    'confirmacion=consultable autoria_local=no_inventada'
  );
}

async function verificarIntercambio(sql) {
  const ids = {
    local: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    remota: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    relacion: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    revision: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
  };
  await crearRelacion(sql, ids);
  const activacion = { activa: true, consultas: 0 };
  const servicio = new ServicioIntercambioConcesionFederacion({
    repositorio: new RepositorioIntercambioConcesionFederacionSql(sql),
    servicioSesiones: {
      async validarBearer(token) {
        assert.equal(token, 'token-fixture');
        return {
          relacionId: ids.relacion,
          installationLocalId: ids.local,
          installationRemotaId: ids.remota
        };
      }
    },
    installationLocalId: ids.local,
    guardiaActivacion: {
      async exigirActiva() {
        activacion.consultas += 1;
        if (!activacion.activa) {
          const error = new Error('Federación desactivada.');
          error.codigo = 'FEDERACION_DESACTIVADA';
          error.statusCode = 503;
          throw error;
        }
      }
    }
  });
  const declaracion = crearDeclaracion(ids);
  const primera = await servicio.recibir({
    token: 'token-fixture', declaracion
  });
  assert.equal(primera.estado, 'persistida');
  const repetida = await servicio.recibir({
    token: 'token-fixture', declaracion
  });
  assert.equal(repetida.estado, 'yaConocida');
  assert.equal(repetida.confirmacionId, primera.confirmacionId,
    'El replay exacto debe recuperar la confirmación durable original.');

  await assert.rejects(
    servicio.recibir({
      token: 'token-fixture',
      declaracion: { ...declaracion, intercambioId: generarUuidV7Auditoria() }
    }),
    (error) => error.codigo === 'REPLAY_DECLARACION_FEDERACION_DIVERGENTE',
    'Una revisión conocida no puede reaparecer bajo otro intercambio.'
  );

  await assert.rejects(
    servicio.recibir({
      token: 'token-fixture',
      declaracion: {
        ...declaracion,
        seleccion: { ...declaracion.seleccion, activa: false }
      }
    }),
    (error) => error.codigo === 'REPLAY_DECLARACION_FEDERACION_DIVERGENTE' &&
      error.statusCode === 409
  );
  await assert.rejects(
    servicio.recibir({
      token: 'token-fixture',
      declaracion: {
        ...declaracion,
        emitidaEnUtc: new Date(Date.parse(declaracion.emitidaEnUtc) + 1).toISOString()
      }
    }),
    (error) => error.codigo === 'REPLAY_DECLARACION_FEDERACION_DIVERGENTE',
    'La cronología declarada también forma parte del contenido inmutable.'
  );
  await assert.rejects(
    servicio.recibir({
      token: 'token-fixture',
      declaracion: { ...declaracion, protocoloVersion: 2 }
    }),
    (error) => error.codigo === 'VERSION_PROTOCOLO_FEDERACION_INCOMPATIBLE'
  );
  await assert.rejects(
    servicio.recibir({
      token: 'token-fixture',
      declaracion: { ...declaracion, intercambioId: 'no-es-uuid' }
    }),
    (error) => error.codigo === 'IDENTIDAD_INTERCAMBIO_FEDERACION_INVALIDA' &&
      error.statusCode === 400
  );
  await assert.rejects(
    servicio.recibir({
      token: 'token-fixture',
      declaracion: {
        ...declaracion,
        versionAutoridad: '18446744073709551616'
      }
    }),
    (error) => error.codigo === 'VERSION_AUTORIDAD_FEDERACION_INVALIDA' &&
      error.statusCode === 400
  );
  await assert.rejects(
    servicio.recibir({
      token: 'token-fixture',
      declaracion: { ...declaracion, seleccion: { activa: true } }
    }),
    (error) => error.codigo === 'SELECCION_DECLARACION_FEDERACION_INVALIDA' &&
      error.statusCode === 400
  );
  await assert.rejects(
    servicio.recibir({
      token: 'token-fixture',
      declaracion: {
        ...declaracion,
        intercambioId: generarUuidV7Auditoria(),
        revisionId: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
        seleccion: {
          ...declaracion.seleccion,
          familias: {
            monitores: {
              ...declaracion.seleccion.familias.monitores,
              campos: ['estadoOperativo']
            }
          }
        }
      }
    }),
    (error) => error.codigo === 'SELECCION_DECLARACION_FEDERACION_INVALIDA' &&
      error.statusCode === 400,
    'Una declaración remota no puede inventar campos fuera del selector tipado.'
  );

  const consultasActivacionAntesLectura = activacion.consultas;
  activacion.activa = false;
  const consultada = await servicio.consultarConfirmacion({
    token: 'token-fixture',
    relacionId: ids.relacion,
    intercambioId: declaracion.intercambioId
  });
  assert.equal(consultada.confirmacionId, primera.confirmacionId,
    'Desactivar no debe ocultar una confirmación ya persistida.');
  assert.equal(activacion.consultas, consultasActivacionAntesLectura,
    'La guardia debe bloquear altas, no lecturas durables existentes.');

  const intercambios = await sql.consultar(
    'SELECT COUNT(*) AS total FROM intercambios_declaraciones_concesion_federacion'
  );
  const revisionesLocales = await sql.consultar(
    'SELECT COUNT(*) AS total FROM revisiones_concesion_federacion'
  );
  assert.equal(Number(intercambios[0].total), 1);
  assert.equal(Number(revisionesLocales[0].total), 0,
    'Una declaración remota no puede atribuirse a un usuario local inexistente.');
}

function crearDeclaracion(ids) {
  return {
    perfil: PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION,
    protocoloVersion: 1,
    intercambioId: generarUuidV7Auditoria(),
    relacionId: ids.relacion,
    installationEmisoraId: ids.remota,
    installationReceptoraId: ids.local,
    papel: 'oferta',
    revisionId: ids.revision,
    revisionOrdinal: '1',
    versionAutoridad: '1',
    seleccion: {
      activa: true,
      nivelesScope: ['empresa'],
      familias: {
        monitores: {
          campos: ['monitores'],
          permiteContenidoSensible: false,
          permiteRefederacion: true
        }
      }
    },
    emitidaEnUtc: new Date().toISOString()
  };
}

async function crearRelacion(sql, ids) {
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (
       ?,'recepcion','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [ids.relacion, ids.remota, ids.remota, 'remota 21c', USUARIO_FIXTURE,
      USUARIO_FIXTURE, USUARIO_FIXTURE, ahora, ahora]
  );
}

async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

async function verificarRegistroYContrato() {
  const [openapi, rutas, web] = await Promise.all([
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.match(openapi, /publicarDeclaracionConcesionFederadaV1/u);
  assert.match(openapi, /consultarConfirmacionDeclaracionConcesionFederadaV1/u);
  assert.match(openapi, /FederationConcessionRevisionId:/u);
  assert.match(rutas, /control\/concesion\/declaraciones/u);
  assert.match(web, /new ServicioIntercambioConcesionFederacion/u);
}

function id(tipo) {
  return String(generador.generar(tipo));
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
