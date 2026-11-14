import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { FuenteFotografiaRegistroFamiliasFederacion } from '../paquetes/federacion/aplicacion/FuenteFotografiaRegistroFamiliasFederacion.js';
import { ServicioBorradoresFederacionPortal } from '../apps/sentinelia-web/src/servicios/ServicioBorradoresFederacionPortal.js';
import { ServicioReconstruccionesFederacionPortal } from '../apps/sentinelia-web/src/servicios/ServicioReconstruccionesFederacionPortal.js';

async function main() {
  await verificarBorradoresEditablesInactivos();
  await verificarReconstruccionesAutorizadas();
  await verificarDespachoFotografiaPorFamilia();
  await verificarIntegracionEstatica();
  console.log(
    '5.22.18i verificada: borradores locales inactivos y reconstrucciones humanas sobre dominio durable.'
  );
}

async function verificarBorradoresEditablesInactivos() {
  const servicio = new ServicioBorradoresFederacionPortal({
    servicioBorradores: {
      crearMonitorLogicoDesdeMonitorRemoto: async () => ({
        nombre: 'Copia lógica de WAN',
        descripcion: 'Enlace principal',
        descripcionFallo: 'Sin enlace',
        posibleSolucion: 'Revisar operador',
        configuracion: {
          expresion: 'A', mensajeFallo: 'Sin enlace', estadoInicial: 'disponible',
          retardoSenalSegundos: 0,
          dependencias: [{ variable: 'A', fuente: 'monitor_federado', proyeccionId: 'p' }],
          layoutVisual: {}
        },
        procedenciaFederada: { proyeccionId: 'p' }
      }),
      crearTriggerLocalDesdeTriggerRemoto: async () => ({
        nombre: 'Copia de webhook', tipo: 'api', descripcion: 'Aviso', activo: false,
        configuracion: {
          url: 'https://example.invalid/hook', metodo: 'POST', cabeceras: {}
        },
        requiereCredencialLocal: true,
        procedenciaFederada: { proyeccionId: 'q' }
      })
    }
  });
  const monitor = await servicio.crearFormularioMonitor({}, 'p');
  assert.equal(monitor.formulario.activo, '0');
  assert.equal(monitor.formulario.tipo, 'booleano');
  assert.equal(JSON.parse(monitor.formulario.dependencias_logicas)[0].proyeccionId, 'p');
  assert.equal(monitor.formulario.descripcion_fallo, 'Sin enlace');
  const trigger = await servicio.crearFormularioTrigger({}, 'q');
  assert.equal(trigger.formulario.activo, '0');
  assert.equal(trigger.formulario.tipo, 'api');
  assert.equal(trigger.requiereCredencialLocal, true);
  assert.equal('token' in trigger.formulario, false);
}

async function verificarReconstruccionesAutorizadas() {
  const consultas = [];
  const decisiones = [];
  const flujo = {
    flujoId: 'flujo-1', direccion: 'emision', familia: 'monitores',
    versionFamilia: 1, contexto: { nivel: 'empresa', tenantId: '7', empresaId: '8', sitioId: null },
    generacion: { generacionId: 'activa', ordinal: '1', estado: 'completa' }
  };
  const servicio = new ServicioReconstruccionesFederacionPortal({
    clienteSql: {
      consultar: async (sql, parametros) => {
        consultas.push({ sql, parametros });
        return [{
          flujo_id: 'flujo-1', direccion: 'emision',
          nombre_remoto_declarado: 'Nodo B', installation_remota_id: 'inst-b'
        }];
      }
    },
    servicioAutorizacion: {
      puedeConfigurarEmisionesFederacion: (contexto) =>
        !contexto.impersonacionActiva && contexto.permisos.emision,
      puedeConfigurarRecepcionesFederacion: () => false
    },
    servicioReconstrucciones: {
      listar: async () => ({ flujo, candidatas: [] }),
      decidir: async (entrada) => { decisiones.push(entrada); return { resultado: 'creada' }; },
      cancelar: async () => ({}), promover: async () => ({}), revalidar: async () => ({})
    }
  });
  const contexto = {
    idUsuario: '9', impersonacionActiva: false,
    nivelScope: 'empresa',
    tenantId: '7', empresaId: '8', sitioId: null,
    permisos: { emision: true }
  };
  const vista = await servicio.obtener(contexto);
  assert.equal(vista.totalFlujos, 1);
  assert.equal(vista.flujos[0].puedeDecidir, true);
  assert.match(consultas[0].sql, /f\.scope_tenant_id=\?/u);
  assert.match(consultas[0].sql, /f\.scope_empresa_id=\?/u);
  assert.match(
    consultas[0].sql,
    /g\.generacion_id=f\.generacion_activa_id/u,
    'el listado debe excluir flujos históricos sin generación activa'
  );
  assert.match(
    consultas[0].sql,
    /r\.estado_ciclo='vinculada'/u,
    'el listado debe excluir relaciones eliminadas o deshabilitadas'
  );
  assert.match(
    consultas[0].sql,
    /fronteras_generaciones_federacion/u,
    'la generación visible debe conservar una frontera recuperable'
  );
  assert.deepEqual(consultas[0].parametros.slice(-2), ['7', '8']);
  await servicio.decidir(contexto, {
    flujoId: 'flujo-1', estrategia: 'coexistir', motivo: 'Reconstrucción deliberada'
  });
  assert.equal(decisiones[0].contextoUsuarioActual, contexto);
  assert.equal(decisiones[0].motivo, 'Reconstrucción deliberada');
  const impersonado = { ...contexto, impersonacionActiva: true };
  await assert.rejects(
    servicio.decidir(impersonado, {
      flujoId: 'flujo-1', estrategia: 'coexistir', motivo: 'No autorizada'
    }),
    (error) => error.statusCode === 403
  );
  const consultasAntes = consultas.length;
  await assert.rejects(
    servicio.obtener({
      ...contexto,
      nivelScope: 'tenant',
      tenantId: null,
      empresaId: null
    }),
    (error) => error.statusCode === 403 &&
      error.codigo === 'SCOPE_RECONSTRUCCION_INVALIDO'
  );
  assert.equal(
    consultas.length,
    consultasAntes,
    'un contexto de scope incoherente debe fallar antes de consultar SQL'
  );
}

