import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ServicioRefederacionFederacion } from '../paquetes/federacion/aplicacion/ServicioRefederacionFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { ServicioCorteInicialGeneracionFederacion } from '../paquetes/federacion/aplicacion/ServicioCorteInicialGeneracionFederacion.js';
import { canonicalizarJsonFederacion } from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  await verificarEsquemaDurable();
  await verificarActualizacionYCiclo();
  await verificarRetiradaDurableSinSelector();
  await verificarRetiradaAbsorbidaPorCorte();
  console.log(
    '[federacion] OK 5.22.17h: identidad=origen recorrido=conservado ' +
    'ciclos=omitidos descendientes=durables retiradas=deuda_reintentable ' +
    'corte_absorbido=deuda_cerrada resurreccion=bloqueada'
  );
}

async function verificarRegistro() {
  const [runtime, web, procedencia] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioProcedenciaEmisionFederacionSql.js')
  ]);
  assert.match(runtime, /servicioRefederacionFederacion\.procesarPendientes/u);
  assert.match(web, /servicioRefederacion: servicioRefederacionFederacion/u);
  assert.match(procedencia, /descendiente_refederado_no_testimoniado/u);
}

async function verificarEsquemaDurable() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52217h_${randomBytes(6).toString('hex')}`;
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
    const dependenciasInbox = await sql.consultar(
      `SELECT COUNT(*) AS total
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE CONSTRAINT_SCHEMA=? AND REFERENCED_TABLE_NAME='inbox_ocurrencias_federacion'
          AND TABLE_NAME IN (
            'descendientes_refederacion_federacion',
            'obligaciones_retirada_refederacion_federacion'
          )`,
      [baseDatos]
    );
    assert.equal(Number(dependenciasInbox[0].total), 0);
    const columnas = await sql.consultar(
      `SELECT TABLE_NAME,COLUMN_NAME,IS_NULLABLE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=? AND (
          (TABLE_NAME='descendientes_refederacion_federacion'
           AND COLUMN_NAME='recibida_origen_en_utc')
          OR
          (TABLE_NAME='obligaciones_retirada_refederacion_federacion'
           AND COLUMN_NAME IN (
             'ocurrencia_terminal_canonica','procedencia_base_canonica',
             'recibida_origen_en_utc'
           ))
        )`,
      [baseDatos]
    );
    assert.equal(columnas.length, 4);
    assert.ok(columnas.every((fila) => fila.IS_NULLABLE === 'NO'));
    const [estadoObligacion] = await sql.consultar(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=?
          AND TABLE_NAME='obligaciones_retirada_refederacion_federacion'
          AND COLUMN_NAME='estado'`,
      [baseDatos]
    );
    assert.match(estadoObligacion.COLUMN_TYPE, /'absorbida'/u);
    await verificarSecuenciaRemotaReal(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarSecuenciaRemotaReal(sql) {
  const id = (tipo) => String(generador.generar(tipo));
  const ids = {
    local: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    remoto: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    destino: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    boot: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacion: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujo: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacion: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    elemento: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrencia: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  };
  await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,permiso_configurar_emisiones_federacion
     ) VALUES (5221708,'fixture-17h','fixture-17h@invalid.local','sin-login',1,1)`
  );
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,
       'fixture 17h',5221708,5221708,1,NULL,5221708,?,?,1)`,
    [ids.relacion, ids.destino, ids.destino, ahora, ahora]
  );
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.local
  });
  const ocurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: ids.local
  });
  const corte = new ServicioCorteInicialGeneracionFederacion({
    clienteSql: sql,
    repositorioFlujos: flujos,
    repositorioOcurrencias: ocurrencias,
    adaptadorCaptura: {
      async capturarEnTransaccion() { return { posiciones: [] }; }
    },
    fuenteFotografia: { async listarCapturasEnTransaccion() { return []; } }
  });
  await corte.preparar({
    flujo: {
      flujoId: ids.flujo,
      relacionId: ids.relacion,
      direccion: 'emision',
      familia: 'monitores',
      versionFamilia: 1,
      contexto: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null }
    },
    generacion: {
      generacionId: ids.generacion,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: { installationId: ids.local, bootId: ids.boot, version: 1 }
    }
  });
  await corte.cerrar({ flujoId: ids.flujo, generacionId: ids.generacion });
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const registrada = await ocurrencias.registrarOcurrenciaRefederadaEnTransaccion({
      ocurrencia: {
        protocoloVersion: 1,
        familia: 'monitores',
        familiaVersion: 1,
        installationOrigenId: ids.remoto,
        elementoOrigenId: ids.elemento,
        ocurrenciaOrigenId: ids.ocurrencia,
        secuenciaElemento: '73',
        operacion: 'retirada',
        tiempoOrigenUtc: '2026-08-08T11:00:00.000Z',
        scopeOrigenDeclarado: {
          nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
        },
        vigenciaRestanteMs: null,
        campos: {},
        evidenciaIntegridad: []
      },
      destinos: [{
        flujoId: ids.flujo,
        generacionId: ids.generacion,
        prioridad: 'operativaActual',
        clasePosicion: 'cambioPosterior'
      }]
    }, { conexion });
    assert.equal(registrada.ocurrencia.toJSON().secuenciaElemento, '73');
    assert.equal(registrada.posiciones[0].posicionFlujo, '1');
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
  const contadores = await sql.consultar(
    `SELECT COUNT(*) AS total FROM contadores_secuencia_elementos_federacion
      WHERE installation_origen_id=? AND familia='monitores'
        AND elemento_origen_id=?`,
    [ids.remoto, ids.elemento]
  );
  assert.equal(Number(contadores[0].total), 0);
}

