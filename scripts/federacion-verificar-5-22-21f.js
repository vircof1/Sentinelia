import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { RepositorioConsecuenciasConcesionFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioConsecuenciasConcesionFederacionSql.js';
import { FuenteEntropiaCriptograficaNode }
  from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA }
  from '../paquetes/federacion/src/IdentidadFederada.js';

const raiz = new URL('..', import.meta.url);
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const id = (tipo) => String(generador.generar(tipo));

async function verificarEmision() {
  const ids = identidades();
  const conexion = new ConexionConsecuencias({
    direccion: 'emision', ids,
    elementos: [id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)]
  });
  const repositorio = crearRepositorio(conexion);
  const entrada = {
    relacionId: ids.relacion,
    revisionAnteriorId: ids.revisionAnterior,
    revisionSiguienteId: ids.revisionSiguiente,
    seleccionAnterior: seleccion(['base', 'credencialPropia'], true),
    seleccionSiguiente: seleccion(['base'], false),
    causa: 'reduccionConcesion'
  };
  const resultado = await repositorio.aplicar(entrada);
  assert.equal(resultado.estado, 'aplicado');
  assert.equal(resultado.salidas, 2);
  assert.deepEqual(resultado.reduccion.familias.monitores.campos,
    ['credencialPropia']);
  assert.equal(resultado.reduccion.familias.monitores.sensibleRetirado, true);
  assert.ok(conexion.sentencias.some((sql) =>
    sql.includes("UPDATE outbox_federacion SET estado='bloqueada'")));
  assert.ok(conexion.sentencias.some((sql) =>
    sql.includes("UPDATE flujos_federacion SET estado='detenido'")));
  assert.equal(conexion.salidas.every((salida) =>
    salida.estado === 'pendienteEmision' && salida.proyeccionId === null), true);
  const replay = await repositorio.aplicar(entrada);
  assert.equal(replay.estado, 'yaAplicado');
  assert.equal(conexion.salidas.length, 2);
}

async function verificarRecepcion() {
  const ids = identidades();
  const conexion = new ConexionConsecuencias({ direccion: 'recepcion', ids });
  const retiradas = [];
  const repositorio = crearRepositorio(conexion, {
    retirarContribucionEnTransaccion: async (entrada) => retiradas.push(entrada),
    retirarCamposContribucionEnTransaccion: async () => ({
      camposRecalculados: 0
    })
  });
  const resultado = await repositorio.aplicar({
    relacionId: ids.relacion,
    revisionAnteriorId: ids.revisionAnterior,
    seleccionAnterior: seleccion(['base'], false),
    seleccionSiguiente: null,
    causa: 'sinAutoridad'
  });
  assert.equal(resultado.contribucionesRetiradas, 1);
  assert.equal(retiradas.length, 1);
  assert.equal(retiradas[0].causa, 'sinAutoridad');
  assert.equal(conexion.salidas[0].estado, 'aplicadaRecepcion');
  assert.ok(conexion.sentencias.some((sql) =>
    sql.includes("estado='suprimida',causa_supresion=?")));
  assert.ok(conexion.sentencias.some((sql) =>
    sql.includes("estado_autorizacion='noAutorizada'")));
}

async function verificarComposicion() {
  const [migracion, control, consolidacion,
    reconciliacion, flujo, web] =
    await Promise.all([
      leer('migraciones/sql/0001_esquema_inicial.sql'),
      leer('paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js'),
      leer('paquetes/federacion/adaptadores/RepositorioConsolidacionConcesionFederacionSql.js'),
      leer('paquetes/federacion/aplicacion/ServicioReconciliacionFlujosFederacion.js'),
      leer('paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js'),
      leer('apps/sentinelia-web/src/index.js')
    ]);
  for (const tabla of [
    'cortes_datos_concesion_federacion',
    'salidas_concesion_federacion',
    'historico_reconciliaciones_flujos_concesion_federacion'
  ]) assert.ok(migracion.includes(tabla));
  assert.match(migracion, /pendienteRefederacion/u);
  assert.match(migracion, /ocurrencia_origen/u);
  assert.match(control, /repositorioConsecuenciasDatos\.aplicarEnTransaccion/u);
  assert.match(control, /obtenerUltimaRevisionEfectiva/u);
  assert.match(control,
    /revisionSiguienteId:\s*entrada\.revision\.revisionId[\s\S]*intersectarReduccionEfectiva/u);
  assert.match(consolidacion, /claseCambio.*reduccion.*mixta/su);
  assert.match(reconciliacion,
    /componentes: \[flujoId, concesion\.revisionEfectivaId\]/u);
  assert.match(flujo, /async prepararGeneracionConcesion/u);
  assert.match(web, /repositorioConsecuenciasDatos:\s*repositorioConsecuenciasConcesionFederacion/u);
}