async function verificarDespachoFotografiaPorFamilia() {
  const llamadas = [];
  const fuente = new FuenteFotografiaRegistroFamiliasFederacion({
    registroFamilias: {
      obtenerProductivo: (identidad) => {
        assert.deepEqual(identidad, { familia: 'monitores', versionFamilia: 1 });
        return {
          interfaces: {
            fotografiaInicial: {
              listarCapturasEnTransaccion: async (solicitud, opciones) => {
                llamadas.push({ solicitud, opciones });
                return [{ definicion: { familia: 'monitores' } }];
              }
            }
          }
        };
      }
    }
  });
  const conexion = {
    execute: async () => [[{ familia: 'monitores', version_familia: 1 }]]
  };
  const capturas = await fuente.listarCapturasEnTransaccion(
    { flujoId: 'f', generacionId: 'g' }, { conexion }
  );
  assert.equal(capturas.length, 1);
  assert.equal(llamadas[0].opciones.conexion, conexion);
}

async function verificarIntegracionEstatica() {
  const [rutas, controlador, explorador, monitor, trigger, estilos, index] =
    await Promise.all([
      leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
      leer('../apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
      leer('../apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs'),
      leer('../apps/sentinelia-web/src/views/portal/monitor-formulario.ejs'),
      leer('../apps/sentinelia-web/src/views/portal/trigger-formulario.ejs'),
      leer('../apps/sentinelia-web/src/public/css/portal.css'),
      leer('../apps/sentinelia-web/src/index.js')
    ]);
  assert.match(rutas, /borradores\/monitor/u);
  assert.match(rutas, /federacion\/reconstrucciones/u);
  assert.match(controlador, /borradorMonitorFederado/u);
  assert.match(explorador, /Convertir a monitor lógico local/u);
  assert.match(explorador, /Usar como plantilla de trigger local/u);
  assert.match(monitor, /Todavía no existe ningún monitor local/u);
  assert.match(trigger, /no conserva secretos del origen/u);
  assert.match(estilos, /\.modal-plan-trigger \.modal-content \{[\s\S]*background: var\(--superficie\)/u);
  assert.match(estilos, /\.modal-plan-trigger__item \{[\s\S]*background: var\(--superficie-2\)/u);
  assert.match(estilos, /html\[data-theme="dark"\] \.modal-plan-trigger \.btn-close/u);
  assert.match(estilos, /\.modal-uso-trigger \.modal-content \{[\s\S]*background: var\(--superficie\)/u);
  assert.match(estilos, /\.modal-uso-trigger__kpi \{[\s\S]*color-mix\(in srgb, var\(--estado-positivo\)/u);
  assert.match(estilos, /\.modal-uso-trigger__vinculo \{[\s\S]*background: var\(--superficie-2\)/u);
  assert.match(estilos, /html\[data-theme="dark"\] \.modal-uso-trigger \.btn-close/u);
  const estilosUso = estilos.slice(
    estilos.indexOf('.modal-uso-trigger .modal-content'),
    estilos.indexOf('.modal-plan-trigger .modal-content')
  );
  assert.doesNotMatch(estilosUso, /rgba\((?:232|255),\s*(?:246|255),\s*(?:240|255)/u);
  assert.doesNotMatch(estilosUso, /var\(--texto-principal\)/u);
  const estilosPlan = estilos.slice(
    estilos.indexOf('.modal-plan-trigger .modal-content'),
    estilos.indexOf('.modal-impacto-trigger .modal-content')
  );
  assert.doesNotMatch(estilosPlan, /rgba\(255, 255, 255/u);
  assert.doesNotMatch(estilosPlan, /var\(--texto-principal\)/u);
  assert.match(index, /FuenteFotografiaRegistroFamiliasFederacion/u);
  const servicioReconstrucciones = await leer(
    '../apps/sentinelia-web/src/servicios/ServicioReconstruccionesFederacionPortal.js'
  );
  assert.match(servicioReconstrucciones, /SCOPE_RECONSTRUCCION_INVALIDO/u);
  const repositorioTrigger = await leer(
    '../paquetes/federacion/adaptadores/RepositorioTriggersInformativosRemotoSql.js'
  );
  assert.match(repositorioTrigger, /url\.username=''/u);
  assert.match(repositorioTrigger, /url\.password=''/u);
  assert.match(repositorioTrigger, /url\.searchParams\.delete/u);
  assert.match(repositorioTrigger, /causa!=='ausenteEnOrigen'/u);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