async function verificarActualizacionYCiclo() {
  const capturas = [];
  const encoladas = [];
  const inserts = [];
  const conexion = conexionFalsa(async (sql) => {
    if (sql.includes('SELECT recibida_en_utc FROM inbox_ocurrencias_federacion')) {
      return [[{ recibida_en_utc: new Date('2026-08-08T11:01:00.000Z') }]];
    }
    if (sql.includes('EXISTS(SELECT 1 FROM retiradas_origen')) {
      return [[{ retirada: 0, salida: 0 }]];
    }
    if (sql.includes('FROM proyecciones_federacion p')) {
      return [[
        destino('flujo-c', 'generacion-c', 'instalacion-c'),
        destino('flujo-a', 'generacion-a', 'instalacion-a')
      ]];
    }
    if (sql.includes('INSERT INTO descendientes_refederacion_federacion')) {
      inserts.push(sql);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`SQL inesperado en actualización: ${sql}`);
  });
  const servicio = servicioFalso({ capturas, encoladas });
  const resultado = await servicio.registrarDesdeRecepcionEnTransaccion({
    lote: { relacionId: 'relacion-entrada' },
    entrega: {
      ocurrencia: ocurrencia('actualizacion'),
      procedencia: procedencia(['instalacion-a'])
    },
    inboxId: '41',
    proyeccionId: 'proyeccion-1',
    contribucionId: 'contribucion-1'
  }, { conexion });
  assert.equal(resultado.totalDescendientes, 1);
  assert.equal(resultado.totalCiclosEvitados, 1);
  assert.deepEqual(capturas[0].destinos.map((item) => item.flujoId), ['flujo-c']);
  assert.equal(capturas[0].ocurrencia.secuenciaElemento, '73');
  assert.equal(inserts.length, 1);
  assert.equal(encoladas.length, 1);
}

async function verificarRetiradaDurableSinSelector() {
  const capturas = [];
  const encoladas = [];
  const mutaciones = [];
  const conexion = conexionFalsa(async (sql) => {
    if (sql.includes('SELECT recibida_en_utc FROM inbox_ocurrencias_federacion')) {
      return [[{ recibida_en_utc: new Date('2026-08-08T11:01:00.000Z') }]];
    }
    if (sql.includes('SELECT DISTINCT d.flujo_destino_id')) {
      return [[
        { flujo_destino_id: 'flujo-c', installation_destino_id: 'instalacion-c' },
        { flujo_destino_id: 'flujo-a', installation_destino_id: 'instalacion-a' }
      ]];
    }
    if (sql.includes('INSERT INTO obligaciones_retirada_refederacion_federacion')) {
      mutaciones.push('deuda');
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM obligaciones_retirada_refederacion_federacion')) {
      const terminal = ocurrencia('retirada');
      const origen = procedencia(['instalacion-a']);
      return [[{
        id: 9,
        proyeccion_origen_id: 'proyeccion-1',
        contribucion_origen_id: 'contribucion-1',
        inbox_terminal_id: 42,
        flujo_destino_id: 'flujo-c',
        ocurrencia_terminal_canonica: terminal,
        ocurrencia_terminal_sha256: huella(terminal),
        procedencia_base_canonica: origen,
        procedencia_base_sha256: huella(origen),
        recibida_origen_en_utc: new Date('2026-08-08T11:01:00.000Z')
      }]];
    }
    if (sql.includes('FROM flujos_federacion f')) {
      return [[destino('flujo-c', 'generacion-nueva-c', 'instalacion-c')]];
    }
    if (sql.includes('INSERT INTO descendientes_refederacion_federacion')) {
      mutaciones.push('descendiente-terminal');
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("SET estado='encolada'")) {
      mutaciones.push('encolada');
      return [{ affectedRows: 1 }];
    }
    throw new Error(`SQL inesperado en retirada: ${sql}`);
  });
  const servicio = servicioFalso({ capturas, encoladas });
  const resultado = await servicio.registrarDesdeRecepcionEnTransaccion({
    lote: { relacionId: 'relacion-entrada' },
    entrega: {
      ocurrencia: ocurrencia('retirada'),
      procedencia: procedencia(['instalacion-a'])
    },
    inboxId: '42',
    proyeccionId: 'proyeccion-1',
    contribucionId: 'contribucion-1'
  }, { conexion });
  assert.equal(resultado.totalEncoladas, 1);
  assert.deepEqual(mutaciones, ['deuda', 'descendiente-terminal', 'encolada']);
  assert.equal(capturas[0].ocurrencia.operacion, 'retirada');
  assert.equal(capturas[0].destinos[0].generacionId, 'generacion-nueva-c');
  assert.equal(encoladas[0][0].prioridad, 'operativaActual');
}

