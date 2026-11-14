import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  crearDefinicionAdaptadorTelemetriaFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  GeneradorIdentidadesFederadas,
  RegistroAdaptadoresFamiliasFederacion,
  TIPOS_IDENTIDAD_FEDERADA,
  TIPOS_REGISTRO_TELEMETRIA_FEDERACION,
  validarPayloadTelemetriaFederacion
} from '../paquetes/federacion/src/index.js';
import { resolverDisposicionFisicaScopeOrganizativo } from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const FECHA = '2031-04-05T06:07:08.901Z';

await main();

async function main() {
  const ejemplos = verificarContratoTipado();
  await verificarRegistroEstatico();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215e_${randomBytes(6).toString('hex')}`;
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
    await verificarEsquema(sql, ejemplos);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15e: contrato=8_registros_tipados ' +
    'fotografias=senal_y_pol_independientes historico=huecos_explicitos ' +
    'derivacion=informativa identidades=protegidas tablas=remotas_no_productivo'
  );
}

function verificarContratoTipado() {
  const ids = crearIds();
  const observacion = cuerpoObservacion(ids);
  const ejemplos = [
    base('fuente', {
      agenteContextoOrigenId: ids.contextoAgente,
      guid: '123e4567-e89b-12d3-a456-426614174000',
      nombre: 'Agente de planta',
      scopeOrganizativo: {
        tenantElementoOrigenId: ids.tenant,
        empresaElementoOrigenId: ids.empresa,
        sitioElementoOrigenId: ids.sitio
      }
    }),
    base('senal', {
      fuenteOrigenId: ids.fuente,
      categoria: 'sistema', clave: 'cpu', tag: 'total', codigoSenal: 'sistema.cpu.total',
      tipoDato: 'numero', unidad: 'porcentaje', nombreHumano: 'CPU', descripcion: '',
      metadatosDescriptivos: { escala: 100 }, consolidadaEnUtc: FECHA,
      ultimaDeclaracionUtc: FECHA
    }),
    base('observacion', observacion),
    base('fotografiaSenal', {
      senalOrigenId: ids.senal,
      observacionOrigenId: ids.observacion,
      secuenciaSenal: '42',
      observacion
    }),
    base('fotografiaPol', {
      fuenteOrigenId: ids.fuente,
      periodoPolOrigenId: ids.periodo,
      estado: 'abierto', bootId: 'boot-2031-a', inicioUtc: FECHA,
      finUtc: null, ultimoHeartbeatUtc: FECHA, ultimoSeq: '42', motivoCierre: null
    }),
    base('reglaDerivacion', {
      fuenteOrigenId: ids.fuente,
      senalOrigenId: ids.senal,
      estado: 'activa',
      revisionVigenteOrigenId: ids.revision,
      revisiones: [{
        revisionOrigenId: ids.revision,
        numero: '1', condicionTipo: 'numero', condicionVersion: '1',
        condicion: { operador: 'mayorQue', valor: 90 },
        severidadCalculada: 'critica', mensajeOperativo: 'CPU elevada',
        nombre: 'CPU crítica', descripcion: null, metadatosDescriptivos: null,
        vigenteDesdeUtc: FECHA, vigenteHastaUtc: null
      }],
      estadoActual: {
        revisionOrigenId: ids.revision,
        observacionOrigenId: ids.observacion,
        resultado: 'coincide', codigoMotivo: 'umbral_superado',
        explicacion: 'El valor supera el umbral.', valorEvaluado: 95,
        tipoDato: 'numero', unidad: 'porcentaje', calidad: 'valida',
        severidadCalculada: 'critica', mensajeOperativo: 'CPU elevada',
        evidenciaContextual: { umbral: 90 }, observadoEnUtc: FECHA,
        recibidoEnUtc: FECHA, evaluadoEnUtc: FECHA
      }
    }),
    base('eventoDerivado', {
      reglaOrigenId: ids.regla, revisionOrigenId: ids.revision,
      observacionOrigenId: ids.observacion, fuenteOrigenId: ids.fuente,
      senalOrigenId: ids.senal, evento: 'coincide', codigoMotivo: 'umbral_superado',
      explicacion: 'El valor supera el umbral.', condicion: { operador: 'mayorQue', valor: 90 },
      valorEvaluado: 95, tipoDato: 'numero', unidad: 'porcentaje', calidad: 'valida',
      severidadCalculada: 'critica', mensajeOperativo: 'CPU elevada',
      evidenciaContextual: { umbral: 90 }, observadoEnUtc: FECHA,
      recibidoEnUtc: FECHA, evaluadoEnUtc: FECHA, creadoEnUtc: FECHA
    }),
    base('rangoHistorico', {
      fuenteOrigenId: ids.fuente, senalOrigenId: ids.senal,
      desdeUtc: '2031-04-01T00:00:00.000Z', hastaUtc: '2031-04-02T00:00:00.000Z',
      causa: 'retencionOrigen'
    })
  ];
  const normalizados = ejemplos.map((payload) => validarPayloadTelemetriaFederacion(payload));
  assert.deepEqual(
    normalizados.map(({ tipoRegistro }) => tipoRegistro),
    TIPOS_REGISTRO_TELEMETRIA_FEDERACION
  );
  assert.equal(normalizados[2].valor, 95.5);
  assert.equal(normalizados[3].observacion.valor, 95.5);
  assert.equal(normalizados[5].estadoActual.resultado, 'coincide');
  for (const payload of normalizados) {
    const texto = JSON.stringify(payload).toLowerCase();
    for (const prohibido of ['sesionauditoria', 'sesion_id', 'token', 'secreto', 'lease', 'fencing', 'worker', 'requestid']) {
      assert.equal(texto.includes(prohibido), false, prohibido);
    }
  }
  assert.throws(
    () => validarPayloadTelemetriaFederacion({ ...ejemplos[1], sensible: true }),
    (error) => error.codigo === 'forma_payload_telemetria_invalida'
  );
  assert.throws(
    () => validarPayloadTelemetriaFederacion({
      ...ejemplos[3], observacion: { ...observacion, senalOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN) }
    }),
    (error) => error.codigo === 'fotografia_senal_incoherente'
  );
  assert.throws(
    () => validarPayloadTelemetriaFederacion({ ...ejemplos[7], hastaUtc: ejemplos[7].desdeUtc }),
    (error) => error.codigo === 'rango_historico_invalido'
  );
  assert.throws(
    () => validarPayloadTelemetriaFederacion({
      ...ejemplos[4], estado: 'nuncaObservado', periodoPolOrigenId: null
    }),
    (error) => error.codigo === 'fotografia_pol_incoherente'
  );
  assert.throws(
    () => validarPayloadTelemetriaFederacion({
      ...ejemplos[4], estado: 'cerrado', motivoCierre: 'apagado'
    }),
    (error) => error.codigo === 'fotografia_pol_incoherente'
  );
  assert.throws(
    () => validarPayloadTelemetriaFederacion({
      ...ejemplos[2], vigenteHastaUtc: '2031-04-05T06:07:07.901Z'
    }),
    (error) => error.codigo === 'vigencia_observacion_invalida'
  );
  assert.throws(
    () => validarPayloadTelemetriaFederacion({ ...ejemplos[5], revisiones: [] }),
    (error) => error.codigo === 'revisiones_regla_invalidas'
  );
  assert.throws(
    () => validarPayloadTelemetriaFederacion({
      ...ejemplos[5], revisionVigenteOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
    }),
    (error) => error.codigo === 'revision_vigente_ausente'
  );
  return normalizados;
}

async function verificarRegistroEstatico() {
  assert.deepEqual(
    resolverDisposicionFisicaScopeOrganizativo('identidades_elementos_telemetria_federacion'),
    {
      tabla: 'identidades_elementos_telemetria_federacion',
      columnasScope: ['scope_tenant_id', 'scope_empresa_id', 'scope_sitio_id'],
      clasificacion: 'persistencia_protegida',
      disposicion: 'fuera_cascada'
    }
  );
  const definicion = crearDefinicionAdaptadorTelemetriaFederacion();
  const registro = new RegistroAdaptadoresFamiliasFederacion({ adaptadores: [definicion] });
  assert.equal(registro.obtenerEnConstruccion({ familia: 'telemetria', versionFamilia: 1 }).completo, false);
  assert.throws(
    () => registro.obtenerProductivo({ familia: 'telemetria', versionFamilia: 1 }),
    (error) => error.codigo === 'adaptador_familia_no_productivo'
  );
}

async function verificarEsquema(sql, ejemplos) {
  const tablas = await sql.consultar(
    `SELECT TABLE_NAME AS nombre FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (
        'identidades_elementos_telemetria_federacion','registros_telemetria_remotos'
      ) ORDER BY TABLE_NAME`
  );
  assert.deepEqual(tablas.map(({ nombre }) => nombre), [
    'identidades_elementos_telemetria_federacion', 'registros_telemetria_remotos'
  ]);
  const columnas = await sql.consultar(
    `SELECT COLUMN_NAME AS nombre FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='registros_telemetria_remotos'`
  );
  for (const requerida of [
    'tipo_registro', 'fuente_origen_id', 'senal_origen_id',
    'referencia_origen_id', 'tiempo_dato_utc', 'vigente_hasta_origen_utc',
    'representacion_canonica'
  ]) assert.ok(columnas.some(({ nombre }) => nombre === requerida), requerida);

  const identidad = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  await sql.ejecutar(
    `INSERT INTO identidades_elementos_telemetria_federacion (
       tipo_elemento,clave_local,agente_id_local,elemento_origen_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES ('senal','42',42,?,1,2,3,'vigente',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),NULL,1)`,
    [identidad]
  );
  await sql.ejecutar(
    `UPDATE identidades_elementos_telemetria_federacion
        SET estado='retirado',retirada_en_utc=UTC_TIMESTAMP(3),
            actualizada_en_utc=UTC_TIMESTAMP(3),version_registro=version_registro+1
      WHERE tipo_elemento='senal' AND clave_local='42'`
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE identidades_elementos_telemetria_federacion
          SET estado='vigente',retirada_en_utc=NULL,
              actualizada_en_utc=UTC_TIMESTAMP(3),version_registro=version_registro+1
        WHERE tipo_elemento='senal' AND clave_local='42'`
    ),
    (error) => error.sqlState === '45000'
  );
  await assert.rejects(
    sql.ejecutar(
      "DELETE FROM identidades_elementos_telemetria_federacion WHERE tipo_elemento='senal' AND clave_local='42'"
    ),
    (error) => error.sqlState === '45000'
  );
  const triggers = await sql.consultar(
    `SELECT TRIGGER_NAME AS nombre FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN (
        'trg_identidad_telemetria_inmutable','trg_identidad_telemetria_protegida',
        'trg_registro_telemetria_remoto_inmutable'
      ) ORDER BY TRIGGER_NAME`
  );
  assert.equal(triggers.length, 3);
  assert.equal(ejemplos.length, 8);
}

