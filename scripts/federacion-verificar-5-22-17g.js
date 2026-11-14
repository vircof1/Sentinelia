import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { AdaptadorAuditoriaReconstruccionesFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaReconstruccionesFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioGeneracionesCandidatasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioGeneracionesCandidatasFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { ServicioCorteInicialGeneracionFederacion } from '../paquetes/federacion/aplicacion/ServicioCorteInicialGeneracionFederacion.js';
import { ServicioReconstruccionesManualesFederacion } from '../paquetes/federacion/aplicacion/ServicioReconstruccionesManualesFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO = 5_221_707;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  await verificarDireccionCreacion();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52217g_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await verificarDecisiones(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.17g: reconstruccion=manual decisiones=4 ' +
    'activa=preservada promocion=atomica revalidacion=obligatoria auditoria=transaccional'
  );
}

async function verificarDecisiones(sql) {
  const ids = crearIds();
  await crearUsuarioYRelacion(sql, ids);
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const ocurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const captura = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: ocurrencias,
    repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
  });
  const corte = new ServicioCorteInicialGeneracionFederacion({
    clienteSql: sql,
    repositorioFlujos: flujos,
    repositorioOcurrencias: ocurrencias,
    adaptadorCaptura: captura,
    fuenteFotografia: { listarCapturasEnTransaccion: async () => [] }
  });
  await corte.preparar({
    flujo: definicionFlujo(ids),
    generacion: {
      generacionId: ids.generacionInicialId,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: propietario(ids, 1)
    }
  });
  await corte.cerrar({ flujoId: ids.flujoId, generacionId: ids.generacionInicialId });
  await completarInicial(flujos, ids);

  const candidatas = new RepositorioGeneracionesCandidatasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId,
    adaptadorAuditoriaReconstrucciones:
      new AdaptadorAuditoriaReconstruccionesFederacion({
        repositorioAuditoria: new RepositorioAuditoria(sql)
      })
  });
  const servicio = new ServicioReconstruccionesManualesFederacion({
    repositorioFlujos: flujos,
    repositorioCandidatas: candidatas,
    servicioCorteInicial: corte,
    generadorIdentidades: generador
  });
  const usuario = { idUsuario: String(USUARIO), impersonacionActiva: false };

  const altaA = await servicio.decidir({
    flujoId: ids.flujoId,
    estrategia: 'coexistir',
    contextoUsuarioActual: usuario,
    motivo: 'Reconstrucción A de prueba'
  });
  const generacionA = altaA.candidata.generacionId;
  assert.equal(altaA.candidata.estado, 'transfiriendo');
  await exigirActiva(sql, ids.flujoId, ids.generacionInicialId);
  await completarCandidata(candidatas, ids.flujoId, generacionA);
  await assert.rejects(
    servicio.revalidar({
      flujoId: ids.flujoId,
      generacionId: generacionA,
      contextoUsuarioActual: usuario,
      motivo: 'No existe una nueva activa contra la que revalidar'
    }),
    (error) => error.codigo === 'candidata_no_requiere_revalidacion'
  );

  const espera = await servicio.decidir({
    flujoId: ids.flujoId,
    estrategia: 'esperar',
    contextoUsuarioActual: usuario,
    motivo: 'Esperar la candidata existente'
  });
  assert.equal(espera.resultado, 'espera');
  const ampliada = await servicio.decidir({
    flujoId: ids.flujoId,
    estrategia: 'ampliarCompatible',
    generacionObjetivoId: generacionA,
    contextoUsuarioActual: usuario,
    motivo: 'Ampliar la candidata existente'
  });
  assert.equal(ampliada.resultado, 'ampliacionCompatible');

  const altaB = await servicio.decidir({
    flujoId: ids.flujoId,
    estrategia: 'coexistir',
    contextoUsuarioActual: usuario,
    motivo: 'Reconstrucción B concurrente'
  });
  const generacionB = altaB.candidata.generacionId;
  await completarCandidata(candidatas, ids.flujoId, generacionB);
  await servicio.promover({
    flujoId: ids.flujoId,
    generacionId: generacionA,
    contextoUsuarioActual: usuario,
    motivo: 'Promover la primera candidata'
  });
  await exigirActiva(sql, ids.flujoId, generacionA);
  await assert.rejects(
    servicio.promover({
      flujoId: ids.flujoId,
      generacionId: generacionB,
      contextoUsuarioActual: usuario,
      motivo: 'Promoción prematura'
    }),
    (error) => error.codigo === 'candidata_requiere_revalidacion'
  );
  await completarCandidata(candidatas, ids.flujoId, generacionB);
  const revalidada = await servicio.revalidar({
    flujoId: ids.flujoId,
    generacionId: generacionB,
    contextoUsuarioActual: usuario,
    motivo: 'Revalidar contra la nueva activa'
  });
  assert.equal(revalidada.resultado, 'revalidada');
  await servicio.promover({
    flujoId: ids.flujoId,
    generacionId: generacionB,
    contextoUsuarioActual: usuario,
    motivo: 'Promover la candidata revalidada'
  });
  await exigirActiva(sql, ids.flujoId, generacionB);

  const altaC = await servicio.decidir({
    flujoId: ids.flujoId,
    estrategia: 'coexistir',
    contextoUsuarioActual: usuario,
    motivo: 'Candidata que será sustituida'
  });
  const sustitucion = await servicio.decidir({
    flujoId: ids.flujoId,
    estrategia: 'sustituir',
    contextoUsuarioActual: usuario,
    motivo: 'Sustituir candidatas deliberadamente'
  });
  assert.notEqual(sustitucion.candidata.generacionId, altaC.candidata.generacionId);
  const [canceladaC] = await sql.consultar(
    'SELECT estado FROM generaciones_flujos_federacion WHERE generacion_id=?',
    [altaC.candidata.generacionId]
  );
  assert.equal(canceladaC.estado, 'cancelada');
  await servicio.cancelar({
    flujoId: ids.flujoId,
    generacionId: sustitucion.candidata.generacionId,
    contextoUsuarioActual: usuario,
    motivo: 'Cancelar la reconstrucción restante'
  });
  await exigirActiva(sql, ids.flujoId, generacionB);
  await assert.rejects(
    servicio.decidir({
      flujoId: ids.flujoId,
      estrategia: 'esperar',
      contextoUsuarioActual: usuario,
      motivo: 'No queda ninguna candidata'
    }),
    (error) => error.codigo === 'candidata_espera_inexistente'
  );

  const [resumen] = await sql.consultar(
    `SELECT COUNT(*) AS total,COUNT(DISTINCT evento_auditoria_id) AS eventos
       FROM decisiones_reconstrucciones_federacion WHERE flujo_id=?`,
    [ids.flujoId]
  );
  assert.equal(Number(resumen.total), 10);
  assert.equal(Number(resumen.eventos), 10);
  const eventos = await sql.consultar(
    `SELECT tipo_evento FROM eventos_auditoria
      WHERE tipo_evento='federacion.reconstruccion_decidida'`
  );
  assert.equal(eventos.length, 10);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE decisiones_reconstrucciones_federacion
          SET motivo='No debe mutar' WHERE flujo_id=? LIMIT 1`,
      [ids.flujoId]
    ),
    /inmutables/u
  );

  const candidatasSinAuditoria = new RepositorioGeneracionesCandidatasFederacionSql(
    sql,
    {
      installationLocalId: ids.installationLocalId,
      adaptadorAuditoriaReconstrucciones: {
        registrarEnTransaccion: async () => {
          throw new Error('fallo_auditoria_forzado');
        }
      }
    }
  );
  const servicioSinAuditoria = new ServicioReconstruccionesManualesFederacion({
    repositorioFlujos: flujos,
    repositorioCandidatas: candidatasSinAuditoria,
    servicioCorteInicial: corte,
    generadorIdentidades: generador
  });
  await assert.rejects(
    servicioSinAuditoria.decidir({
      flujoId: ids.flujoId,
      estrategia: 'coexistir',
      contextoUsuarioActual: usuario,
      motivo: 'La auditoría debe cercar la mutación'
    }),
    /fallo_auditoria_forzado/u
  );
  assert.equal((await candidatas.listar(ids.flujoId)).length, 0);
  const [trasRollback] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM decisiones_reconstrucciones_federacion
      WHERE flujo_id=?`,
    [ids.flujoId]
  );
  assert.equal(Number(trasRollback.total), 10);

  await sql.ejecutar(
    'UPDATE usuarios SET permiso_configurar_emisiones_federacion=0 WHERE id=?',
    [USUARIO]
  );
  await assert.rejects(
    servicio.decidir({
      flujoId: ids.flujoId,
      estrategia: 'coexistir',
      contextoUsuarioActual: usuario,
      motivo: 'No debe persistirse'
    }),
    (error) => error.codigo === 'autoridad_reconstruccion_insuficiente'
  );
  assert.equal((await candidatas.listar(ids.flujoId)).length, 0);
  await assert.rejects(
    servicio.decidir({
      flujoId: ids.flujoId,
      estrategia: 'coexistir',
      contextoUsuarioActual: { ...usuario, impersonacionActiva: true },
      motivo: 'No debe permitirse'
    }),
    (error) => error.codigo === 'sesion_directa_requerida'
  );
}

