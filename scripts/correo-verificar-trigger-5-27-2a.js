import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  admiteConfiguracionOverrideTrigger,
  esTipoTrigger,
  TIPOS_TRIGGER
} from '../paquetes/triggers/src/CatalogoTiposTrigger.js';
import {
  ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO,
  ConfiguracionTriggerCorreo
} from '../paquetes/triggers/src/ConfiguracionTriggerCorreo.js';
import { AsignacionTriggerMonitor }
  from '../paquetes/triggers/src/AsignacionTriggerMonitor.js';
import { RepositorioAsignacionesTriggerMonitor }
  from '../paquetes/triggers/src/RepositorioAsignacionesTriggerMonitor.js';
import { RepositorioTriggers } from '../paquetes/triggers/src/RepositorioTriggers.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import { Trigger } from '../paquetes/triggers/src/Trigger.js';
import { ValidadorTrigger } from '../paquetes/triggers/src/ValidadorTrigger.js';
import { ServicioAdministracionTriggersPortal }
  from '../apps/sentinelia-web/src/servicios/ServicioAdministracionTriggersPortal.js';
import { ControladorTriggers }
  from '../apps/sentinelia-web/src/controladores/ControladorTriggers.js';

const CONFIGURACION_CORREO = Object.freeze({
  version: 1,
  asuntoPlantilla: '[Sentinelia] {{estado}} · {{monitor}}',
  textoIntroduccion: 'Contexto inicial',
  textoCierre: 'Fin del aviso'
});

async function main() {
  verificarCatalogoComun();
  verificarConfiguracionCorreo();
  verificarOverrides();
  verificarEntidadFiltrosDtoYPortal();
  await verificarAltaContextualDesdeControlador();
  await verificarGateDominio();
  await verificarConsumidoresDelCatalogo();
  console.log(
    '[correo-trigger] OK 5.27.2a: catalogo=unico configuracion=correo@1 ' +
      'override=prohibido filtros_dto_ui=integrados gate_publico=cerrado'
  );
}

function verificarCatalogoComun() {
  assert.deepEqual(TIPOS_TRIGGER, ['api', 'dns', 'correo']);
  assert.equal(Object.isFrozen(TIPOS_TRIGGER), true);
  for (const tipo of TIPOS_TRIGGER) assert.equal(esTipoTrigger(tipo), true);
  assert.equal(esTipoTrigger('shell'), false);
  assert.equal(admiteConfiguracionOverrideTrigger('api'), true);
  assert.equal(admiteConfiguracionOverrideTrigger('dns'), false);
  assert.equal(admiteConfiguracionOverrideTrigger('correo'), false);
}

function verificarConfiguracionCorreo() {
  const validador = new ValidadorTrigger();
  const normalizada = validador.normalizarDefinicionBase({
    nombre: 'Aviso de caída',
    tipo: 'correo',
    activo: false,
    configuracion: CONFIGURACION_CORREO
  });
  assert.deepEqual(normalizada.configuracion, CONFIGURACION_CORREO);

  const predeterminada = validador.normalizarDefinicionBase({
    nombre: 'Aviso predeterminado',
    tipo: 'correo',
    activo: false
  });
  assert.deepEqual(predeterminada.configuracion, {
    version: 1,
    asuntoPlantilla: ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO,
    textoIntroduccion: null,
    textoCierre: null
  });

  for (const configuracion of [
    { ...CONFIGURACION_CORREO, extra: true },
    { ...CONFIGURACION_CORREO, version: 2 },
    { ...CONFIGURACION_CORREO, asuntoPlantilla: '{{usuario}}' },
    { ...CONFIGURACION_CORREO, asuntoPlantilla: 'línea\nnueva' },
    { ...CONFIGURACION_CORREO, asuntoPlantilla: '{{monitor' },
    { ...CONFIGURACION_CORREO, textoIntroduccion: `invalido\rcontrol` },
    { ...CONFIGURACION_CORREO, textoCierre: 'x'.repeat(2001) }
  ]) {
    assert.throws(() => validador.normalizarDefinicionBase({
      nombre: 'Aviso inválido',
      tipo: 'correo',
      activo: false,
      configuracion
    }));
  }

  const entidad = triggerCorreoFixture();
  assert.equal(entidad.configuracion instanceof ConfiguracionTriggerCorreo, true);
  assert.deepEqual(entidad.serializarResumen().configuracion, CONFIGURACION_CORREO);
}

