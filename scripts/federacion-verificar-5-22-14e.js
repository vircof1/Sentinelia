import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { ProtectorContenidoSensibleFederacion } from '../paquetes/federacion/adaptadores/ProtectorContenidoSensibleFederacion.js';
import { RepositorioContribucionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioContribucionesFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioSoporteCamposFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSoporteCamposFederacionSql.js';
import { canonicalizarJsonFederacion } from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import {
  crearCampoOmitidoFederado,
  crearCampoPresenteFederado
} from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { separarContenidoSensibleFederacion } from '../paquetes/federacion/src/SeparacionContenidoSensibleFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO_FIXTURE = 5_221_405;
const SECRETO = 'secreto-14e-no-debe-aparecer-en-sql';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52214e_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarVistasComplementarias(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.14e: vistas=complementarias_y_disjuntas inbox=autonoma ' +
    'campos=autorizados soporte=blindado_sql ' +
    'omitido=sin_cambio null=vaciado sensible=cifrado ultimo_soporte=retira_funcional'
  );
}

async function verificarRegistro() {
  const [repositorio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioSoporteCamposFederacionSql.js')
  ]);
  assert.match(repositorio, /contribucionAmpliada/u);
  assert.match(repositorio, /retirarContribucionEnTransaccion/u);
}