async function verificarDireccionCreacion() {
  let resoluciones = 0;
  const servicio = new ServicioReconstruccionesManualesFederacion({
    repositorioFlujos: {
      obtener: async () => ({
        flujoId: 'flujo-recepcion',
        direccion: 'recepcion',
        generacion: { propietario: { installationId: 'i', bootId: 'b', version: 1 } }
      })
    },
    repositorioCandidatas: {
      resolver: async () => { resoluciones += 1; },
      listar: async () => [],
      avanzar: async () => {},
      cancelar: async () => {},
      promover: async () => {},
      revalidar: async () => {}
    },
    servicioCorteInicial: { cerrar: async () => {} },
    generadorIdentidades: generador
  });
  await assert.rejects(
    servicio.decidir({
      flujoId: 'flujo-recepcion',
      estrategia: 'coexistir',
      contextoUsuarioActual: { idUsuario: String(USUARIO), impersonacionActiva: false },
      motivo: 'El receptor no inventa generaciones'
    }),
    (error) => error.codigo === 'direccion_reconstruccion_invalida'
  );
  assert.equal(resoluciones, 0);
}

async function completarInicial(flujos, ids) {
  let actual = await flujos.obtener(ids.flujoId);
  actual = await flujos.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: propietario(ids, 1),
    versionEstadoEsperada: actual.generacion.versionEstado,
    versionFronteraEsperada: actual.generacion.frontera.version,
    estadoGeneracion: 'transfiriendo',
    estadoFlujo: 'sincronizando',
    frontera: frontera(false)
  });
  await flujos.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: propietario(ids, 1),
    versionEstadoEsperada: actual.generacion.versionEstado,
    versionFronteraEsperada: actual.generacion.frontera.version,
    estadoGeneracion: 'completa',
    estadoFlujo: 'operativoCompleto',
    frontera: frontera(true)
  });
}