async function verificarRetiradaAbsorbidaPorCorte() {
  const encoladas = [];
  const mutaciones = [];
  const terminal = ocurrencia('retirada');
  const origen = procedencia(['instalacion-a']);
  const conexion = conexionFalsa(async (sql) => {
    if (sql.includes('FROM obligaciones_retirada_refederacion_federacion')) {
      return [[{
        id: 10,
        proyeccion_origen_id: 'proyeccion-1',
        contribucion_origen_id: 'contribucion-1',
        inbox_terminal_id: 43,
        flujo_destino_id: 'flujo-c',
        ocurrencia_terminal_canonica: terminal,
        ocurrencia_terminal_sha256: huella(terminal),
        procedencia_base_canonica: origen,
        procedencia_base_sha256: huella(origen),
        recibida_origen_en_utc: new Date('2026-08-08T11:01:00.000Z')
      }]];
    }
    if (sql.includes('FROM flujos_federacion f')) {
      return [[destino('flujo-c', 'generacion-c', 'instalacion-c')]];
    }
    if (sql.includes("SET estado='absorbida'")) {
      mutaciones.push('absorbida');
      return [{ affectedRows: 1 }];
    }
    throw new Error(`SQL inesperado en absorción terminal: ${sql}`);
  });
  const servicio = new ServicioRefederacionFederacion({
    repositorioOcurrencias: {
      clienteSql: { async obtenerConexion() { throw new Error('No usado.'); } },
      async registrarOcurrenciaRefederadaEnTransaccion(entrada) {
        return {
          estado: 'yaConocida',
          posiciones: entrada.destinos.map((item) => ({
            ...item,
            posicionFlujo: null,
            estado: 'absorbidaCorte'
          }))
        };
      }
    },
    repositorioOutbox: {
      async encolarPosicionesEnTransaccion(posiciones) {
        encoladas.push(posiciones);
      }
    }
  });
  const resultado = await servicio.procesarPendientesEnTransaccion(
    { limite: 100 },
    { conexion }
  );
  assert.equal(resultado.totalEncoladas, 0);
  assert.equal(resultado.totalAbsorbidas, 1);
  assert.deepEqual(mutaciones, ['absorbida']);
  assert.equal(encoladas.length, 0);
}

function servicioFalso({ capturas, encoladas }) {
  return new ServicioRefederacionFederacion({
    repositorioOcurrencias: {
      clienteSql: { async obtenerConexion() { throw new Error('No usado por el fixture.'); } },
      async registrarOcurrenciaRefederadaEnTransaccion(entrada) {
        capturas.push(entrada);
        return {
          estado: 'creada',
          posiciones: entrada.destinos.map((destino, indice) => ({
            ...destino,
            posicionFlujo: String(indice + 1),
            estado: 'asignada'
          }))
        };
      }
    },
    repositorioOutbox: {
      async encolarPosicionesEnTransaccion(posiciones) {
        encoladas.push(posiciones);
        return posiciones;
      }
    }
  });
}

function conexionFalsa(resolver) {
  return {
    async execute(sql, parametros) {
      return resolver(sql, parametros);
    },
    async query(sql) {
      if (sql.includes('UTC_TIMESTAMP')) return [[{ ahora: new Date('2026-08-08T12:00:00.000Z') }]];
      return resolver(sql, []);
    }
  };
}

function destino(flujoId, generacionId, installationDestinoId) {
  return {
    flujo_id: flujoId,
    generacion_activa_id: generacionId,
    relacion_id: `relacion-${flujoId}`,
    installation_remota_id: installationDestinoId
  };
}

function ocurrencia(operacion) {
  return {
    protocoloVersion: 1,
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: 'instalacion-a',
    elementoOrigenId: 'elemento-1',
    ocurrenciaOrigenId: operacion === 'actualizacion' ? 'ocurrencia-1' : 'ocurrencia-2',
    secuenciaElemento: operacion === 'actualizacion' ? '73' : '74',
    operacion,
    tiempoOrigenUtc: '2026-08-08T11:00:00.000Z',
    scopeOrigenDeclarado: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null },
    vigenciaRestanteMs: operacion === 'actualizacion' ? null : null,
    campos: operacion === 'actualizacion' ? { monitores: { estado: 'presente' } } : {},
    evidenciaIntegridad: []
  };
}

function procedencia(recorridoInstalaciones) {
  return {
    installationEmisoraId: recorridoInstalaciones.at(-1),
    bootEmisorId: 'arranque-a',
    recorridoInstalaciones,
    tiemposSaltosDisponibles: []
  };
}

function huella(valor) {
  return createHash('sha256')
    .update(canonicalizarJsonFederacion(valor), 'utf8')
    .digest();
}

async function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
