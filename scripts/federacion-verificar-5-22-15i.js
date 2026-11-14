import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  AdaptadorMonitoresFederacion,
  crearDefinicionAdaptadorMonitoresFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorMonitoresFederacion.js';
import { RepositorioMonitoresLocalSql } from '../paquetes/federacion/adaptadores/RepositorioMonitoresLocalSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';

await main();

async function main() {
  const repositorio = await leer(
    '../paquetes/federacion/adaptadores/RepositorioMonitoresLocalSql.js'
  );
  assert.match(repositorio, /prepararCapturasAdministracionEnTransaccion/u);
  assert.match(repositorio, /listarCapturasEnTransaccion/u);
  assert.match(repositorio, /prepararRetiradaEnTransaccion/u);
  assert.match(repositorio, /resolverVigenciaEstado/u);
  assert.doesNotMatch(repositorio, /pendiente_scheduler\s*:/u);
  assert.match(repositorio, /credencial_monitor_no_autorizada/u);
  assert.match(repositorio, /configuracionOverride/u);
  const repositorioFalso = {
    prepararCapturaEnTransaccion: async () => 'captura',
    prepararCapturasAdministracionEnTransaccion: async () => ['captura'],
    prepararCapturasRuntimeEnTransaccion: async () => ['runtime'],
    listarCapturasEnTransaccion: async () => ['foto'],
    prepararRetiradaEnTransaccion: async () => ['retirada']
  };
  const adaptador = new AdaptadorMonitoresFederacion({ repositorioLocal: repositorioFalso });
  assert.equal(await adaptador.prepararCapturaEnTransaccion(), 'captura');
  assert.deepEqual(await adaptador.listarCapturasEnTransaccion(), ['foto']);
  assert.deepEqual(await adaptador.prepararRetiradaEnTransaccion(), ['retirada']);
  const definicion = crearDefinicionAdaptadorMonitoresFederacion({ repositorioLocal: repositorioFalso });
  assert.equal(definicion.productivo, false);
  assert.deepEqual(Object.keys(definicion.interfaces).sort(), [
    'captura', 'fotografiaInicial', 'payload', 'retirada'
  ]);
  assert.throws(
    () => new RepositorioMonitoresLocalSql({ obtenerConexion() {} }, {
      installationLocalId: 'invalida', resolverVigenciaEstado: () => new Date()
    }),
    /installationLocalId/u
  );
  await verificarSeparacionSensibleReal();
  await verificarReferenciaTelemetriaOpacaSinSeleccion();

  console.log(
    '[federacion] OK 5.22.15i: administracion=transaccional fotografia=inicial ' +
    'prioridad=operativa_y_reconstruccion sensibilidad=explicita referencias=opacas ' +
    'retirada=antes_del_borrado'
  );
}

async function verificarReferenciaTelemetriaOpacaSinSeleccion() {
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaCriptograficaNode()
  });
  const installationLocalId = String(
    generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)
  );
  const scope = {
    tenant: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)),
    empresa: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)),
    sitio: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN))
  };
  let identidadMonitor = null;
  let identidadSenal = null;
  const conexion = {
    async query(sql) {
      assert.match(sql, /in_transaction/u);
      return [[{ activa: 1 }]];
    },
    async execute(sql, parametros = []) {
      if (/SELECT \* FROM monitores WHERE id=/u.test(sql)) {
        return [[{
          id: 10, tenant_id: 1, empresa_id: 2, sitio_id: 3,
          nombre: 'Monitor con señal local', tipo: 'telemetria', descripcion: null,
          activo: 1, intervalo_ejecucion_segundos: 60,
          desfase_inicial_segundos: 0, interpretacion_estado: 'normal',
          descripcion_fallo: 'Sin lectura', posible_solucion: 'Revisar agente',
          configuracion: '{}'
        }]];
      }
      if (/FROM identidades_elementos_monitores_federacion/u.test(sql)) {
        return [identidadMonitor ? [{
          elemento_origen_id: identidadMonitor, estado: 'vigente',
          scope_tenant_id: 1, scope_empresa_id: 2, scope_sitio_id: 3
        }] : []];
      }
      if (/INSERT INTO identidades_elementos_monitores_federacion/u.test(sql)) {
        identidadMonitor = parametros[3];
        return [{ affectedRows: 1 }];
      }
      if (/FROM identidades_estructura_organizativa_federacion/u.test(sql)) {
        return [[{ elemento_origen_id: scope[parametros[0]] }]];
      }
      if (/FROM vinculos_monitores_telemetria/u.test(sql)) {
        return [[{
          tipo_fuente: 'senal_directa', agente_id: 407, senal_id: 19,
          regla_id: null, proyeccion_federada_id: null
        }]];
      }
      if (/SELECT \* FROM agentes_sentinelia/u.test(sql)) {
        return [[{ id: 407, tenant_id: 1, empresa_id: 2, sitio_id: 3 }]];
      }
      if (/FROM identidades_elementos_telemetria_federacion/u.test(sql)) {
        return [identidadSenal ? [{
          elemento_origen_id: identidadSenal, estado: 'vigente',
          agente_id_local: 407,
          scope_tenant_id: 1, scope_empresa_id: 2, scope_sitio_id: 3
        }] : []];
      }
      if (/INSERT INTO identidades_elementos_telemetria_federacion/u.test(sql)) {
        identidadSenal = parametros[3];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`SQL inesperado en referencia opaca 15i: ${sql}`);
    }
  };
  const repositorio = new RepositorioMonitoresLocalSql(
    { obtenerConexion() {} },
    {
      installationLocalId,
      generadorIdentidades: generador,
      resolverVigenciaEstado: () => '2031-05-06T07:13:09.123Z',
      ahora: () => new Date('2031-05-06T07:08:09.123Z')
    }
  );
  const captura = await repositorio.prepararCapturaEnTransaccion(
    { monitorId: 10 },
    { conexion }
  );
  assert.equal(captura.payload.referenciasOperativas.length, 1);
  assert.deepEqual(captura.payload.referenciasOperativas[0], {
    familia: 'telemetria',
    elementoOrigenId: identidadSenal,
    rol: 'entradaTelemetria',
    visibilidad: 'opaca',
    metadatos: { tipoFuente: 'senal_directa' }
  });
  assert.ok(identidadSenal, 'La referencia debe reservar su identidad sin capturar Telemetría.');
}

