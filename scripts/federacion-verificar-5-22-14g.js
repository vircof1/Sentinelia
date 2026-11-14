import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { AdaptadorAuditoriaAvisosPlataforma } from '../paquetes/avisos-plataforma/src/AdaptadorAuditoriaAvisosPlataforma.js';
import { RepositorioAvisosPlataformaSql } from '../paquetes/avisos-plataforma/src/RepositorioAvisosPlataformaSql.js';
import { ServicioAvisosPlataforma } from '../paquetes/avisos-plataforma/src/ServicioAvisosPlataforma.js';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { AdaptadorAuditoriaDivergenciasFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaDivergenciasFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioContribucionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioContribucionesFederacionSql.js';
import { RepositorioCursoresRecepcionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioDivergenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioDivergenciasFederacionSql.js';
import { RepositorioEntregasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { RepositorioEstadoProyeccionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEstadoProyeccionesFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioSoporteCamposFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSoporteCamposFederacionSql.js';
import { ServicioRecepcionLotesFederacionLocal } from '../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import { ServicioDivergenciasFederacion } from '../paquetes/federacion/aplicacion/ServicioDivergenciasFederacion.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  crearIds,
  crearProtector,
  crearRelacion,
  crearRevision,
  migrar,
  ocurrencia
} from './federacion-verificar-5-22-14e.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52214g_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarDivergenciaYExclusion(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.14g: variantes=rutas_preservadas ' +
    'frontera=ultima_coherente efectos=bloqueados evidencia=converge ' +
    'exclusion=auditada_y_exige_resincronizacion aviso=plataforma ' +
    'multiples=atomicas sin_frontera=despublicada'
  );
}

async function verificarRegistro() {
  const [repositorio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioDivergenciasFederacionSql.js')
  ]);
  assert.match(repositorio, /autorizarContinuidadEnTransaccion/u);
  assert.match(repositorio, /pendienteResincronizacion/u);
}

