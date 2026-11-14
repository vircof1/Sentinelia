import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { ProtectorContenidoSensibleFederacion } from '../paquetes/federacion/adaptadores/ProtectorContenidoSensibleFederacion.js';
import { RepositorioCursoresRecepcionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioEntregasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { ServicioRecepcionLotesFederacionLocal } from '../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import {
  crearCampoPresenteFederado
} from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO_FIXTURE = '5221211';
const TEXTO_SENSIBLE = 'credencial-remota-que-no-debe-quedar-en-claro';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212k_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  const ids = crearIdentidades();
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await limpiar(sql, ids);
    await crearPlanoControl(sql, ids);
    await verificarSecretoEmisor(sql, ids);
    await verificarMaterializacion(sql, ids);
  } finally {
    await limpiar(sql, ids);
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12k: trabajo=durable fencing=monotono ' +
    'tombstone=no-resurreccion watermark=causal secreto=cifrado-purgable'
  );
}

async function verificarSecretoEmisor(sql, ids) {
  const protector = crearProtector();
  const repositorio = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId,
    protectorContenidoSensible: protector
  });
  const definicion = {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION, ids.installationLocalId
    ),
    elementoOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, ids.elementoEmisionId
    ),
    ocurrenciaOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN, ids.ocurrenciaEmisionId
    ),
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T01:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      credencialMonitor: crearCampoPresenteFederado({
        valor: TEXTO_SENSIBLE,
        sensibilidad: 'sensible'
      })
    },
    evidenciaIntegridad: []
  };
  const conexion = await sql.obtenerConexion();
  let creada;
  try {
    await conexion.beginTransaction();
    creada = await repositorio.registrarOcurrenciaEnTransaccion({
      definicion,
      destinos: [{
        flujoId: ids.flujoEmisionId,
        generacionId: ids.generacionEmisionId,
        prioridad: 'operativaActual'
      }]
    }, { conexion });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
  assert.equal(creada.estado, 'creada');
  const [persistida] = await sql.consultar(
    `SELECT o.payload_canonico,HEX(o.payload_sha256) AS hash_publico,
            HEX(s.contenido_sha256) AS hash_original
       FROM ocurrencias_federacion o
       JOIN secretos_ocurrencias_federacion s ON s.ocurrencia_id=o.id
      WHERE o.ocurrencia_origen_id=?`,
    [ids.ocurrenciaEmisionId]
  );
  assert.equal(String(persistida.payload_canonico).includes(TEXTO_SENSIBLE), false);
  assert.notEqual(persistida.hash_publico, persistida.hash_original);
  const recuperada = await repositorio.buscarOcurrenciaPorIdentidad({
    installationOrigenId: ids.installationLocalId,
    familia: 'monitores',
    elementoOrigenId: ids.elementoEmisionId,
    ocurrenciaOrigenId: ids.ocurrenciaEmisionId
  });
  assert.equal(recuperada.toJSON().campos.credencialMonitor.valor, TEXTO_SENSIBLE);
  assert.equal((await repositorio.purgarContenidoSensible({
    installationOrigenId: ids.installationLocalId,
    familia: 'monitores',
    elementoOrigenId: ids.elementoEmisionId,
    ocurrenciaOrigenId: ids.ocurrenciaEmisionId
  })).purgado, true);
  await assert.rejects(
    repositorio.buscarOcurrenciaPorIdentidad({
      installationOrigenId: ids.installationLocalId,
      familia: 'monitores',
      elementoOrigenId: ids.elementoEmisionId,
      ocurrenciaOrigenId: ids.ocurrenciaEmisionId
    }),
    (error) => error.codigo === 'contenido_sensible_purgado'
  );
}

async function verificarRegistro() {
  const [repositorio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js')
  ]);
  assert.match(repositorio, /fencing_materializacion_obsoleto/u);
}

