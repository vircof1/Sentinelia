import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { AdaptadorAuditoriaAvisosPlataforma, RepositorioAvisosPlataformaSql, ServicioAvisosPlataforma, generarIdAvisoPlataforma } from '../paquetes/avisos-plataforma/src/index.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { AdaptadorAvisosFederados, crearDefinicionAdaptadorAvisosFederados } from '../paquetes/federacion/adaptadores/AdaptadorAvisosFederados.js';
import { RepositorioAvisosFederadosLocalSql } from '../paquetes/federacion/adaptadores/RepositorioAvisosFederadosLocalSql.js';
import { RepositorioAvisosFederadosRemotoSql } from '../paquetes/federacion/adaptadores/RepositorioAvisosFederadosRemotoSql.js';
import { validarFotografiaActorFederado } from '../paquetes/federacion/src/FotografiaActorFederado.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { validarPayloadAvisosFederados } from '../paquetes/federacion/src/PayloadAvisosFederados.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { crearElemento, id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215o_${randomBytes(6).toString('hex')}`;
  const admin = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await admin.ejecutar(`CREATE DATABASE ${admin.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarFamilia(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await admin.ejecutar(`DROP DATABASE IF EXISTS ${admin.escaparIdentificador(baseDatos)}`).catch(() => {});
    await admin.cerrar();
  }
  console.log('[federacion] OK 5.22.15o: avisos=informativos_remotos actores=fotografia_minima_sin_cuenta estado_e_historico=tipados aviso_local=intacto');
}

async function verificarRegistro() {
  const definicion = crearDefinicionAdaptadorAvisosFederados();
  assert.equal(definicion.productivo, false);
}

async function verificarFamilia(sql) {
  const installationLocalId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const local = new RepositorioAvisosFederadosLocalSql(sql, {
    installationLocalId,
    ahora: () => new Date('2031-03-04T05:06:07.000Z')
  });
  const avisoId = await crearAvisoLocal(sql, local);
  const conexion = await sql.obtenerConexion();
  let estado, transicion;
  try {
    await conexion.beginTransaction();
    estado = await local.prepararCapturaEnTransaccion({
      avisoId, tipoRegistro: 'estadoActual', incluirActorVisible: true, puedeVerActor: true
    }, { conexion });
    transicion = await local.prepararCapturaEnTransaccion({
      avisoId, tipoRegistro: 'transicion', ordinal: 1,
      incluirActorVisible: false, puedeVerActor: false
    }, { conexion });
    await conexion.commit();
  } finally { conexion.release(); }
  assert.equal(estado.payload.actorUltimaTransicion.estado, 'visible');
  assert.equal(estado.payload.actorUltimaTransicion.tipo, 'runtime');
  assert.equal(transicion.payload.actor.estado, 'opaca');
  assert.equal(estado.definicion.campos.avisosFederados.sensibilidad, 'sensible');
  assert.equal(transicion.definicion.campos.avisosFederados.sensibilidad, 'ordinario');
  assert.equal(Object.hasOwn(estado.payload.actorUltimaTransicion, 'email'), false);
  assert.throws(
    () => validarFotografiaActorFederado({
      ...estado.payload.actorUltimaTransicion, email: 'no@federar.invalid'
    }),
    (error) => error.codigo === 'forma_fotografia_actor_invalida'
  );
  assert.throws(
    () => validarPayloadAvisosFederados({ ...estado.payload, cuentaUsuario: { id: 1 } }),
    (error) => error.codigo === 'forma_aviso_federado_invalida'
  );
  assert.equal(
    validarPayloadAvisosFederados({
      ...transicion.payload,
      transicionTipo: 'actualizacion',
      estadoAnterior: 'pendiente',
      estadoNuevo: 'pendiente',
      gravedadAnterior: 'advertencia',
      gravedadNueva: 'advertencia'
    }).transicionTipo,
    'actualizacion'
  );
  assert.throws(
    () => validarPayloadAvisosFederados({
      ...transicion.payload,
      transicionTipo: 'reconocimiento'
    }),
    (error) => error.codigo === 'transicion_aviso_federado_invalida'
  );
  assert.throws(
    () => validarPayloadAvisosFederados({
      ...transicion.payload,
      transicionTipo: 'resolucion',
      estadoAnterior: 'pendiente',
      estadoNuevo: 'pendiente'
    }),
    (error) => error.codigo === 'semantica_transicion_aviso_federado_invalida'
  );

  const conexionRetirada = await sql.obtenerConexion();
  try {
    await conexionRetirada.beginTransaction();
    const retiradas = await local.prepararRetiradaEnTransaccion(
      { avisoId },
      { conexion: conexionRetirada }
    );
    assert.deepEqual(
      retiradas.map((retirada) => retirada.tipoRegistro).sort(),
      ['estadoActual', 'transicion']
    );
    await conexionRetirada.rollback();
  } finally {
    conexionRetirada.release();
  }

  const remoto = new RepositorioAvisosFederadosRemotoSql(sql);
  const adaptador = new AdaptadorAvisosFederados({ repositorioLocal: local, repositorioRemoto: remoto });
  assert.equal(crearDefinicionAdaptadorAvisosFederados({ repositorioLocal: local, repositorioRemoto: remoto }).productivo, true);
  const installationRemotaId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  await crearElemento({ sql, adaptador, installationRemotaId, elementoOrigenId: estado.elementoOrigenId, payload: estado.payload, familia: 'avisosFederados' });
  await crearElemento({ sql, adaptador, installationRemotaId, elementoOrigenId: transicion.elementoOrigenId, payload: transicion.payload, familia: 'avisosFederados' });
  const estados = await remoto.listarEstados({ installationOrigenId: installationRemotaId });
  const transiciones = await remoto.listarTransiciones({ installationOrigenId: installationRemotaId });
  assert.equal(estados.length, 1);
  assert.equal(transiciones.length, 1);
  assert.equal(estados[0].payload.avisoOrigenId, avisoId);
  assert.equal(estados[0].payload.installationAfectadaId, installationLocalId);
  assert.equal(transiciones[0].payload.eventoAuditoriaOrigenId.length, 36);
  const [avisosLocales] = await sql.consultar('SELECT COUNT(*) AS total FROM avisos_plataforma');
  assert.equal(Number(avisosLocales.total), 1);
  await assert.rejects(
    sql.ejecutar('DELETE FROM identidades_actores_federacion LIMIT 1'),
    (error) => error.code === 'ER_SIGNAL_EXCEPTION'
  );
  await assert.rejects(
    sql.ejecutar('DELETE FROM identidades_elementos_avisos_federacion LIMIT 1'),
    (error) => error.code === 'ER_SIGNAL_EXCEPTION'
  );
}

async function crearAvisoLocal(sql, capturadorFederacion) {
  const auditoria = new RepositorioAuditoria(sql);
  const servicio = new ServicioAvisosPlataforma({
    repositorioAvisos: new RepositorioAvisosPlataformaSql(sql, {
      adaptadorAuditoria: new AdaptadorAuditoriaAvisosPlataforma({ repositorioAuditoria: auditoria }),
      capturadorFederacion
    })
  });
  const ahora = new Date(Date.now() - 60_000).toISOString();
  const resultado = await servicio.detectar({
    eventoId: generarIdAvisoPlataforma(), correlacionId: generarIdAvisoPlataforma(),
    efectivoEnUtc: ahora, causalidad: null,
    actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
    claveCausal: {
      versionCatalogo: 1, tipoCodigo: 'comunicacion', causaCodigo: 'relacion_silenciosa',
      objetoTipo: 'instalacion_federada', objetoId: 'instalacion-remota-fixture',
      relacionId: null, flujoId: null,
      scope: { tenantId: null, empresaId: null, sitioId: null }
    },
    contextoHumano: { detalle: 'Silencio remoto observado' },
    resumen: { comprobaciones: 1 }
  });
  assert.equal(resultado.capturasFederadas.length, 2);
  assert.deepEqual(
    resultado.capturasFederadas.map((captura) => captura.tipoRegistro),
    ['estadoActual', 'transicion']
  );
  return resultado.aviso.avisoId;
}