function verificarOverrides() {
  const validador = new ValidadorTrigger();
  assert.deepEqual(validador.construirConfiguracionEfectiva({
    tipo: 'correo',
    configuracionBase: CONFIGURACION_CORREO
  }), CONFIGURACION_CORREO);
  assert.throws(() => validador.construirConfiguracionEfectiva({
    tipo: 'correo',
    configuracionBase: CONFIGURACION_CORREO,
    configuracionOverride: { asuntoPlantilla: 'Sustitución' }
  }), /no admiten configuración override/iu);
  assert.throws(() => validador.construirConfiguracionEfectiva({
    tipo: 'dns',
    configuracionBase: { zonaId: 1, registroId: 2, operacion: 'activar' },
    configuracionOverride: { operacion: 'desactivar' }
  }), /no admiten configuración override/iu);
}

function verificarEntidadFiltrosDtoYPortal() {
  const repositorioTriggers = new RepositorioTriggers({});
  const repositorioAsignaciones = new RepositorioAsignacionesTriggerMonitor({});
  assert.equal(repositorioTriggers.normalizarTipoOpcional('correo'), 'correo');
  assert.equal(repositorioAsignaciones.normalizarTipoOpcional('correo'), 'correo');
  assert.equal(repositorioTriggers.normalizarTipoOpcional('desconocido'), null);

  const portal = new ServicioAdministracionTriggersPortal({
    servicioTriggers: {},
    servicioMonitores: {}
  });
  assert.deepEqual(
    portal.listarDefinicionesTipo().map(({ valor }) => valor),
    TIPOS_TRIGGER
  );
  assert.equal(portal.normalizarFiltroTipo('correo'), 'correo');
  const formulario = portal.construirFormularioNuevo('correo');
  assert.equal(formulario.activo, false);
  assert.equal(formulario.asuntoPlantilla,
    ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO);
  const resumenCorreo = portal.construirResumenConfiguracion(
    'correo',
    CONFIGURACION_CORREO
  );
  assert.equal(resumenCorreo.principal, 'Mensaje v1');
  assert.deepEqual(resumenCorreo.secundaria, ['Con introducción', 'Con cierre']);
  assert.doesNotMatch(resumenCorreo.principal, /\{\{/u);
  assert.equal(
    portal.resumirTriggersAdministracion([triggerCorreoFixture().serializarResumen()])
      .totalCorreo,
    1
  );
  for (const tipo of ['api', 'dns', 'correo']) {
    const formularioTenant = portal.construirFormularioNuevo(tipo, {
      nivelScope: 'tenant',
      tenantId: 17
    });
    assert.equal(formularioTenant.tipo, tipo);
    assert.equal(formularioTenant.nivelPertenencia, 'tenant');
    assert.equal(formularioTenant.tenantId, '17');
  }
}

async function verificarAltaContextualDesdeControlador() {
  let opcionesRecibidas = null;
  let vistaRenderizada = null;
  const controlador = new ControladorTriggers({
    servicioAdministracionTriggersPortal: {
      async construirVistaFormulario(_contexto, opciones) {
        opcionesRecibidas = opciones;
        return { formulario: { tipo: opciones.tipoNuevo } };
      }
    },
    servicioTriggers: {}
  });
  const respuesta = {
    status(codigo) {
      assert.equal(codigo, 200);
      return this;
    },
    render(vista, datos) {
      vistaRenderizada = { vista, datos };
    }
  };

  await controlador.mostrarNuevo({
    query: { tipo: 'api' },
    contextoUsuarioActual: { nivelScope: 'tenant', tenantId: 17 },
    session: {}
  }, respuesta, (error) => { throw error; });

  assert.deepEqual(opcionesRecibidas, {
    idTrigger: null,
    formularioBase: null,
    tipoNuevo: 'api'
  });
  assert.equal(vistaRenderizada.vista, 'portal/trigger-formulario');
  assert.equal(vistaRenderizada.datos.formulario.tipo, 'api');

  const servicioReal = new ServicioAdministracionTriggersPortal({
    servicioTriggers: {},
    servicioMonitores: {},
    repositorioTenants: {
      async listarVisibles() {
        return [{ id: 17, nombre: 'Tenant Javier' }];
      }
    },
    repositorioEmpresas: { async listarVisibles() { return []; } },
    repositorioSitios: { async listarVisibles() { return []; } }
  });
  const vistaReal = await servicioReal.construirVistaFormulario(
    { nivelScope: 'tenant', tenantId: 17, tenantNombre: 'Tenant Javier' },
    { formularioBase: null, tipoNuevo: 'api' }
  );

  assert.equal(vistaReal.formulario.tipo, 'api');
  assert.equal(vistaReal.formulario.nivelPertenencia, 'tenant');
  assert.equal(vistaReal.formulario.tenantId, '17');
  assert.equal(vistaReal.restriccionesScope.tenantBloqueado, true);
  assert.equal(vistaReal.opcionesTenants[0].valor, 17);
}

async function verificarGateDominio() {
  const estado = { tipo_correo_habilitado: 0 };
  const repositorio = new RepositorioTriggersMemoria();
  const repositorioAsignaciones = new RepositorioAsignacionesMemoria();
  const servicio = new ServicioTriggers({
    repositorioTriggers: repositorio,
    repositorioAsignacionesTriggerMonitor: repositorioAsignaciones,
    validadorTrigger: new ValidadorTrigger(),
    servicioConfiguracionPortal: {
      async asegurarActualizada() {},
      obtenerEstadoDespliegueCorreoActual: () => ({ ...estado })
    }
  });
  const definicion = {
    nombre: 'Aviso bajo gate',
    tipo: 'correo',
    activo: false,
    configuracion: CONFIGURACION_CORREO
  };
  await assert.rejects(
    servicio.crearTrigger(definicion),
    (error) => error?.codigo === 'trigger_correo_no_habilitado' &&
      error?.statusCode === 409
  );
  assert.equal(repositorio.creaciones, 0);

  const api = await servicio.crearTrigger({
    nombre: 'API permitida',
    tipo: 'api',
    activo: true,
    url: 'https://api.example.test'
  });
  assert.equal(api.tipo, 'api');

  estado.tipo_correo_habilitado = 1;
  const correo = await servicio.crearTrigger(definicion);
  assert.equal(correo.tipo, 'correo');
  assert.equal(correo.activo, false);
  estado.tipo_correo_habilitado = 0;
  await assert.rejects(
    servicio.actualizarTrigger(correo.id, {
      ...definicion,
      activo: true,
      revisionDeclaracion: correo.revisionDeclaracion
    }),
    (error) => error?.codigo === 'trigger_correo_no_habilitado'
  );
  const editadoInactivo = await servicio.actualizarTrigger(correo.id, {
    ...definicion,
    nombre: 'Aviso editado bajo gate',
    activo: false,
    revisionDeclaracion: correo.revisionDeclaracion
  });
  assert.equal(editadoInactivo.nombre, 'Aviso editado bajo gate');
  const vinculoInactivo = await servicio.crearAsignacionMonitorTrigger({
    monitorId: 91,
    triggerId: correo.id,
    activo: false
  });
  assert.equal(vinculoInactivo.activo, false,
    'El gate no impide preparar un vínculo inactivo.');
  await assert.rejects(
    servicio.crearAsignacionMonitorTrigger({
      monitorId: 92,
      triggerId: correo.id,
      activo: true
    }),
    (error) => error?.codigo === 'trigger_correo_no_habilitado'
  );
  assert.equal(repositorioAsignaciones.creaciones, 1);
  await assert.rejects(
    servicio.actualizarTrigger(api.id, {
      ...definicion,
      nombre: api.nombre,
      revisionDeclaracion: api.revisionDeclaracion
    }),
    /tipo de un trigger existente no se puede cambiar/iu
  );
}

async function verificarConsumidoresDelCatalogo() {
  const archivos = await Promise.all([
    leer('../paquetes/triggers/src/ValidadorTrigger.js'),
    leer('../paquetes/triggers/src/RepositorioTriggers.js'),
    leer('../paquetes/triggers/src/RepositorioAsignacionesTriggerMonitor.js'),
    leer('../apps/sentinelia-web/src/servicios/ServicioAdministracionTriggersPortal.js'),
    leer('../paquetes/federacion/src/PayloadTriggersInformativosFederacion.js'),
    leer('../apps/sentinelia-web/src/views/portal/trigger-formulario.ejs'),
    leer('../apps/sentinelia-web/src/views/portal/trigger-vinculo-formulario.ejs'),
    leer('../apps/sentinelia-web/src/public/js/trigger-vinculo-formulario.js')
  ]);
  for (const codigo of archivos.slice(0, 5)) {
    assert.doesNotMatch(codigo, /\['api', 'dns'\]/u);
  }
  assert.match(archivos[0], /CatalogoTiposTrigger/u);
  assert.match(archivos[1], /CatalogoTiposTrigger/u);
  assert.match(archivos[2], /CatalogoTiposTrigger/u);
  assert.match(archivos[3], /CatalogoTiposTrigger/u);
  assert.match(archivos[4], /CatalogoTiposTrigger/u);
  assert.match(archivos[5], /trigger-form-correo/u);
  assert.match(archivos[6], /configuracionOverride/u);
  assert.match(archivos[7], /metaTrigger\?\.tipo === 'api'/u);
}

class RepositorioAsignacionesMemoria {
  constructor() {
    this.asignaciones = [];
    this.creaciones = 0;
  }

  async listarPorMonitorId(monitorId) {
    return this.asignaciones.filter(
      (asignacion) => Number(asignacion.monitorId) === Number(monitorId)
    );
  }

  async crear(definicion) {
    this.creaciones += 1;
    const asignacion = new AsignacionTriggerMonitor({
      id: this.creaciones,
      monitor_id: definicion.monitorId,
      trigger_id: definicion.triggerId,
      activo: definicion.activo ? 1 : 0,
      orden_ejecucion: definicion.ordenEjecucion,
      eventos_disparo: JSON.stringify(definicion.eventosDisparo),
      configuracion_override: definicion.configuracionOverride == null
        ? null
        : JSON.stringify(definicion.configuracionOverride)
    });
    this.asignaciones.push(asignacion);
    return asignacion;
  }
}

class RepositorioTriggersMemoria {
  constructor() {
    this.triggers = new Map();
    this.secuencia = 0;
    this.creaciones = 0;
  }

  async buscarPorNombreEnScope({ nombre }) {
    return [...this.triggers.values()].find((trigger) => trigger.nombre === nombre) || null;
  }

  async crear(definicion) {
    this.creaciones += 1;
    const trigger = new Trigger({
      id: ++this.secuencia,
      ...definicion,
      configuracion: JSON.stringify(definicion.configuracion)
    });
    this.triggers.set(trigger.id, trigger);
    return trigger;
  }

  async buscarPorId(id) {
    return this.triggers.get(Number(id)) || null;
  }

  async actualizar(definicion) {
    const trigger = new Trigger({
      id: definicion.idTrigger,
      ...definicion,
      revisionDeclaracion: definicion.revisionDeclaracion + 1,
      configuracion: JSON.stringify(definicion.configuracion)
    });
    this.triggers.set(trigger.id, trigger);
    return trigger;
  }
}

function triggerCorreoFixture() {
  return new Trigger({
    id: 41,
    nombre: 'Aviso de correo',
    tipo: 'correo',
    activo: 0,
    configuracion: JSON.stringify(CONFIGURACION_CORREO)
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();