async function verificarMaterializacion(sql, ids) {
  const protector = crearProtector();
  const inbox = new RepositorioInboxFederacionSql(sql, {
    protectorContenidoSensible: protector
  });
  const trabajos = new RepositorioMaterializacionFederacionSql(sql);
  const servicio = new ServicioRecepcionLotesFederacionLocal({
    clienteSql: sql,
    repositorioEntregas: new RepositorioEntregasFederacionSql(sql),
    repositorioInbox: inbox,
    repositorioCursores: new RepositorioCursoresRecepcionFederacionSql(sql),
    repositorioMaterializacion: trabajos
  });

  const entradas = [
    ocurrencia(ids, 0, '1', 'actualizacion', {
      estadoOperativo: crearCampoPresenteFederado({ valor: true }),
      credencialMonitor: crearCampoPresenteFederado({
        valor: TEXTO_SENSIBLE,
        sensibilidad: 'sensible'
      })
    }, '300000'),
    ocurrencia(ids, 0, '2', 'retirada', {}, null),
    ocurrencia(ids, 0, '3', 'actualizacion', {
      estadoOperativo: crearCampoPresenteFederado({ valor: false })
    }, '300000'),
    ocurrencia(ids, 1, '1', 'actualizacion', {
      estadoOperativo: crearCampoPresenteFederado({ valor: true })
    }, null)
  ];

  const aceptacionInicial = await servicio.entregarLote(lote(ids, 0, entradas[0]));
  assert.equal(aceptacionInicial.resultados[0].clasificacion, 'terminal');
  const replay = await servicio.entregarLote(lote(ids, 0, entradas[0]));
  assert.equal(replay.resultados[0].resultado, 'aceptada');

  const [intentosAntesDeDivergencia] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM intentos_lotes_recepcion_federacion WHERE lote_id=?',
    [ids.lotes[0]]
  );
  const sensibleDivergente = {
    ...entradas[0],
    campos: {
      ...entradas[0].campos,
      credencialMonitor: crearCampoPresenteFederado({
        valor: `${TEXTO_SENSIBLE}-alterada`,
        sensibilidad: 'sensible'
      })
    }
  };
  await assert.rejects(
    servicio.entregarLote(lote(ids, 0, sensibleDivergente)),
    (error) => error.codigo === 'replay_terminal_sensible_divergente'
  );
  const [intentosTrasDivergencia] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM intentos_lotes_recepcion_federacion WHERE lote_id=?',
    [ids.lotes[0]]
  );
  assert.equal(
    Number(intentosTrasDivergencia.total),
    Number(intentosAntesDeDivergencia.total)
  );

  const [inboxSensible] = await sql.consultar(
    `SELECT i.id,i.payload_canonico,HEX(i.payload_sha256) AS hash_publico,
            HEX(s.contenido_sha256) AS hash_original,
            OCTET_LENGTH(s.ciphertext) AS bytes_cifrados
       FROM inbox_ocurrencias_federacion i
       JOIN secretos_inbox_federacion s ON s.inbox_ocurrencia_id=i.id
      WHERE i.ocurrencia_origen_id=?`,
    [ids.ocurrencias[0]]
  );
  assert.equal(String(inboxSensible.payload_canonico).includes(TEXTO_SENSIBLE), false);
  assert.ok(Number(inboxSensible.bytes_cifrados) > 0);
  const [entregaSensible] = await sql.consultar(
    `SELECT ocurrencia_canonica FROM entregas_recepcion_federacion
      WHERE entrega_id=?`,
    [ids.entregas[0]]
  );
  assert.equal(String(entregaSensible.ocurrencia_canonica).includes(TEXTO_SENSIBLE), false);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE secretos_inbox_federacion SET key_id='alterada'
        WHERE inbox_ocurrencia_id=?`,
      [inboxSensible.id]
    ),
    (error) => error.sqlState === '45000'
  );
  const recuperada = await inbox.obtenerOcurrenciaMaterializable(inboxSensible.id);
  assert.equal(recuperada.campos.credencialMonitor.valor, TEXTO_SENSIBLE);

  const [primero] = await trabajos.reclamarPendientes({
    propietario: 'worker-a', limite: 1, leaseMs: 30_000
  });
  assert.equal(primero.entregaId, ids.entregas[0]);
  assert.equal(primero.prioridad, 'operativaActual');

  for (let indice = 1; indice < entradas.length; indice += 1) {
    const resultado = await servicio.entregarLote(lote(ids, indice, entradas[indice]));
    assert.equal(resultado.resultados[0].clasificacion, 'terminal');
  }

  const filasTrabajo = await sql.consultar(
    `SELECT entrega_id,estado,causa_supresion,fencing_token,
            propietario_lease,lease_hasta_utc
       FROM trabajos_materializacion_federacion
      WHERE flujo_id=? ORDER BY posicion_flujo`,
    [ids.flujoId]
  );
  assert.deepEqual(filasTrabajo.map((fila) => [fila.estado, fila.causa_supresion]), [
    ['suprimida', 'tombstoneVigente'],
    ['pendiente', 'ninguna'],
    ['suprimida', 'retiradaOrigen'],
    ['pendiente', 'ninguna']
  ]);
  assert.equal(
    BigInt(filasTrabajo[0].fencing_token),
    BigInt(primero.fencingToken) + 1n
  );
  assert.equal(filasTrabajo[0].propietario_lease, null);
  assert.equal(filasTrabajo[0].lease_hasta_utc, null);

  await assert.rejects(
    trabajos.completar({
      entregaId: primero.entregaId,
      propietario: 'worker-a',
      fencingToken: primero.fencingToken
    }),
    (error) => error.codigo === 'fencing_materializacion_obsoleto'
  );

  const pendientes = await trabajos.reclamarPendientes({
    propietario: 'worker-b', limite: 10, leaseMs: 30_000
  });
  assert.equal(pendientes.length, 2);
  const segundo = pendientes.find((trabajo) => trabajo.entregaId === ids.entregas[1]);
  const fallable = pendientes.find((trabajo) => trabajo.entregaId === ids.entregas[3]);
  assert.ok(segundo);
  assert.ok(fallable);
  assert.equal(segundo.entregaId, ids.entregas[1]);
  await trabajos.completar({
    entregaId: segundo.entregaId,
    propietario: 'worker-b',
    fencingToken: segundo.fencingToken
  });

  await trabajos.fallar({
    entregaId: fallable.entregaId,
    propietario: 'worker-b',
    fencingToken: fallable.fencingToken,
    errorCodigo: 'dependencia_temporal'
  });
  const [reintentado] = await trabajos.reclamarPendientes({
    propietario: 'worker-d', limite: 1, leaseMs: 30_000
  });
  assert.equal(reintentado.entregaId, fallable.entregaId);
  assert.equal(BigInt(reintentado.fencingToken), BigInt(fallable.fencingToken) + 1n);
  await trabajos.completar({
    entregaId: reintentado.entregaId,
    propietario: 'worker-d',
    fencingToken: reintentado.fencingToken
  });

  const [causalidad] = await sql.consultar(
    `SELECT w.maxima_secuencia_observada,w.maxima_secuencia_materializada,
            t.secuencia_retirada,t.ocurrencia_origen_id
       FROM watermarks_elementos_federacion w
       JOIN tombstones_elementos_federacion t
         ON t.relacion_id=w.relacion_id AND t.flujo_id=w.flujo_id
        AND t.generacion_id=w.generacion_id
        AND t.installation_origen_id=w.installation_origen_id
        AND t.familia=w.familia AND t.elemento_origen_id=w.elemento_origen_id
      WHERE w.flujo_id=? AND w.elemento_origen_id=?`,
    [ids.flujoId, ids.elementos[0]]
  );
  assert.equal(String(causalidad.maxima_secuencia_observada), '3');
  assert.equal(String(causalidad.maxima_secuencia_materializada), '2');
  assert.equal(String(causalidad.secuencia_retirada), '2');
  assert.equal(causalidad.ocurrencia_origen_id, ids.ocurrencias[1]);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE watermarks_elementos_federacion
          SET maxima_secuencia_observada=1
        WHERE flujo_id=? AND elemento_origen_id=?`,
      [ids.flujoId, ids.elementos[0]]
    ),
    (error) => error.sqlState === '45000'
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE trabajos_materializacion_federacion SET prioridad='reconstruccion'
        WHERE entrega_id=?`,
      [ids.entregas[0]]
    ),
    (error) => error.sqlState === '45000'
  );

  assert.equal((await inbox.purgarContenidoSensible(inboxSensible.id)).purgado, true);
  assert.equal((await inbox.purgarContenidoSensible(inboxSensible.id)).purgado, false);
  await assert.rejects(
    inbox.obtenerOcurrenciaMaterializable(inboxSensible.id),
    (error) => error.codigo === 'contenido_sensible_purgado'
  );
  const [reserva] = await sql.consultar(
    `SELECT HEX(payload_sha256) AS hash_publico,payload_canonico
       FROM inbox_ocurrencias_federacion WHERE id=?`,
    [inboxSensible.id]
  );
  assert.equal(reserva.hash_publico, inboxSensible.hash_publico);
  assert.notEqual(reserva.hash_publico, inboxSensible.hash_original);
  assert.equal(String(reserva.payload_canonico).includes(TEXTO_SENSIBLE), false);
  const replayTrasPurga = await inbox.recibir(entradas[0]);
  assert.equal(replayTrasPurga.codigo, 'yaConocida');
  const [secretosTrasReplay] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM secretos_inbox_federacion WHERE inbox_ocurrencia_id=?',
    [inboxSensible.id]
  );
  assert.equal(Number(secretosTrasReplay.total), 0);
}

function crearProtector() {
  const clave = Buffer.alloc(32, 0x5a);
  return new ProtectorContenidoSensibleFederacion({
    keyring: {
      referencia: 'fixture/federacion/contenido/v1',
      obtenerClaveActiva: () => ({
        keyId: 'fixture-key-1',
        clave: Buffer.from(clave)
      }),
      obtenerClavePorId: (keyId) => keyId === 'fixture-key-1'
        ? Buffer.from(clave)
        : null
    },
    generarNonce: () => Buffer.alloc(12, 0x2b)
  });
}

function lote(ids, indice, contenido) {
  return {
    loteId: ids.lotes[indice],
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    entregas: [{
      entregaId: ids.entregas[indice],
      posicionFlujo: String(indice + 1),
      ocurrencia: contenido
    }]
  };
}

function ocurrencia(ids, elementoIndice, secuencia, operacion, campos, vigencia) {
  const ocurrenciaIndice = Number(secuencia) - 1 + (elementoIndice * 3);
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: identidad(TIPOS_IDENTIDAD_FEDERADA.INSTALACION, ids.installationRemotaId),
    elementoOrigenId: identidad(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, ids.elementos[elementoIndice]),
    ocurrenciaOrigenId: identidad(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN, ids.ocurrencias[ocurrenciaIndice]),
    secuenciaElemento: secuencia,
    operacion,
    tiempoOrigenUtc: `2030-01-01T00:00:0${ocurrenciaIndice}.000Z`,
    scopeOrigenDeclarado: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null },
    vigenciaRestanteMs: vigencia,
    campos,
    evidenciaIntegridad: []
  };
}

async function crearPlanoControl(sql, ids) {
  const ahora = new Date();
  await crearRelacion(sql, {
    relacionId: ids.relacionId,
    installationRemotaId: ids.installationRemotaId,
    direccion: 'recepcion',
    ahora
  });
  await crearRelacion(sql, {
    relacionId: ids.relacionEmisionId,
    installationRemotaId: ids.installationRemotaId,
    direccion: 'emision',
    ahora
  });
  const repositorio = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  await repositorio.crearFlujoInicial({
    flujo: {
      flujoId: ids.flujoId,
      relacionId: ids.relacionId,
      direccion: 'recepcion',
      familia: 'monitores',
      versionFamilia: 1,
      contexto: { nivel: 'portal' }
    },
    generacion: {
      generacionId: ids.generacionId,
      clase: 'inicial',
      fronteraInicial: '4',
      propietario: {
        installationId: ids.installationRemotaId,
        bootId: ids.bootRemotoId,
        version: 1
      }
    }
  });
  await repositorio.crearFlujoInicial({
    flujo: {
      flujoId: ids.flujoEmisionId,
      relacionId: ids.relacionEmisionId,
      direccion: 'emision',
      familia: 'monitores',
      versionFamilia: 1,
      contexto: { nivel: 'portal' }
    },
    generacion: {
      generacionId: ids.generacionEmisionId,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: ids.installationLocalId,
        bootId: ids.bootLocalId,
        version: 1
      }
    }
  });
}

async function crearRelacion(sql, {
  relacionId, installationRemotaId, direccion, ahora
}) {
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,?,'vinculada','autorizada','valida','compatible',?,?,
       'fixture 5.22.12k',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)`,
    [
      relacionId, direccion, installationRemotaId, installationRemotaId,
      USUARIO_FIXTURE, USUARIO_FIXTURE, USUARIO_FIXTURE, ahora, ahora
    ]
  );
}