async function verificarVistasComplementarias(sql) {
  const ids = crearIds();
  const protector = crearProtector();
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  for (let indice = 0; indice < 2; indice += 1) {
    await crearRelacion(sql, ids, indice);
    await crearRevision(sql, ids, indice, indice === 0
      ? ['nombre', 'estado']
      : ['estado', 'contexto', 'secreto']);
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
  const idsContribuciones = [...ids.contribucionesGeneradas];
  const soporte = new RepositorioSoporteCamposFederacionSql(sql, {
    protectorContenidoSensible: protector
  });
  const materializacion = new RepositorioMaterializacionFederacionSql(sql, {
    generarProyeccionId: () => ids.proyeccionId,
    repositorioContribuciones: new RepositorioContribucionesFederacionSql(sql, {
      generarContribucionId: () => idsContribuciones.shift() || String(
        generador.generar(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION)
      )
    }),
    repositorioSoporteCampos: soporte
  });
  const inbox = new RepositorioInboxFederacionSql(sql, {
    protectorContenidoSensible: protector
  });

  const elementoInboxAutonoma = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
  ));
  const metadatosInboxAutonoma = {
    ocurrenciaOrigenId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuenciaElemento: '1'
  };
  const vistaInboxAutonoma = ocurrencia(
    { ...ids, elementoOrigenId: elementoInboxAutonoma },
    metadatosInboxAutonoma,
    { nombre: crearCampoPresenteFederado({ valor: 'valor estable' }) }
  );
  assert.equal((await inbox.recibir(vistaInboxAutonoma)).codigo, 'aceptada');
  const conflictoInboxAutonoma = await inbox.recibir(ocurrencia(
    { ...ids, elementoOrigenId: elementoInboxAutonoma },
    metadatosInboxAutonoma,
    { nombre: crearCampoPresenteFederado({ valor: 'valor reinterpretado' }) }
  ));
  assert.equal(conflictoInboxAutonoma.codigo, 'divergenciaContenido');
  assert.equal(conflictoInboxAutonoma.confirmada, false);

  const elementoInboxDisjunta = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
  ));
  const metadatosInboxDisjunta = {
    ocurrenciaOrigenId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuenciaElemento: '1'
  };
  assert.equal((await inbox.recibir(ocurrencia(
    { ...ids, elementoOrigenId: elementoInboxDisjunta },
    metadatosInboxDisjunta,
    { nombre: crearCampoPresenteFederado({ valor: 'vista uno' }) }
  ))).codigo, 'aceptada');
  assert.equal((await inbox.recibir(ocurrencia(
    { ...ids, elementoOrigenId: elementoInboxDisjunta },
    metadatosInboxDisjunta,
    { contexto: crearCampoPresenteFederado({ valor: 'vista dos' }) }
  ))).codigo, 'yaConocida');

  const metadatos1 = {
    ocurrenciaOrigenId: ids.ocurrencias[0], secuenciaElemento: '1'
  };
  const vista1 = ocurrencia(ids, metadatos1, {
    nombre: crearCampoPresenteFederado({ valor: 'Monitor remoto' }),
    estado: crearCampoPresenteFederado({ valor: true }),
    contexto: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    secreto: crearCampoOmitidoFederado({ causa: 'noAutorizado' }),
    intruso: crearCampoPresenteFederado({ valor: 'recibido pero no concedido' })
  });
  const vista2 = ocurrencia(ids, metadatos1, {
    nombre: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    estado: crearCampoPresenteFederado({ valor: true }),
    contexto: crearCampoPresenteFederado({ valor: 'Contexto humano' }),
    secreto: crearCampoPresenteFederado({ valor: SECRETO, sensibilidad: 'sensible' }),
    intruso: crearCampoOmitidoFederado({ causa: 'noAutorizado' })
  });
  const primera = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 0,
    entregaId: ids.entregas[0], posicion: '1', ocurrencia: vista1
  });
  const segunda = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 1,
    entregaId: ids.entregas[1], posicion: '1', ocurrencia: vista2
  });
  assert.equal(primera.inbox.codigo, 'aceptada');
  assert.equal(segunda.inbox.codigo, 'yaConocida');
  assert.equal(segunda.trabajo.aplicacionNueva, false);
  assert.equal(segunda.trabajo.soporteCampos.contribucionAmpliada, true);
  assert.equal(segunda.trabajo.soporteCampos.aportados, 3);

  let consolidados = await leerConsolidados(sql, ids.proyeccionId);
  assert.deepEqual(consolidados.map((campo) => campo.nombre), [
    'contexto', 'estado', 'nombre', 'secreto'
  ]);
  assert.equal(consolidados.find((campo) => campo.nombre === 'estado').soportes, 2);
  assert.equal(consolidados.some((campo) => campo.nombre === 'intruso'), false);
  const [textoSensible] = await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM declaraciones_campos_inbox_federacion
      WHERE declaracion_publica_canonica LIKE ?`,
    [`%${SECRETO}%`]
  );
  assert.equal(Number(textoSensible.total), 0);
  const [sinContenidoNoAutorizado] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM entregas_recepcion_federacion
         WHERE ocurrencia_canonica LIKE '%recibido pero no concedido%')
           AS intruso_durable,
       (SELECT COUNT(*) FROM entregas_recepcion_federacion
         WHERE ocurrencia_canonica LIKE ?) AS secreto_durable`,
    [`%${SECRETO}%`]
  );
  assert.equal(Number(sinContenidoNoAutorizado.intruso_durable), 0);
  assert.equal(Number(sinContenidoNoAutorizado.secreto_durable), 0);
  const divergente = await inbox.recibir(ocurrencia(ids, metadatos1, {
    nombre: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    estado: crearCampoPresenteFederado({ valor: false }),
    contexto: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    secreto: crearCampoOmitidoFederado({ causa: 'noAutorizado' })
  }));
  assert.equal(divergente.codigo, 'divergenciaContenido');
  assert.equal(divergente.confirmada, false);

  const metadatosDisjuntos = {
    ocurrenciaOrigenId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuenciaElemento: '3'
  };
  const vistaDisjuntaNombre = ocurrencia(ids, metadatosDisjuntos, {
    nombre: crearCampoPresenteFederado({ valor: 'Nombre sin solapamiento' }),
    estado: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    contexto: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    secreto: crearCampoOmitidoFederado({ causa: 'noAutorizado' })
  });
  const vistaDisjuntaContexto = ocurrencia(ids, metadatosDisjuntos, {
    nombre: crearCampoOmitidoFederado({ causa: 'noAutorizado' }),
    estado: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    contexto: crearCampoPresenteFederado({ valor: 'Contexto sin solapamiento' }),
    secreto: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' })
  });
  const entregaDisjuntaA = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  const entregaDisjuntaB = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  const disjuntaA = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 0,
    entregaId: entregaDisjuntaA, posicion: '2', ocurrencia: vistaDisjuntaNombre
  });
  const disjuntaB = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 1,
    entregaId: entregaDisjuntaB, posicion: '2', ocurrencia: vistaDisjuntaContexto
  });
  assert.deepEqual(
    [disjuntaA.inbox.codigo, disjuntaB.inbox.codigo],
    ['aceptada', 'yaConocida']
  );
  assert.equal(disjuntaB.trabajo.aplicacionNueva, false);
  const conflictoDisjunto = await inbox.recibir(ocurrencia(ids, metadatosDisjuntos, {
    nombre: crearCampoPresenteFederado({ valor: 'Nombre incompatible' }),
    estado: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    contexto: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    secreto: crearCampoOmitidoFederado({ causa: 'noAutorizado' })
  }));
  assert.equal(conflictoDisjunto.codigo, 'divergenciaContenido');

  const metadatos2 = {
    ocurrenciaOrigenId: ids.ocurrencias[1], secuenciaElemento: '4'
  };
  const actualizacion1 = ocurrencia(ids, metadatos2, {
    nombre: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    estado: crearCampoPresenteFederado({ valor: false }),
    contexto: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    secreto: crearCampoOmitidoFederado({ causa: 'noAutorizado' })
  });
  const actualizacion2 = ocurrencia(ids, metadatos2, {
    nombre: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' }),
    estado: crearCampoPresenteFederado({ valor: false }),
    contexto: crearCampoPresenteFederado({ valor: null }),
    secreto: crearCampoOmitidoFederado({ causa: 'omitidoPorSeleccion' })
  });
  await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 0,
    entregaId: ids.entregas[2], posicion: '3', ocurrencia: actualizacion1
  });
  await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 1,
    entregaId: ids.entregas[3], posicion: '3', ocurrencia: actualizacion2
  });
  consolidados = await leerConsolidados(sql, ids.proyeccionId);
  assert.equal(
    await valorCampo(sql, consolidados, 'nombre', protector),
    'Nombre sin solapamiento'
  );
  assert.equal(await valorCampo(sql, consolidados, 'estado', protector), false);
  assert.equal(await valorCampo(sql, consolidados, 'contexto', protector), null);
  assert.equal(await valorCampo(sql, consolidados, 'secreto', protector), SECRETO);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE soportes_campos_contribuciones_federacion
          SET estado='retirado'
        WHERE contribucion_id=? AND estado='activo' LIMIT 1`,
      [ids.contribucionesReales[0]]
    ),
    (error) => error.sqlState === '45000'
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO soportes_campos_contribuciones_federacion (
         contribucion_id,generacion_id,nombre_sha256,nombre_campo,estado,
         declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
         primera_aportacion_utc,ultima_actualizacion_utc
       )
       SELECT ?,?,UNHEX(SHA2('campo-sin-aporte',256)),'campo-sin-aporte','activo',
              id,inbox_ocurrencia_id,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)
         FROM declaraciones_campos_inbox_federacion ORDER BY id LIMIT 1`,
      [ids.contribucionesReales[0], ids.generaciones[1]]
    ),
    (error) => error.sqlState === '45000'
  );

  const retiradaPrimera = await soporte.retirarContribucion({
    contribucionId: ids.contribucionesReales[0],
    causa: 'concesionReducida'
  });
  assert.equal(retiradaPrimera.camposFuncionalesRetirados, 1);
  consolidados = await leerConsolidados(sql, ids.proyeccionId);
  assert.deepEqual(consolidados.map((campo) => campo.nombre), [
    'contexto', 'estado', 'secreto'
  ]);
  assert.equal(consolidados.find((campo) => campo.nombre === 'estado').soportes, 1);

  const retiradaSegunda = await soporte.retirarContribucion({
    contribucionId: ids.contribucionesReales[1],
    causa: 'relacionDeshabilitada'
  });
  assert.equal(retiradaSegunda.camposFuncionalesRetirados, 3);
  assert.deepEqual(await leerConsolidados(sql, ids.proyeccionId), []);
  const repetida = await soporte.retirarContribucion({
    contribucionId: ids.contribucionesReales[1],
    causa: 'relacionDeshabilitada'
  });
  assert.equal(repetida.yaRetirada, true);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE soportes_campos_contribuciones_federacion
          SET estado='activo',secuencia_elemento=secuencia_elemento+1,
              ultima_actualizacion_utc=UTC_TIMESTAMP(3)
        WHERE contribucion_id=? LIMIT 1`,
      [ids.contribucionesReales[1]]
    ),
    (error) => error.sqlState === '45000'
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO soportes_campos_contribuciones_federacion (
         contribucion_id,generacion_id,nombre_sha256,nombre_campo,estado,
         declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
         primera_aportacion_utc,ultima_actualizacion_utc
       )
       SELECT contribucion_id,generacion_id,
              UNHEX(SHA2('soporte-resucitado',256)),'soporte-resucitado','activo',
              declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento+1,
              UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)
         FROM soportes_campos_contribuciones_federacion
        WHERE contribucion_id=? ORDER BY nombre_campo LIMIT 1`,
      [ids.contribucionesReales[1]]
    ),
    (error) => error.sqlState === '45000'
  );

  const [evidencia] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM declaraciones_campos_inbox_federacion) AS declaraciones,
       (SELECT COUNT(*) FROM soportes_campos_contribuciones_federacion) AS soportes,
       (SELECT COUNT(*) FROM eventos_soporte_campos_federacion) AS eventos`
  );
  assert.ok(Number(evidencia.declaraciones) >= 6);
  assert.ok(Number(evidencia.soportes) >= 5);
  assert.ok(Number(evidencia.eventos) >= 10);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE eventos_soporte_campos_federacion SET causa='alterada' WHERE id=1`
    ),
    (error) => error.sqlState === '45000'
  );
  const metadatosRechazo = {
    ocurrenciaOrigenId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuenciaElemento: '4'
  };
  await assert.rejects(
    recibir({
      sql, inbox, materializacion, soporte, ids, ruta: 0,
      entregaId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
      posicion: '4',
      ocurrencia: {
        ...ocurrencia(ids, metadatosRechazo, {
          nombre: crearCampoPresenteFederado({ valor: 'fuera de scope' })
        }),
        scopeOrigenDeclarado: {
          nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
        }
      }
    }),
    (error) => error.codigo === 'ocurrencia_fuera_selector_efectivo'
  );
  await sql.ejecutar(
    `UPDATE revisiones_concesion_federacion
        SET estado='reducida',finalizada_en_utc=UTC_TIMESTAMP(3)
      WHERE revision_id=?`,
    [ids.revisiones[0]]
  );
  await assert.rejects(
    recibir({
      sql, inbox, materializacion, soporte, ids, ruta: 0,
      entregaId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
      posicion: '4',
      ocurrencia: ocurrencia(ids, metadatosRechazo, {
        nombre: crearCampoPresenteFederado({ valor: 'revision antigua' })
      })
    }),
    (error) => error.codigo === 'selector_revision_efectiva_desconocido'
  );
}