function crearRepositorio(conexion, soporte = null) {
  return new RepositorioConsecuenciasConcesionFederacionSql({
    obtenerConexion: async () => conexion
  }, { repositorioSoporteCampos: soporte || {
    retirarContribucionEnTransaccion: async () => ({}),
    retirarCamposContribucionEnTransaccion: async () => ({ camposRecalculados: 0 })
  } });
}

function identidades() {
  return {
    relacion: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    revisionAnterior: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    revisionSiguiente: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    flujo: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacion: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    proyeccion: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION),
    contribucion: id(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION)
  };
}

function seleccion(campos, sensible) {
  return {
    activa: true, vacia: false, nivelesScope: ['empresa'],
    familias: {
      monitores: {
        campos, permiteContenidoSensible: sensible, permiteRefederacion: true
      }
    }
  };
}

class ConexionConsecuencias {
  constructor({ direccion, ids, elementos = [] }) {
    this.direccion = direccion;
    this.ids = ids;
    this.elementos = elementos;
    this.sentencias = [];
    this.salidas = [];
    this.cortes = new Set();
  }
  async beginTransaction() {}
  async commit() {}
  async rollback() {}
  release() {}
  async query(sql) {
    this.sentencias.push(sql.replace(/\s+/gu, ' ').trim());
    return [[{ ahora: '2026-08-10 12:00:00.000' }]];
  }
  async execute(sql, parametros = []) {
    const canonica = sql.replace(/\s+/gu, ' ').trim();
    this.sentencias.push(canonica);
    if (canonica.startsWith('SELECT relacion_id,direccion FROM relaciones_federacion')) {
      return [[{ relacion_id: this.ids.relacion, direccion: this.direccion }]];
    }
    if (canonica.startsWith('SELECT corte_id FROM cortes_datos_concesion_federacion')) {
      return [[...(this.cortes.has(parametros[0]) ? [{ corte_id: parametros[0] }] : [])]];
    }
    if (canonica.startsWith('INSERT INTO cortes_datos_concesion_federacion')) {
      this.cortes.add(parametros[0]); return [{ affectedRows: 1 }];
    }
    if (canonica.startsWith('SELECT * FROM flujos_federacion')) {
      return [[{ flujo_id: this.ids.flujo, relacion_id: this.ids.relacion,
        familia: 'monitores', generacion_activa_id: this.ids.generacion }]];
    }
    if (canonica.startsWith('SELECT DISTINCT p.elemento_origen_id')) {
      return [this.elementos.map((elemento_origen_id) => ({ elemento_origen_id }))];
    }
    if (canonica.startsWith('SELECT c.contribucion_id,c.proyeccion_id')) {
      return [[{ contribucion_id: this.ids.contribucion,
        proyeccion_id: this.ids.proyeccion }]];
    }
    if (canonica.startsWith('SELECT e.proyeccion_id,e.generacion_actual_id')) {
      return [[{ proyeccion_id: this.ids.proyeccion,
        generacion_actual_id: this.ids.generacion }]];
    }
    if (canonica.startsWith('INSERT INTO salidas_concesion_federacion')) {
      this.salidas.push({
        salidaId: parametros[0], proyeccionId: parametros[4],
        contribucionId: parametros[5], elementoOrigenId: parametros[6],
        estado: parametros[8]
      });
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 1 }];
  }
}

async function leer(ruta) {
  return readFile(new URL(ruta, raiz), 'utf8');
}

await verificarEmision();
await verificarRecepcion();
await verificarComposicion();

console.log(
  '[federacion] OK 5.22.21f: reduccion=corte-durable ' +
  'backlog=invalidado salidas=sin-borrado-origen recepcion=sin-gobierno ' +
  'sensible=retirable generaciones=por-revision'
);