async function verificarSeparacionSensibleReal() {
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaCriptograficaNode()
  });
  const installationLocalId = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION));
  const scope = {
    tenant: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)),
    empresa: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN))
  };
  let identidadMonitor = null;
  const conexion = {
    async query(sql) {
      assert.match(sql, /in_transaction/u);
      return [[{ activa: 1 }]];
    },
    async execute(sql, parametros = []) {
      if (/SELECT \* FROM monitores WHERE id=/u.test(sql)) {
        return [[{
          id: 7, tenant_id: 1, empresa_id: 2, sitio_id: null,
          nombre: 'Monitor sensible', tipo: 'ping', descripcion: null, activo: 1,
          intervalo_ejecucion_segundos: 60, desfase_inicial_segundos: 0,
          interpretacion_estado: 'normal', descripcion_fallo: 'Sin respuesta',
          posible_solucion: 'Revisar red',
          configuracion: JSON.stringify({
            host: 'example.test',
            destinos: [{ puerto: 443, password: 'secreto-anidado' }]
          })
        }]];
      }
      if (/FROM identidades_elementos_monitores_federacion/u.test(sql)) {
        return [identidadMonitor ? [{
          elemento_origen_id: identidadMonitor, estado: 'vigente',
          scope_tenant_id: 1, scope_empresa_id: 2, scope_sitio_id: null
        }] : []];
      }
      if (/INSERT INTO identidades_elementos_monitores_federacion/u.test(sql)) {
        identidadMonitor = parametros[3];
        return [{ affectedRows: 1 }];
      }
      if (/FROM vinculos_monitores_telemetria/u.test(sql)) return [[]];
      if (/FROM identidades_estructura_organizativa_federacion/u.test(sql)) {
        return [[{ elemento_origen_id: scope[parametros[0]] }]];
      }
      throw new Error(`SQL inesperado en fixture 15i: ${sql}`);
    }
  };
  const repositorio = new RepositorioMonitoresLocalSql({ obtenerConexion() {} }, {
    installationLocalId,
    generadorIdentidades: generador,
    resolverVigenciaEstado: () => '2031-05-06T07:13:09.123Z',
    ahora: () => new Date('2031-05-06T07:08:09.123Z')
  });
  const omitida = await repositorio.prepararCapturaEnTransaccion(
    { monitorId: 7 }, { conexion }
  );
  assert.deepEqual(omitida.payload.credencialPropia, {
    estado: 'omitida', causa: 'noSeleccionada'
  });
  assert.equal(omitida.definicion.campos.monitores.sensibilidad, 'ordinario');
  assert.equal(omitida.payload.configuracionOperativa.destinos[0].password, undefined);
  await assert.rejects(
    repositorio.prepararCapturaEnTransaccion({
      monitorId: 7, incluirCredencialPropia: true
    }, { conexion }),
    (error) => error.codigo === 'credencial_monitor_no_autorizada'
  );
  const presente = await repositorio.prepararCapturaEnTransaccion({
    monitorId: 7,
    incluirCredencialPropia: true,
    puedeFederarCredencialPropia: true
  }, { conexion });
  assert.equal(presente.payload.credencialPropia.estado, 'presente');
  assert.equal(presente.definicion.campos.monitores.sensibilidad, 'sensible');
  assert.equal(
    presente.payload.credencialPropia.contenido['/destinos/0/password'],
    'secreto-anidado'
  );
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