async function recibir({
  sql, inbox, materializacion, soporte, ids, ruta, entregaId, posicion,
  ocurrencia: vista
}) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const lote = await soporte.sanearLoteEnTransaccion({
      relacionId: ids.relaciones[ruta],
      flujoId: ids.flujos[ruta],
      generacionId: ids.generaciones[ruta],
      revisionConcesionEfectiva: ids.revisiones[ruta],
      entregas: [{ entregaId, posicionFlujo: posicion, ocurrencia: vista }]
    }, { conexion });
    const vistaPersistible = lote.entregas[0].ocurrencia;
    const resultadoInbox = await inbox.recibirEnTransaccion(
      vistaPersistible,
      { conexion }
    );
    const canonico = canonicalizarJsonFederacion(
      separarContenidoSensibleFederacion(vistaPersistible).publico
    );
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO entregas_recepcion_federacion (
         entrega_id,relacion_id,flujo_id,generacion_id,posicion_flujo,
         ocurrencia_canonica,ocurrencia_sha256,creada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        entregaId, ids.relaciones[ruta], ids.flujos[ruta], ids.generaciones[ruta],
        posicion, canonico, createHash('sha256').update(canonico).digest(), ahora
      ]
    );
    const trabajo = await materializacion.registrarTrabajoEnTransaccion({
      lote: {
        relacionId: ids.relaciones[ruta],
        flujoId: ids.flujos[ruta],
        generacionId: ids.generaciones[ruta],
        revisionConcesionEfectiva: ids.revisiones[ruta]
      },
      entrega: {
        entregaId, posicionFlujo: posicion, ocurrencia: vistaPersistible,
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
      },
      inboxId: resultadoInbox.inboxId
    }, { conexion });
    await conexion.commit();
    return { inbox: resultadoInbox, trabajo };
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