async function limpiar(sql, ids) {
  const relaciones = await sql.consultar(
    `SELECT relacion_id,installation_remota_id
       FROM relaciones_federacion WHERE creada_por_usuario_id=?`,
    [USUARIO_FIXTURE]
  ).catch(() => []);
  for (const {
    relacion_id: relacionId,
    installation_remota_id: installationRemotaId
  } of relaciones) {
    const flujos = await sql.consultar(
      'SELECT flujo_id FROM flujos_federacion WHERE relacion_id=?', [relacionId]
    ).catch(() => []);
    for (const { flujo_id: flujoId } of flujos) {
      await sql.ejecutar(
        `DELETE s FROM secretos_inbox_federacion s
          JOIN trabajos_materializacion_federacion t ON t.inbox_ocurrencia_id=s.inbox_ocurrencia_id
         WHERE t.flujo_id=?`, [flujoId]
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE a FROM aplicaciones_ocurrencias_proyecciones_federacion a
          JOIN trabajos_materializacion_federacion t
            ON t.entrega_id=a.trabajo_entrega_id
         WHERE t.flujo_id=?`,
        [flujoId]
      ).catch(() => {});
      await sql.ejecutar('DELETE FROM trabajos_materializacion_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
      await sql.ejecutar(
        `DELETE p FROM proyecciones_federacion p
          LEFT JOIN aplicaciones_ocurrencias_proyecciones_federacion a
            ON a.proyeccion_id=p.proyeccion_id
         WHERE a.proyeccion_id IS NULL`
      ).catch(() => {});
      await sql.ejecutar('DELETE FROM tombstones_elementos_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
      await sql.ejecutar('DELETE FROM watermarks_elementos_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
      await limpiarFlujo(sql, flujoId);
    }
    await sql.ejecutar(
      `DELETE c FROM conflictos_contenido_inbox_federacion c
        JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
       WHERE i.installation_origen_id=?`, [installationRemotaId]
    ).catch(() => {});
    await sql.ejecutar(
      'DELETE FROM inbox_ocurrencias_federacion WHERE installation_origen_id=?',
      [installationRemotaId]
    ).catch(() => {});
    await sql.ejecutar(
      'DELETE FROM relaciones_federacion WHERE relacion_id=?', [relacionId]
    ).catch(() => {});
  }
  await sql.ejecutar(
    'DELETE FROM ocurrencias_federacion WHERE installation_origen_id=?',
    [ids.installationLocalId]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM reservas_identidad_ocurrencias_federacion WHERE installation_origen_id=?',
    [ids.installationLocalId]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM contadores_secuencia_elementos_federacion WHERE installation_origen_id=?',
    [ids.installationLocalId]
  ).catch(() => {});
}

async function limpiarFlujo(sql, flujoId) {
  for (const sentencia of [
    `DELETE r FROM resultados_entregas_recepcion_federacion r JOIN lotes_recepcion_federacion l ON l.lote_id=r.lote_id WHERE l.flujo_id=?`,
    `DELETE i FROM intentos_lotes_recepcion_federacion i JOIN lotes_recepcion_federacion l ON l.lote_id=i.lote_id WHERE l.flujo_id=?`,
    `DELETE c FROM composiciones_lotes_recepcion_federacion c JOIN lotes_recepcion_federacion l ON l.lote_id=c.lote_id WHERE l.flujo_id=?`,
    'DELETE FROM lotes_recepcion_federacion WHERE flujo_id=?',
    'DELETE FROM entregas_recepcion_federacion WHERE flujo_id=?',
    `DELETE FROM rangos_terminales_recepcion_federacion WHERE generacion_id IN (SELECT generacion_id FROM generaciones_flujos_federacion WHERE flujo_id=?)`,
    'DELETE FROM cursores_generaciones_recepcion_federacion WHERE flujo_id=?',
    'DELETE FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id=?',
    'DELETE FROM contadores_posiciones_generaciones_federacion WHERE flujo_id=?',
    'DELETE FROM propietarios_emision_flujos_federacion WHERE flujo_id=?',
    'UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id=?',
    `DELETE FROM fronteras_generaciones_federacion WHERE generacion_id IN (SELECT generacion_id FROM generaciones_flujos_federacion WHERE flujo_id=?)`,
    'DELETE FROM generaciones_flujos_federacion WHERE flujo_id=?',
    'DELETE FROM flujos_federacion WHERE flujo_id=?'
  ]) await sql.ejecutar(sentencia, [flujoId]).catch(() => {});
}

function crearIdentidades() {
  const id = (tipo) => String(generador.generar(tipo));
  return {
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootRemotoId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    bootLocalId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    relacionEmisionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    flujoEmisionId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    generacionEmisionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    elementoEmisionId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaEmisionId: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    lotes: Array.from({ length: 4 }, () => id(TIPOS_IDENTIDAD_FEDERADA.LOTE)),
    entregas: Array.from({ length: 4 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
    elementos: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)),
    ocurrencias: Array.from({ length: 4 }, () => id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN))
  };
}

function identidad(tipo, valor) {
  return crearIdentidadFederada({ tipo, valor });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