async function completarCandidata(repositorio, flujoId, generacionId) {
  let candidata = (await repositorio.listar(flujoId)).find(
    ({ generacionId: actual }) => actual === generacionId
  );
  if (candidata.estado !== 'transfiriendo') {
    candidata = await repositorio.avanzar({
      flujoId,
      generacionId,
      propietario: candidata.propietario,
      versionEstadoEsperada: candidata.versionEstado,
      versionFronteraEsperada: candidata.frontera.version,
      estadoGeneracion: 'transfiriendo',
      frontera: frontera(false)
    });
  }
  return repositorio.avanzar({
    flujoId,
    generacionId,
    propietario: candidata.propietario,
    versionEstadoEsperada: candidata.versionEstado,
    versionFronteraEsperada: candidata.frontera.version,
    estadoGeneracion: 'completa',
    frontera: frontera(true)
  });
}

function frontera(completa) {
  return {
    posicionOperativa: completa ? '0' : null,
    posicionHistorica: completa ? '0' : null,
    sincronizando: !completa,
    operativamenteCompleta: completa,
    historicamenteCompleta: completa,
    parcialPorScope: false,
    degradada: false
  };
}

async function exigirActiva(sql, flujoId, generacionId) {
  const [fila] = await sql.consultar(
    'SELECT generacion_activa_id FROM flujos_federacion WHERE flujo_id=?',
    [flujoId]
  );
  assert.equal(fila.generacion_activa_id, generacionId);
}

function definicionFlujo(ids) {
  return {
    flujoId: ids.flujoId,
    relacionId: ids.relacionId,
    direccion: 'emision',
    familia: 'monitores',
    versionFamilia: 1,
    contexto: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null }
  };
}

function propietario(ids, version) {
  return {
    installationId: ids.installationLocalId,
    bootId: ids.bootId,
    version
  };
}

async function crearUsuarioYRelacion(sql, ids) {
  await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,
       permiso_configurar_emisiones_federacion
     ) VALUES (?, ?, ?, 'fixture-no-login', 1, 1)`,
    [USUARIO, `fixture-17g-${USUARIO}`, `fixture-17g-${USUARIO}@invalid.local`]
  );
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
       ?,'emision','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      ids.relacionId,ids.installationRemotaId,ids.installationRemotaId,
      'fixture 5.22.17g',USUARIO,USUARIO,USUARIO,ahora,ahora
    ]
  );
}

function crearIds() {
  const id = (tipo) => generador.generar(tipo);
  const installationLocal = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  return Object.freeze({
    installationLocalId: String(installationLocal),
    installationRemotaId: String(id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)),
    bootId: String(id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)),
    relacionId: String(id(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    flujoId: String(id(TIPOS_IDENTIDAD_FEDERADA.FLUJO)),
    generacionInicialId: String(id(TIPOS_IDENTIDAD_FEDERADA.GENERACION))
  });
}


await main();
