import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import {
  ServicioAdministracionAgentesPortal
} from '../apps/sentinelia-web/src/servicios/ServicioAdministracionAgentesPortal.js';
import {
  ControladorReglasDerivacionTelemetria
} from '../apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js';
import { ControladorMonitores } from '../apps/sentinelia-web/src/controladores/ControladorMonitores.js';
import {
  RepositorioMonitores
} from '../paquetes/monitores/src/RepositorioMonitores.js';

await verificarConteoAgrupado();
await verificarContratoTarjetas();
await verificarContextoHttp();
await verificarNavegacionInversaMonitores();
await verificarSuperficieEjs();

console.log(
  '[agentes] OK acciones de señal: conteo backend, filtro exacto y creación contextual'
);

async function verificarConteoAgrupado() {
  let consulta = null;
  const repositorio = new RepositorioReglasDerivacionTelemetria({
    async consultar(sql, parametros) {
      consulta = { sql, parametros };
      return [{ senal_id: 11, total: 3 }];
    }
  });

  const conteos = await repositorio.contarPorSenalesDeAgente(7, [11, 12, 11]);

  assert.equal(conteos.get(11), 3);
  assert.equal(conteos.get(12), 0);
  assert.match(consulta.sql, /r\.agente_id = \?/);
  assert.match(consulta.sql, /r\.senal_id IN \(\?, \?\)/);
  assert.deepEqual(consulta.parametros, [7, 11, 12]);
}

async function verificarContratoTarjetas() {
  let objetivoConteo = null;
  const servicio = new ServicioAdministracionAgentesPortal({
    servicioLecturaTelemetriaAgentes: {
      async construirLecturaAgente() {
        return {
          agente: { id: 7, nombre: 'Agente' },
          catalogoSenales: [],
          filtros: { senalId: null },
          presentacion: {
            senalesActuales: [
              { senalId: 11, titulo: 'Temperatura' },
              { senalId: 12, titulo: 'Puerta' }
            ],
            historico: { observaciones: [] }
          }
        };
      }
    },
    repositorioReglasDerivacionTelemetria: {
      async contarPorSenalesDeAgente(agenteId, senalIds) {
        objetivoConteo = { agenteId, senalIds };
        return new Map([[11, 3], [12, 0]]);
      }
    }
  });
  servicio.construirContextoPolGraficoTelemetria = async () => null;
  servicio.construirDatosGraficoTelemetria = () => ({ observaciones: [] });
  servicio.construirDescripcionAlcance = () => ({ nivelScope: 'portal' });

  const vista = await servicio.construirVistaTelemetria({}, 7);

  assert.deepEqual(objetivoConteo, { agenteId: 7, senalIds: [11, 12] });
  assert.deepEqual(
    vista.presentacion.senalesActuales.map((senal) => senal.totalInterpretaciones),
    [3, 0]
  );
}

async function verificarContextoHttp() {
  let opciones = null;
  let render = null;
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: {
      async construirVistaOperativaReglasAgente(_contexto, agenteId, recibidas) {
        opciones = { agenteId, ...recibidas };
        return {
          agente: { id: agenteId, nombre: 'Agente' },
          reglas: [],
          resumen: {},
          filtroSenal: { id: recibidas.senalId, codigoSenal: 'temperatura' }
        };
      },
      async listarSenalesCatalogadas() {
        return { senales: [] };
      }
    }
  });
  const respuesta = {
    render(vista, datos) { render = { vista, datos }; }
  };

  await controlador.mostrarListado({
    params: { id: '7' },
    query: { agente_id: '7', senal_id: '11' },
    contextoUsuarioActual: {},
    session: {}
  }, respuesta, (error) => { throw error; });

  assert.deepEqual(opciones, { agenteId: 7, senalId: 11 });
  assert.equal(render.vista, 'portal/agente-reglas');
  assert.equal(render.datos.filtroSenal.id, 11);

  let errorContexto = null;
  await controlador.mostrarListado({
    params: { id: '7' },
    query: { agente_id: '8', senal_id: '11' },
    contextoUsuarioActual: {},
    session: {}
  }, respuesta, (error) => { errorContexto = error; });
  assert.match(errorContexto.message, /no coincide con la ruta/);
}

async function verificarNavegacionInversaMonitores() {
  const retornoRegla = '/agentes/7/reglas/31?return_to=%2Fagentes%2F7%2Freglas';
  assert.equal(
    ControladorMonitores.prototype.normalizarRetornoListado(retornoRegla),
    retornoRegla
  );
  assert.equal(
    ControladorMonitores.prototype.normalizarRetornoListado('/agentes/7/reglas/31/externo'),
    null
  );
  let consultaConteo = null;
  const repositorio = new RepositorioMonitores({
    async consultar(sql, parametros) {
      consultaConteo = { sql, parametros };
      return [{ total: 4 }];
    }
  });
  const total = await repositorio.contarFiltradoVisible(
    { nivelScope: 'portal' },
    {
      tipo: 'telemetria',
      agenteTelemetriaId: 7,
      senalTelemetriaId: 11,
      reglaTelemetriaId: 31
    }
  );

  assert.equal(total, 4);
  assert.match(consultaConteo.sql, /vmt\.monitor_id = m\.id/);
  assert.match(consultaConteo.sql, /vmt\.regla_id = \?/);
  assert.match(consultaConteo.sql, /rdt\.agente_id = \?/);
  assert.match(consultaConteo.sql, /rdt\.senal_id = \?/);
  assert.deepEqual(consultaConteo.parametros, ['telemetria', 31, 7, 11]);

  let objetivoConteo = null;
  let render = null;
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: {
      async construirDetalleOperativo() {
        return {
          agente: { id: 7, nombre: 'Agente' },
          regla: { id: 31, agenteId: 7, senal: { id: 11 } },
          revisiones: []
        };
      }
    },
    servicioMonitores: {
      async contarMonitoresVisiblesPorRegla(_contexto, objetivo) {
        objetivoConteo = objetivo;
        return 4;
      }
    }
  });

  await controlador.mostrarDetalle({
    params: { id: '7', reglaId: '31' },
    contextoUsuarioActual: { permisos: { verMonitores: true } },
    session: {}
  }, {
    render(vista, datos) { render = { vista, datos }; }
  }, (error) => { throw error; });

  assert.deepEqual(objetivoConteo, { agenteId: 7, senalId: 11, reglaId: 31 });
  assert.equal(render.vista, 'portal/agente-regla-detalle');
  assert.equal(render.datos.totalMonitoresVisibles, 4);
}

async function verificarSuperficieEjs() {
  const [telemetria, reglas, detalle, monitores, controladorMonitores] = await Promise.all([
    leer('apps/sentinelia-web/src/views/portal/agente-telemetria.ejs'),
    leer('apps/sentinelia-web/src/views/portal/agente-reglas.ejs'),
    leer('apps/sentinelia-web/src/views/portal/agente-regla-detalle.ejs'),
    leer('apps/sentinelia-web/src/views/portal/monitores.ejs'),
    leer('apps/sentinelia-web/src/controladores/ControladorMonitores.js')
  ]);

  assert.match(telemetria, /Ver interpretaciones \(<%= totalInterpretaciones %>\)/);
  assert.match(telemetria, /Crear interpretación/);
  assert.match(telemetria, /Ver reglas/);
  assert.match(telemetria, /agente_id=\$\{encodeURIComponent\(agente\.id\)\}/);
  assert.match(telemetria, /senal_id=\$\{encodeURIComponent\(senal\.senalId\)\}/);
  assert.match(telemetria, /crear=1#crear-interpretacion/);
  assert.match(reglas, /Señal: <%= filtroSenalActual\.codigoSenal %>/);
  assert.match(reglas, /retornoListadoReglas/);
  assert.match(reglas, /Number\(filtroSenalActual\?\.id\) === Number\(senal\.id\)/);
  assert.match(detalle, /Ver <%= totalMonitoresVisibles === 1 \? 'monitor vinculado' : 'monitores vinculados' %>/);
  assert.match(detalle, /Crear monitor/);
  assert.match(detalle, /Relaciones cruzadas/);
  assert.match(detalle, /agente_id=\$\{encodeURIComponent\(agente\.id\)\}/);
  assert.match(detalle, /senal_id=\$\{encodeURIComponent\(regla\.senal\.id\)\}/);
  assert.match(detalle, /regla_id=\$\{encodeURIComponent\(regla\.id\)\}/);
  assert.match(monitores, /Mostrando exclusivamente los monitores vinculados/);
  assert.match(monitores, /data-regla-telemetria-id/);
  assert.match(controladorMonitores, /telemetria_agente_id: requisicion\.query\.agente_id/);
  assert.match(controladorMonitores, /telemetria_tipo_fuente: requisicion\.query\.regla_id/);
}

async function leer(ruta) {
  return readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');
}