async function verificarDivergenciaYExclusion(sql) {
  const ids = crearIds();
  const protector = crearProtector();
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  for (let indice = 0; indice < 2; indice += 1) {
    await crearRelacion(sql, ids, indice);
    await crearRevision(sql, ids, indice, ['nombre', 'estado']);
    await flujos.crearFlujoInicial({
      flujo: {
        flujoId: ids.flujos[indice],
        relacionId: ids.relaciones[indice],
        direccion: 'recepcion',
        familia: 'monitores',
        versionFamilia: 1,
        contexto: {
          nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null
        }
      },
      generacion: {
        generacionId: ids.generaciones[indice],
        clase: 'inicial',
        fronteraInicial: '0',
        propietario: {
          installationId: ids.emisores[indice],
          bootId: ids.boots[indice],
          version: 1
        }
      }
    });
  }
  const repositorioAuditoria = new RepositorioAuditoria(sql);
  const servicioAvisos = new ServicioAvisosPlataforma({
    repositorioAvisos: new RepositorioAvisosPlataformaSql(sql, {
      adaptadorAuditoria: new AdaptadorAuditoriaAvisosPlataforma({
        repositorioAuditoria
      })
    })
  });
  const soporte = new RepositorioSoporteCamposFederacionSql(sql, {
    protectorContenidoSensible: protector
  });
  const divergencias = new RepositorioDivergenciasFederacionSql(sql, {
    servicioAvisos,
    adaptadorAuditoria: new AdaptadorAuditoriaDivergenciasFederacion({
      repositorioAuditoria
    }),
    repositorioSoporteCampos: soporte
  });
  const estado = new RepositorioEstadoProyeccionesFederacionSql(sql, {
    repositorioDivergencias: divergencias
  });
  const contribuciones = [...ids.contribucionesGeneradas];
  const proyeccionSinFronteraId = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.PROYECCION
  ));
  const proyecciones = [ids.proyeccionId, proyeccionSinFronteraId];
  const materializacion = new RepositorioMaterializacionFederacionSql(sql, {
    generarProyeccionId: () => proyecciones.shift() || String(
      generador.generar(TIPOS_IDENTIDAD_FEDERADA.PROYECCION)
    ),
    repositorioContribuciones: new RepositorioContribucionesFederacionSql(sql, {
      generarContribucionId: () => contribuciones.shift() || String(
        generador.generar(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION)
      )
    }),
    repositorioSoporteCampos: soporte,
    repositorioEstadoProyecciones: estado
  });
  const servicio = new ServicioRecepcionLotesFederacionLocal({
    clienteSql: sql,
    repositorioEntregas: new RepositorioEntregasFederacionSql(sql),
    repositorioInbox: new RepositorioInboxFederacionSql(sql, {
      protectorContenidoSensible: protector
    }),
    repositorioCursores: new RepositorioCursoresRecepcionFederacionSql(sql),
    repositorioMaterializacion: materializacion,
    repositorioDivergencias: divergencias,
    normalizadorVistas: soporte
  });

  const ocurrencia1 = ids.ocurrencias[0];
  const ocurrencia2 = ids.ocurrencias[1];
  await recibir(servicio, ids, {
    ruta: 0, posicion: '1', secuencia: '1', ocurrenciaId: ocurrencia1,
    nombre: 'frontera uno', estado: true
  });
  await completarSiguiente(materializacion, 'worker-14g-1');
  await recibir(servicio, ids, {
    ruta: 0, posicion: '2', secuencia: '2', ocurrenciaId: ocurrencia2,
    nombre: 'variante consolidada', estado: false
  });
  await completarSiguiente(materializacion, 'worker-14g-2');
  assert.equal((await estado.obtenerActual(ids.proyeccionId)).ultimaSecuenciaCoherente, '2');

  const conflictiva2 = await recibir(servicio, ids, {
    ruta: 1, posicion: '1', secuencia: '2', ocurrenciaId: ocurrencia2,
    nombre: 'variante incompatible', estado: true
  });
  assert.equal(conflictiva2.resultados[0].resultado, 'divergente');
  let actual = await estado.obtenerActual(ids.proyeccionId);
  assert.equal(actual.coherencia, 'divergente');
  assert.equal(actual.ultimaSecuenciaCoherente, '1');
  assert.equal(actual.completitud.observable, 'degradada');
  await assert.rejects(
    sql.ejecutar(
      `DELETE FROM fronteras_coherentes_proyecciones_federacion
        WHERE proyeccion_id=? LIMIT 1`,
      [ids.proyeccionId]
    ),
    (error) => error.sqlState === '45000'
  );
  let [divergencia] = await sql.consultar(
    `SELECT * FROM divergencias_proyecciones_federacion
      WHERE proyeccion_id=? ORDER BY id DESC LIMIT 1`,
    [ids.proyeccionId]
  );
  let variantes = await sql.consultar(
    `SELECT * FROM variantes_divergencias_proyecciones_federacion
      WHERE divergencia_id=? ORDER BY clase,id`,
    [divergencia.id]
  );
  assert.deepEqual(new Set(variantes.map((fila) => fila.clase)),
    new Set(['consolidada', 'conflictiva']));
  assert.equal(variantes.every((fila) => fila.recorrido_sha256 !== null), true);
  const [avisoAbierto] = await sql.consultar(
    `SELECT estado_ciclo FROM avisos_plataforma
      WHERE tipo_codigo='consistencia' AND causa_codigo='divergencia_ocurrencia'
      ORDER BY id DESC LIMIT 1`
  );
  assert.equal(avisoAbierto.estado_ciclo, 'pendiente');
  const [deteccionAuditada] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM eventos_auditoria
      WHERE tipo_evento='federacion.divergencia_detectada'
        AND sujeto_id=?`,
    [ids.proyeccionId]
  );
  assert.equal(Number(deteccionAuditada.total), 1);

  const ocurrencia3 = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
  ));
  await recibir(servicio, ids, {
    ruta: 0, posicion: '3', secuencia: '3', ocurrenciaId: ocurrencia3,
    nombre: 'convergencia posterior', estado: true
  });
  await recibir(servicio, ids, {
    ruta: 1, posicion: '2', secuencia: '3', ocurrenciaId: ocurrencia3,
    nombre: 'convergencia posterior', estado: true
  });
  const convergida = await completarSiguiente(materializacion, 'worker-14g-3');
  assert.equal(
    convergida.estadoProyeccion.publicada,
    true,
    JSON.stringify(convergida.estadoProyeccion)
  );
  actual = await estado.obtenerActual(ids.proyeccionId);
  assert.equal(actual.coherencia, 'coherente');
  assert.equal(actual.ultimaSecuenciaCoherente, '3');
  [divergencia] = await sql.consultar(
    'SELECT * FROM divergencias_proyecciones_federacion WHERE id=?',
    [divergencia.id]
  );
  assert.equal(divergencia.estado, 'resueltaEvidencia');
  await verificarResolucionAtomicaDeMultiplesDivergencias({
    sql,
    divergencias,
    ids,
    divergenciaFuenteId: String(divergencia.id),
    ocurrenciaPrimeraId: ocurrencia1,
    ocurrenciaConvergenteId: ocurrencia3
  });
  const replayHistorico = await recibir(servicio, ids, {
    ruta: 1, posicion: '3', secuencia: '2', ocurrenciaId: ocurrencia2,
    nombre: 'variante incompatible', estado: true
  });
  assert.equal(replayHistorico.resultados[0].resultado, 'divergente');
  actual = await estado.obtenerActual(ids.proyeccionId);
  assert.equal(actual.coherencia, 'coherente');
  assert.equal(actual.ultimaSecuenciaCoherente, '3');

  const ocurrencia4 = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
  ));
  await recibir(servicio, ids, {
    ruta: 0, posicion: '4', secuencia: '4', ocurrenciaId: ocurrencia4,
    nombre: 'segunda consolidada', estado: false
  });
  await completarSiguiente(materializacion, 'worker-14g-4');
  await recibir(servicio, ids, {
    ruta: 1, posicion: '4', secuencia: '4', ocurrenciaId: ocurrencia4,
    nombre: 'segunda incompatible', estado: true
  });
  [divergencia] = await sql.consultar(
    `SELECT * FROM divergencias_proyecciones_federacion
      WHERE proyeccion_id=? AND estado='abierta' ORDER BY id DESC LIMIT 1`,
    [ids.proyeccionId]
  );
  variantes = await sql.consultar(
    `SELECT * FROM variantes_divergencias_proyecciones_federacion
      WHERE divergencia_id=? ORDER BY id`,
    [divergencia.id]
  );
  const rutaConflictiva = variantes.find((fila) => fila.clase === 'conflictiva');
  const gestionDivergencias = new ServicioDivergenciasFederacion({
    repositorioDivergencias: divergencias,
    servicioAutorizacion: new ServicioAutorizacion()
  });
  const contextoOperador = {
    idUsuario: 5_221_405,
    tenantId: 10,
    empresaId: null,
    sitioId: null,
    impersonacionActiva: false,
    permisos: { resolverConflictosFederacion: true }
  };
  assert.throws(
    () => gestionDivergencias.excluirRuta({
      contextoUsuarioActual: {
        ...contextoOperador,
        permisos: { resolverConflictosFederacion: false }
      },
      divergenciaId: String(divergencia.id),
      varianteRutaId: String(rutaConflictiva.id),
      motivo: 'Intento sin autoridad.'
    }),
    (error) => error.codigo === 'FEDERACION_PERMISO_DENEGADO'
  );
  const exclusion = await gestionDivergencias.excluirRuta({
    contextoUsuarioActual: contextoOperador,
    divergenciaId: String(divergencia.id),
    varianteRutaId: String(rutaConflictiva.id),
    motivo: 'La ruta remitió una variante incompatible confirmada por el operador.'
  });
  assert.equal(exclusion.estado, 'pendienteResincronizacion');
  const [exclusionSql] = await sql.consultar(
    'SELECT * FROM exclusiones_rutas_divergentes_federacion WHERE divergencia_id=?',
    [divergencia.id]
  );
  assert.equal(exclusionSql.estado, 'pendienteResincronizacion');
  const [eventoAuditado] = await sql.consultar(
    'SELECT tipo_evento FROM eventos_auditoria WHERE evento_id=?',
    [exclusionSql.evento_auditoria_id]
  );
  assert.equal(eventoAuditado.tipo_evento, 'federacion.ruta_excluida');
  [divergencia] = await sql.consultar(
    'SELECT * FROM divergencias_proyecciones_federacion WHERE id=?',
    [divergencia.id]
  );
  assert.equal(divergencia.estado, 'esperandoResincronizacion');
  assert.equal(
    Number((await sql.consultar(
      'SELECT COUNT(*) AS total FROM variantes_divergencias_proyecciones_federacion WHERE divergencia_id=?',
      [divergencia.id]
    ))[0].total),
    variantes.length
  );

  const ocurrencia5 = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
  ));
  await recibir(servicio, ids, {
    ruta: 0, posicion: '5', secuencia: '5', ocurrenciaId: ocurrencia5,
    nombre: 'no sustituye una resincronización', estado: true
  });
  const bloqueada = await completarSiguiente(materializacion, 'worker-14g-5');
  assert.equal(bloqueada.estadoProyeccion.bloqueadaPorDivergencia, true);
  actual = await estado.obtenerActual(ids.proyeccionId);
  assert.equal(actual.coherencia, 'divergente');
  assert.equal(actual.ultimaSecuenciaCoherente, '3');

  const elementoSinFronteraId = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
  ));
  const ocurrenciaSinFronteraId = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
  ));
  await recibir(servicio, ids, {
    ruta: 0,
    posicion: '6',
    secuencia: '1',
    ocurrenciaId: ocurrenciaSinFronteraId,
    elementoOrigenId: elementoSinFronteraId,
    nombre: 'primera frontera ambigua',
    estado: true
  });
  await completarSiguiente(materializacion, 'worker-14g-6');
  assert.equal(
    (await estado.obtenerActual(proyeccionSinFronteraId)).ultimaSecuenciaCoherente,
    '1'
  );
  const primeraAmbigua = await recibir(servicio, ids, {
    ruta: 1,
    posicion: '5',
    secuencia: '1',
    ocurrenciaId: ocurrenciaSinFronteraId,
    elementoOrigenId: elementoSinFronteraId,
    nombre: 'primera frontera incompatible',
    estado: false
  });
  assert.equal(primeraAmbigua.resultados[0].resultado, 'divergente');
  assert.equal(await estado.obtenerActual(proyeccionSinFronteraId), null);
  const [sinFrontera] = await sql.consultar(
    `SELECT v.estado_publicacion,v.estado_coherencia,
            (SELECT COUNT(*)
               FROM campos_consolidados_proyecciones_federacion c
              WHERE c.proyeccion_id=v.proyeccion_id) AS campos_actuales,
            (SELECT ultima_version_publicacion
               FROM contadores_publicacion_proyecciones_federacion p
              WHERE p.proyeccion_id=v.proyeccion_id) AS version_publicacion
       FROM versiones_proyecciones_federacion v
      WHERE v.proyeccion_id=?`,
    [proyeccionSinFronteraId]
  );
  assert.deepEqual({
    publicacion: sinFrontera.estado_publicacion,
    coherencia: sinFrontera.estado_coherencia,
    campos: Number(sinFrontera.campos_actuales),
    version: String(sinFrontera.version_publicacion)
  }, {
    publicacion: 'preparando',
    coherencia: 'divergente',
    campos: 0,
    version: '2'
  });
}

async function verificarResolucionAtomicaDeMultiplesDivergencias({
  sql,
  divergencias,
  ids,
  divergenciaFuenteId,
  ocurrenciaPrimeraId,
  ocurrenciaConvergenteId
}) {
  const conexion = await sql.obtenerConexion();
  let divergenciaCompatibleId;
  let divergenciaBloqueanteId;
  try {
    await conexion.beginTransaction();
    const [inboxes] = await conexion.execute(
      `SELECT id,ocurrencia_origen_id FROM inbox_ocurrencias_federacion
        WHERE ocurrencia_origen_id IN (?,?) FOR UPDATE`,
      [ocurrenciaPrimeraId, ocurrenciaConvergenteId]
    );
    const inboxPorOcurrencia = new Map(inboxes.map((fila) => [
      fila.ocurrencia_origen_id,
      String(fila.id)
    ]));
    const inboxPrimeraId = inboxPorOcurrencia.get(ocurrenciaPrimeraId);
    const inboxConvergenteId = inboxPorOcurrencia.get(ocurrenciaConvergenteId);
    assert.ok(inboxPrimeraId && inboxConvergenteId);
    const [tiempos] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
    const ahora = tiempos[0].ahora;
    const [compatible] = await conexion.execute(
      `INSERT INTO divergencias_proyecciones_federacion (
         proyeccion_id,generacion_detectada_id,inbox_ocurrencia_id,
         secuencia_ambigua,estado,generacion_frontera_coherente_id,
         secuencia_frontera_coherente,estado_vigencia_frontera,
         veces_observada,aviso_id,primera_deteccion_utc,
         ultima_deteccion_utc,resuelta_en_utc
       ) VALUES (?, ?, ?,1,'abierta',NULL,NULL,NULL,1,NULL,?,?,NULL)`,
      [ids.proyeccionId, ids.generaciones[0], inboxPrimeraId, ahora, ahora]
    );
    divergenciaCompatibleId = String(compatible.insertId);
    const [bloqueante] = await conexion.execute(
      `INSERT INTO divergencias_proyecciones_federacion (
         proyeccion_id,generacion_detectada_id,inbox_ocurrencia_id,
         secuencia_ambigua,estado,generacion_frontera_coherente_id,
         secuencia_frontera_coherente,estado_vigencia_frontera,
         veces_observada,aviso_id,primera_deteccion_utc,
         ultima_deteccion_utc,resuelta_en_utc
       ) VALUES (?, ?, ?,2,'abierta',NULL,NULL,NULL,1,NULL,?,?,NULL)`,
      [ids.proyeccionId, ids.generaciones[0], inboxConvergenteId, ahora, ahora]
    );
    divergenciaBloqueanteId = String(bloqueante.insertId);
    await conexion.execute(
      `INSERT INTO variantes_divergencias_proyecciones_federacion (
         divergencia_id,clase,inbox_ocurrencia_id,conflicto_inbox_id,
         entrega_id,relacion_id,flujo_id,generacion_id,revision_concesion_id,
         recorrido_canonico,recorrido_sha256,payload_sha256,veces_observada,
         primera_observacion_utc,ultima_observacion_utc
       )
       SELECT ?,clase,inbox_ocurrencia_id,conflicto_inbox_id,
              entrega_id,relacion_id,flujo_id,generacion_id,revision_concesion_id,
              recorrido_canonico,recorrido_sha256,payload_sha256,veces_observada,
              primera_observacion_utc,ultima_observacion_utc
         FROM variantes_divergencias_proyecciones_federacion
        WHERE divergencia_id=?`,
      [divergenciaCompatibleId, divergenciaFuenteId]
    );
    await conexion.execute(
      `INSERT INTO variantes_divergencias_proyecciones_federacion (
         divergencia_id,clase,inbox_ocurrencia_id,conflicto_inbox_id,
         entrega_id,relacion_id,flujo_id,generacion_id,revision_concesion_id,
         recorrido_canonico,recorrido_sha256,payload_sha256,veces_observada,
         primera_observacion_utc,ultima_observacion_utc
       )
       SELECT ?,clase,inbox_ocurrencia_id,conflicto_inbox_id,
              entrega_id,relacion_id,flujo_id,generacion_id,revision_concesion_id,
              recorrido_canonico,recorrido_sha256,payload_sha256,veces_observada,
              primera_observacion_utc,ultima_observacion_utc
         FROM variantes_divergencias_proyecciones_federacion
        WHERE divergencia_id=? ORDER BY id LIMIT 1`,
      [divergenciaBloqueanteId, divergenciaFuenteId]
    );
    const resultado = await divergencias.autorizarContinuidadEnTransaccion({
      proyeccionId: ids.proyeccionId,
      generacionId: ids.generaciones[0],
      inboxId: inboxConvergenteId,
      secuenciaElemento: '3'
    }, { conexion });
    assert.equal(resultado.autorizada, false);
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
  const estados = await sql.consultar(
    `SELECT id,estado FROM divergencias_proyecciones_federacion
      WHERE id IN (?,?) ORDER BY id`,
    [divergenciaCompatibleId, divergenciaBloqueanteId]
  );
  assert.deepEqual(estados.map((fila) => fila.estado), ['abierta', 'abierta']);
  await sql.ejecutar(
    `UPDATE divergencias_proyecciones_federacion
        SET estado='resueltaEvidencia',resuelta_en_utc=UTC_TIMESTAMP(3)
      WHERE id IN (?,?)`,
    [divergenciaCompatibleId, divergenciaBloqueanteId]
  );
}

async function recibir(servicio, ids, {
  ruta,
  posicion,
  secuencia,
  ocurrenciaId,
  elementoOrigenId = ids.elementoOrigenId,
  nombre,
  estado
}) {
  return servicio.entregarLote({
    loteId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.LOTE)),
    relacionId: ids.relaciones[ruta],
    flujoId: ids.flujos[ruta],
    generacionId: ids.generaciones[ruta],
    revisionConcesionEfectiva: ids.revisiones[ruta],
    entregas: [{
      entregaId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
      posicionFlujo: posicion,
      ocurrencia: ocurrencia({ ...ids, elementoOrigenId }, {
        ocurrenciaOrigenId: ocurrenciaId,
        secuenciaElemento: secuencia
      }, {
        nombre: crearCampoPresenteFederado({ valor: nombre }),
        estado: crearCampoPresenteFederado({ valor: estado })
      }),
      procedencia: {
        installationEmisoraId: ids.emisores[ruta],
        bootEmisorId: ids.boots[ruta],
        recorridoInstalaciones: ruta === 0
          ? [ids.installationOrigenId]
          : [ids.installationOrigenId, ids.emisores[ruta]],
        tiemposSaltosDisponibles: [{
          installationId: ids.emisores[ruta],
          bootId: ids.boots[ruta],
          recibidoUtc: null,
          emitidoUtc: '2030-01-01T00:00:02.000Z'
        }]
      }
    }]
  });
}

async function completarSiguiente(materializacion, propietario) {
  const [trabajo] = await materializacion.reclamarPendientes({
    propietario,
    limite: 1,
    leaseMs: 30_000
  });
  assert.ok(trabajo, `No existe trabajo pendiente para ${propietario}.`);
  return materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario,
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
}

function requisitosCompletos() {
  const requisito = (id) => ({ id, estado: 'cumplido', causa: null });
  return {
    interpretable: [requisito('definicion')],
    observable: [requisito('estadoActual')],
    reconstruible: [requisito('configuracion')]
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