function ocurrencia(ids, { ocurrenciaOrigenId, secuenciaElemento }, campos) {
  return {
    familia: 'monitores', familiaVersion: 1,
    installationOrigenId: ids.installationOrigenId,
    elementoOrigenId: ids.elementoOrigenId,
    ocurrenciaOrigenId, secuenciaElemento,
    operacion: 'actualizacion', tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null
    },
    vigenciaRestanteMs: '300000', campos, evidenciaIntegridad: []
  };
}

async function leerConsolidados(sql, proyeccionId) {
  const filas = await sql.consultar(
    `SELECT c.nombre_campo,c.total_soportes_activos,c.declaracion_campo_id
       FROM campos_consolidados_proyecciones_federacion c
      WHERE c.proyeccion_id=? ORDER BY c.nombre_campo`,
    [proyeccionId]
  );
  return filas.map((fila) => ({
    nombre: fila.nombre_campo,
    soportes: Number(fila.total_soportes_activos),
    declaracionId: String(fila.declaracion_campo_id)
  }));
}

async function valorCampo(sql, consolidados, nombre, protector) {
  const campo = consolidados.find((entrada) => entrada.nombre === nombre);
  assert.ok(campo, `Falta el campo consolidado ${nombre}.`);
  const [fila] = await sql.consultar(
    `SELECT * FROM declaraciones_campos_inbox_federacion WHERE id=?`,
    [campo.declaracionId]
  );
  if (fila.sensibilidad !== 'sensible') {
    return deserializarJson(fila.declaracion_publica_canonica).valor;
  }
  return protector.descifrar({
    sobre: {
      perfil: fila.perfil_custodia,
      keyringReferencia: fila.keyring_referencia,
      keyId: fila.key_id,
      nonce: fila.nonce,
      ciphertext: fila.ciphertext,
      authTag: fila.auth_tag
    },
    aad: {
      perfil: 'sentinelia-federacion-campo-inbox-v1',
      inboxId: String(fila.inbox_ocurrencia_id),
      nombre
    }
  }).valor;
}