function cuerpoObservacion(ids) {
  return {
    fuenteOrigenId: ids.fuente, senalOrigenId: ids.senal,
    periodoPolOrigenId: ids.periodo, categoria: 'sistema', clave: 'cpu', tag: 'total',
    codigoSenal: 'sistema.cpu.total', tipoDato: 'numero', unidad: 'porcentaje',
    valor: 95.5, calidad: 'valida', severidadDeclarada: 'info', origen: 'directa',
    vigenteHastaUtc: '2031-04-05T06:12:08.901Z', detalleHumano: 'Carga total',
    metadatosContextuales: { nucleo: 'todos' }, emitidoEnUtc: FECHA,
    observadoEnUtc: FECHA, recibidoEnUtc: FECHA
  };
}

function crearIds() {
  const nombres = [
    'contextoAgente', 'tenant', 'empresa', 'sitio', 'fuente', 'senal',
    'observacion', 'periodo', 'regla', 'revision'
  ];
  return Object.fromEntries(nombres.map((nombre) => [
    nombre, id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
  ]));
}
function base(tipoRegistro, contenido) {
  return { perfil: 'sentinelia-federacion-telemetria-v1', version: 1, tipoRegistro, ...contenido };
}
function id(tipo) { return String(generador.generar(tipo)); }
function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }
