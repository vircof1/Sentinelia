import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import {
  ServicioAdministracionReglasDerivacionTelemetria
} from '../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js';
import {
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  ControladorReglasDerivacionTelemetria
} from '../apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js';
import {
  presentarCondicionReglaTelemetria
} from '../apps/sentinelia-web/src/servicios/presentarCondicionReglaTelemetria.js';

const raiz = new URL('../', import.meta.url);

async function main() {
  const vista = await verificarLecturaOperativa();
  await verificarLecturaTrabajos();
  await verificarAdaptacionHttpTipada();
  await verificarSuperficieWeb(vista);
  await verificarFronterasEstructurales();
  console.log('[agentes-telemetria] OK lectura operativa y UI verificadas hasta 5.20a.10');
}

async function verificarLecturaOperativa() {
  const agente = entidad({
    id: 7,
    nombre: 'Agente térmico',
    tenantId: 1,
    empresaId: 2,
    sitioId: 3
  });
  const senal = entidad({
    id: 23,
    agenteId: 7,
    codigoSenal: 'temperatura',
    nombreHumano: 'Temperatura',
    tipoDato: 'numero',
    unidad: 'ºC'
  });
  const revision = entidad({
    id: 101,
    reglaId: 31,
    numero: 1,
    nombre: 'Temperatura elevada',
    descripcion: 'Detecta temperatura elevada.',
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera de tolerancia.',
    condicion: { tipo: 'numero', version: 1, configuracion: { operador: '>', umbral: 80, unidad: 'ºC' } },
    condicionCanonica: '{"configuracion":{"operador":">","umbral":80,"unidad":"ºC"},"tipo":"numero","version":1}',
    vigenteDesdeUtc: '2026-07-20T10:00:00.000Z',
    vigenteHastaUtc: null
  });
  const regla = {
    regla: {
      id: 31,
      agenteId: 7,
      senalId: 23,
      tenantId: 1,
      empresaId: 2,
      sitioId: 3,
      estado: 'activa',
      revisionVigenteId: 101
    },
    revisionVigente: revision,
    serializar() {
      return {
        ...this.regla,
        revisionVigente: revision.serializar(),
        fechaCreacion: '2026-07-20T10:00:00.000Z',
        fechaActualizacion: '2026-07-20T10:00:00.000Z'
      };
    }
  };
  const estado = entidad({
    id: 201,
    reglaId: 31,
    revisionId: 101,
    observacionId: 501,
    agenteId: 7,
    senalId: 23,
    resultado: 'coincide',
    codigoMotivo: 'condicion_cumplida',
    explicacion: 'El valor 95 supera el umbral 80.',
    condicionCanonica: revision.condicionCanonica,
    valorEvaluado: 95,
    tipoDato: 'numero',
    unidad: 'ºC',
    calidad: 'valida',
    observadoEnUtc: '2026-07-20T10:05:00.000Z'
  });
  const evento = entidad({
    ...estado.serializar(),
    id: 301,
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera de tolerancia.',
    creadoEnUtc: '2026-07-20T10:05:01.000Z'
  });
  const trabajo = entidad({
    id: 401,
    reglaId: 31,
    observacionId: 501,
    estado: 'completado',
    intentos: 1,
    fechaActualizacion: '2026-07-20T10:05:01.000Z'
  });
  const error = entidad({
    id: 400,
    reglaId: 31,
    observacionId: 500,
    estado: 'error',
    intentos: 2,
    ultimoCodigoError: 'evaluacion_fallida',
    ultimoMensajeError: 'Fallo técnico conservado.',
    siguienteIntentoUtc: '2026-07-20T10:04:00.000Z',
    fechaActualizacion: '2026-07-20T10:03:00.000Z'
  });
  const servicio = new ServicioAdministracionReglasDerivacionTelemetria({
    repositorioAgentes: { async buscarPorId(id) { return Number(id) === 7 ? agente : null; } },
    repositorioCatalogoSenales: {
      async buscarPorId(id) { return Number(id) === 23 ? senal : null; },
      async listarPorAgente(id) { return Number(id) === 7 ? [senal] : []; }
    },
    repositorioReglas: {
      async listarPorAgente(id) { return Number(id) === 7 ? [regla] : []; },
      async buscarPorId(id) { return Number(id) === 31 ? regla : null; },
      async listarRevisionesPorRegla(id) { return Number(id) === 31 ? [revision] : []; }
    },
    repositorioEstadoActualEvaluacion: { async buscarPorRegla() { return estado; } },
    repositorioEventosDerivados: { async listarPorRegla() { return [evento]; } },
    repositorioTrabajosEvaluacion: {
      async buscarUltimoPorRegla() { return trabajo; },
      async buscarUltimoErrorPorRegla() { return error; }
    }
  });
  const contexto = contextoSitio({ verAgentes: true, modificarAgentes: true });
  const vista = await servicio.construirVistaOperativaReglasAgente(contexto, 7);
  const detalle = await servicio.construirDetalleOperativo(contexto, 31);

  assert.equal(vista.resumen.totalReglas, 1);
  assert.equal(vista.resumen.coincidentes, 1);
  assert.equal(vista.resumen.conErrorTecnico, 1);
  assert.equal(vista.reglas[0].eventosRecientes[0].revisionId, 101);
  assert.equal(vista.reglas[0].eventosRecientes[0].observacionId, 501);
  assert.equal(detalle.revisiones[0].id, 101);
  assert.ok(Object.isFrozen(vista));
  const reglaModificable = await servicio.asegurarReglaPerteneceAgenteParaModificar(
    contexto,
    31,
    7
  );
  assert.equal(reglaModificable.agenteId, 7);
  await assert.rejects(
    () => servicio.asegurarReglaPerteneceAgenteParaModificar(
      contextoSitio({ verAgentes: true }),
      31,
      7
    ),
    /permiso para modificar agentes/
  );
  await assert.rejects(
    () => servicio.asegurarReglaPerteneceAgenteParaModificar(contexto, 31, 8),
    /no pertenece al agente indicado/
  );
  await assert.rejects(
    () => servicio.construirVistaOperativaReglasAgente(
      contextoSitio({ verAgentes: true }, { sitioId: 99 }),
      7
    ),
    /dentro de tu alcance/
  );

  return {
    ...vista,
    catalogoSenales: [
      { ...senal.serializar(), unidadSoloLectura: true, admiteCondicionValor: true, admiteCondicionCalidad: true }
    ],
    detalle
  };
}

async function verificarLecturaTrabajos() {
  const consultas = [];
  const repositorio = new RepositorioTrabajosEvaluacionTelemetria({
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      return [];
    }
  });
  assert.equal(await repositorio.buscarUltimoPorRegla(31), null);
  assert.equal(await repositorio.buscarUltimoErrorPorRegla(31), null);
  assert.match(consultas[0].sql, /WHERE t\.regla_id = \?/);
  assert.doesNotMatch(consultas[0].sql, /ultimo_codigo_error IS NOT NULL/);
  assert.match(consultas[1].sql, /ultimo_codigo_error IS NOT NULL/);
  assert.match(consultas[1].sql, /ORDER BY t\.fecha_actualizacion DESC, t\.id DESC/);
  assert.deepEqual(consultas[1].parametros, [31]);
}

async function verificarAdaptacionHttpTipada() {
  let orden = null;
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: {
      async previsualizarCondicion(_contexto, datos) {
        orden = datos;
        return { condicionCanonica: '{"tipo":"numero"}' };
      }
    }
  });
  const respuesta = {
    codigo: 200,
    payload: null,
    status(codigo) { this.codigo = codigo; return this; },
    json(payload) { this.payload = payload; }
  };
  await controlador.previsualizarCondicion(
    {
      params: { id: '7' },
      contextoUsuarioActual: contextoSitio({ modificarAgentes: true }),
      body: {
        senal_id: '23',
        condicion_tipo: 'numero',
        operador: '>',
        umbral: '80'
      }
    },
    respuesta
  );
  assert.equal(respuesta.payload.ok, true);
  assert.equal(orden.agenteId, 7);
  assert.equal(orden.senalId, 23);
  assert.deepEqual(orden.condicion, {
    tipo: 'numero',
    version: 1,
    operador: '>',
    umbral: 80
  });
}

async function verificarSuperficieWeb(vista) {
  const comunes = {
    usuarioActual: { usuario: 'verificador', nombreVisible: 'Verificador' },
    tokenCSRFPortal: 'csrf_verificacion',
    contextoUsuarioActual: contextoSitio({
      ver: true,
      verAgentes: true,
      modificarAgentes: true
    }),
    queryActual: {},
    tiposMonitorNavegacion: [],
    nombrePortalVisible: 'Sentinelia',
    capacidadesPortal: {},
    flashReglasTelemetria: null
  };
  const listado = await ejs.renderFile(
    new URL('apps/sentinelia-web/src/views/portal/agente-reglas.ejs', raiz).pathname,
    {
      ...comunes,
      titulo: 'Reglas de interpretación',
      rutaActual: '/agentes/7/reglas',
      agente: vista.agente,
      reglas: vista.reglas.map((regla) => ({
        ...regla,
        condicionLegible: presentarCondicionReglaTelemetria(regla.revisionVigente?.condicion)
      })),
      resumen: vista.resumen,
      catalogoSenales: vista.catalogoSenales,
      monitoresPorRegla: null,
      retornoReglas: '/agentes'
    }
  );
  const detalle = await ejs.renderFile(
    new URL('apps/sentinelia-web/src/views/portal/agente-regla-detalle.ejs', raiz).pathname,
    {
      ...comunes,
      titulo: 'Detalle de regla',
      rutaActual: '/agentes/7/reglas/31',
      puedeVerMonitores: false,
      totalMonitoresVisibles: 0,
      ...vista.detalle,
      revisiones: vista.detalle.revisiones.map((revision) => ({
        ...revision,
        condicionLegible: presentarCondicionReglaTelemetria(revision.condicion)
      }))
    }
  );
  assert.match(listado, /Coincidencias recientes/);
  assert.match(listado, /Regla #31/);
  assert.match(listado, /Lectura #501/);
  assert.match(listado, /no alertas/);
  assert.match(listado, /Requiere atención cuando/);
  assert.match(listado, /Definición técnica/);
  assert.match(detalle, /Última lectura evaluada/);
  assert.match(detalle, /Ver diagnóstico técnico/);
  assert.match(detalle, /Ver condición técnica/);
  assert.match(detalle, /El valor es mayor que 80 ºC/);
  const fechaTemporal = '2026-09-29T21:30:00Z';
  const detalleTemporal = await ejs.renderFile(
    new URL('apps/sentinelia-web/src/views/portal/agente-regla-detalle.ejs', raiz).pathname,
    {
      ...comunes,
      titulo: 'Detalle de regla temporal',
      rutaActual: '/agentes/7/reglas/31',
      puedeVerMonitores: false,
      totalMonitoresVisibles: 0,
      ...vista.detalle,
      regla: {
        ...vista.detalle.regla,
        senal: { ...vista.detalle.regla.senal, tipoDato: 'momento_utc' },
        estadoActual: { ...vista.detalle.regla.estadoActual, valorEvaluado: fechaTemporal },
        interpretacionTemporalRelativa: {
          resumenHumano: 'La fecha es anterior a ahora menos 1 día.',
          resultado: 'no_coincide',
          momentoUtc: fechaTemporal,
          ahoraUtc: '2026-09-27T21:48:03Z',
          desviacionSegundos: 171717,
          ladoAtencion: null,
          proximaFronteraUtc: '2026-09-30T21:30:00Z',
          programacion: { estado: 'programada', motivo: null }
        }
      },
      revisiones: vista.detalle.revisiones.map((revision) => ({
        ...revision,
        condicionLegible: presentarCondicionReglaTelemetria(revision.condicion)
      }))
    }
  );
  assert.match(detalleTemporal, /Situación respecto al presente/);
  assert.match(detalleTemporal, /Próxima frontera/);
  assert.match(detalleTemporal, /data-fecha-utc="2026-09-29T21:30:00Z"/);
  assert.match(detalleTemporal, /Ver diagnóstico técnico/);
  assert.match(detalle, /Historial de versiones/);
  assert.match(detalle, /evaluaciones anteriores no cambiarán/i);
  assert.match(listado, /data-fecha-utc="2026-07-20T10:05:00\.000Z"/);
  for (const fechaUtc of [
    '2026-07-20T10:00:00.000Z',
    '2026-07-20T10:04:00.000Z',
    '2026-07-20T10:05:00.000Z',
    '2026-07-20T10:05:01.000Z'
  ]) {
    assert.ok(detalle.includes(`data-fecha-utc="${fechaUtc}"`));
  }
  assert.doesNotMatch(listado, /5\.20a|reglas? derivadas?/i);
  assert.doesNotMatch(detalle, /5\.20a|eventos? derivados?/i);
  assert.match(detalle, /csrf_verificacion/);
}

async function verificarFronterasEstructurales() {
  const [rutas, controlador, javascript] = await Promise.all([
    leer('apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js'),
    leer('apps/sentinelia-web/src/public/js/agente-reglas.js')
  ]);
  assert.match(rutas, /requerirVerAgentes[\s\S]*mostrarListado/);
  assert.match(rutas, /requerirModificarAgentes[\s\S]*crearRegla/);
  assert.match(controlador, /previsualizarCondicion/);
  assert.match(javascript, /condicionCanonica/);
  assert.doesNotMatch(
    controlador,
    /alertas_activas|dispararTrigger|actualizarPol|DELETE\s+FROM/i
  );
}

function entidad(datos) {
  return {
    ...datos,
    serializar() {
      const { serializar: _serializar, ...copia } = this;
      return JSON.parse(JSON.stringify(copia));
    }
  };
}

function contextoSitio(permisos, scope = {}) {
  return {
    esOperadorSistema: false,
    nivelScope: 'sitio',
    tenantId: scope.tenantId ?? 1,
    empresaId: scope.empresaId ?? 2,
    sitioId: scope.sitioId ?? 3,
    permisos
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, raiz), 'utf8');
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando UI operativa 5.20a.10');
  console.error(error);
  process.exit(1);
});