function crearProtector() {
  const clave = randomBytes(32);
  const keyring = {
    referencia: 'fixture-14e',
    obtenerClaveActiva: () => ({ keyId: '1', clave: Buffer.from(clave) }),
    obtenerClavePorId: (keyId) => keyId === '1' ? Buffer.from(clave) : null
  };
  return new ProtectorContenidoSensibleFederacion({ keyring });
}

async function crearRelacion(sql, ids, indice) {
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
    [
      ids.relaciones[indice], ids.emisores[indice], ids.emisores[indice],
      `ruta 14e ${indice + 1}`, USUARIO_FIXTURE, USUARIO_FIXTURE,
      USUARIO_FIXTURE, ahora, ahora
    ]
  );
}

async function crearRevision(sql, ids, indice, campos) {
  const seleccion = JSON.stringify({
    activa: true,
    nivelesScope: ['empresa'],
    familias: {
      monitores: {
        campos,
        permiteContenidoSensible: indice === 1,
        permiteRefederacion: false
      }
    }
  });
  const huella = createHash('sha256').update(seleccion).digest();
  const ahora = new Date();
  for (const [revisionId, papel] of [
    [ids.ofertas[indice], 'oferta'],
    [ids.aceptaciones[indice], 'aceptacion'],
    [ids.revisiones[indice], 'efectiva']
  ]) {
    await sql.ejecutar(
      `INSERT INTO revisiones_concesion_federacion (
         revision_id,relacion_id,papel,ordinal,estado,revision_oferta_id,
         revision_aceptacion_id,seleccion,huella_seleccion,
         autorizada_por_usuario_id,version_autoridad,version_autoridad_remota,
         procedencia,creada_en_utc,
         vigente_desde_utc,finalizada_en_utc,evento_auditoria_id,correlacion_id
       ) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,NULL,?,?)`,
      [
        revisionId, ids.relaciones[indice], papel, 1, 'vigente',
        papel === 'efectiva' ? ids.ofertas[indice] : null,
        papel === 'efectiva' ? ids.aceptaciones[indice] : null,
        seleccion, huella, USUARIO_FIXTURE,
        papel === 'efectiva' ? '1' : null,
        papel === 'efectiva' ? 'derivada' : 'local', ahora, ahora,
        randomBytes(16), randomBytes(16)
      ]
    );
  }
  await sql.ejecutar(
    `INSERT INTO selectores_revision_concesion_federacion (
       revision_id,familia,niveles_scope,campos,
       permite_contenido_sensible,permite_refederacion
     ) VALUES (?,'monitores',?,?,?,FALSE)`,
    [ids.revisiones[indice], JSON.stringify(['empresa']), JSON.stringify(campos), indice === 1]
  );
  await sql.ejecutar(
    `INSERT INTO estado_concesion_relaciones_federacion (
       relacion_id,revision_oferta_actual_id,revision_aceptacion_actual_id,
       revision_efectiva_actual_id,revision,actualizada_en_utc
     ) VALUES (?,?,?,?,1,UTC_TIMESTAMP(3))`,
    [
      ids.relaciones[indice], ids.ofertas[indice],
      ids.aceptaciones[indice], ids.revisiones[indice]
    ]
  );
}

function crearIds() {
  const id = (tipo) => String(generador.generar(tipo));
  const installationOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const contribucionesReales = [
    id(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION),
    id(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION)
  ];
  return Object.freeze({
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationOrigenId,
    emisores: [installationOrigenId, id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)],
    boots: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)),
    relaciones: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    ofertas: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)),
    aceptaciones: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)),
    revisiones: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)),
    flujos: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.FLUJO)),
    generaciones: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    entregas: Array.from({ length: 4 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrencias: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)),
    proyeccionId: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION),
    contribucionesReales,
    contribucionesGeneradas: [
      contribucionesReales[0], contribucionesReales[1],
      id(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION),
      id(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION)
    ]
  });
}

async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

function deserializarJson(valor) {
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

export {
  crearIds,
  crearProtector,
  crearRelacion,
  crearRevision,
  migrar,
  ocurrencia
};
