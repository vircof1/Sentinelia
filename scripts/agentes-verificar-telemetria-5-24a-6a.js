import assert from 'node:assert/strict';

import {
  ServicioAdministracionReglasDerivacionTelemetria
} from '../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.6a exige SQL real.');
  const sql = new ClienteSql(configuracion.sql);
  try {
    await sql.verificarUsoHorarioUtc();
    await verificarLecturaYPrevisualizacion(sql);
  } finally {
    await sql.cerrar();
  }
  console.log(
    '[agentes] OK 5.24a.6a: lectura=MNDSL resultado=autoritativo ' +
    'programacion=estado_no_trabajo preview=N_sql fotografia=opcional ' +
    'permisos=existentes alta_publica=cerrada'
  );
}

async function verificarLecturaYPrevisualizacion(sql) {
  const instanteSql = async () => {
    const filas = await sql.consultar('SELECT UTC_TIMESTAMP(0) AS ahora_utc');
    return filas[0].ahora_utc;
  };
  const ahoraInicial = new Date(await instanteSql());
  const momentoUtc = new Date(ahoraInicial.getTime() + 120_000).toISOString();
  const proximaFronteraUtc = new Date(ahoraInicial.getTime() + 30_000).toISOString();
  const condicion = {
    tipo: 'momento_utc_relativo',
    version: 1,
    configuracion: {
      forma: 'limite_superior',
      limite: { direccion: 'futuro', segundos: '90' },
      histeresisSegundos: '5'
    }
  };
  const agente = entidad({ id: 11, tenantId: 1, empresaId: 2, sitioId: 3,
    nombre: 'Agente temporal' });
  const senal = entidad({ id: 22, agenteId: 11, tipoDato: 'momento_utc',
    categoria: 'copias', clave: 'proxima', unidad: null });
  const regla = reglaEntidad({ condicion });
  const estado = entidad({
    resultado: 'coincide',
    ladoAtencion: 'superior',
    evaluadoEnUtc: ahoraInicial.toISOString(),
    proximaReevaluacionUtc: proximaFronteraUtc,
    evidenciaContextual: {
      temporal: {
        momentoUtc,
        ahoraUtc: ahoraInicial.toISOString(),
        desviacionSegundos: '120',
        motivoProgramacion: 'salida_histeresis_superior'
      }
    }
  });
  const llamadasPermiso = { ver: 0, modificar: 0 };
  const fotografia = entidad({
    ultimaObservacionId: 33,
    valorMomentoUtc: momentoUtc,
    calidad: 'valida',
    observadoEnUtc: ahoraInicial.toISOString(),
    recibidoEnUtc: ahoraInicial.toISOString()
  });
  let consultasReloj = 0;
  const servicio = new ServicioAdministracionReglasDerivacionTelemetria({
    repositorioAgentes: {
      async buscarPorId(id) { return Number(id) === 11 ? agente : null; }
    },
    repositorioCatalogoSenales: {
      async listarPorAgente() { return [senal]; },
      async buscarPorId(id) { return Number(id) === 22 ? senal : null; }
    },
    repositorioReglas: {
      async listarPorAgente() { return [regla]; },
      async buscarPorId(id) { return Number(id) === 44 ? regla : null; },
      async listarRevisionesPorRegla() { return []; }
    },
    repositorioEstadoActualEvaluacion: {
      async buscarPorRegla() { return estado; }
    },
    repositorioEventosDerivados: {
      async listarPorRegla() { return []; }
    },
    repositorioTrabajosEvaluacion: {
      async buscarUltimoPorRegla() {
        return entidad({ id: 999, estado: 'pendiente', programadoParaUtc: '2099-01-01T00:00:00.000Z' });
      },
      async buscarUltimoErrorPorRegla() { return null; }
    },
    repositorioEstadoActualTelemetria: {
      async buscarPorSenalId() { return fotografia; }
    },
    politicaPermisosAgentes: {
      assertPuedeVer() { llamadasPermiso.ver += 1; },
      assertPuedeModificar() { llamadasPermiso.modificar += 1; },
      puedeAlcanzarAgente() { return true; }
    },
    permitirPrevisualizacionMomentoUtcRelativo: true,
    leerAhoraUtcSql: async () => {
      consultasReloj += 1;
      return instanteSql();
    }
  });

  const vista = await servicio.construirVistaOperativaReglasAgente({}, 11);
  const lectura = vista.reglas[0].interpretacionTemporalRelativa;
  assert.deepEqual(
    [lectura.familia, lectura.momentoUtc, lectura.ahoraUtc,
      lectura.desviacionSegundos, lectura.ladoAtencion, lectura.resultado],
    ['relativa', momentoUtc, ahoraInicial.toISOString(), '120', 'superior', 'coincide']
  );
  assert.deepEqual(lectura.programacion, {
    estado: 'programada',
    motivo: 'salida_histeresis_superior',
    proximaFronteraUtc
  });
  assert.notEqual(
    lectura.programacion.proximaFronteraUtc,
    vista.reglas[0].ultimoTrabajo.programadoParaUtc,
    'La programación administrativa no se deduce de un trabajo cualquiera.'
  );
  const detalle = await servicio.construirDetalleOperativo({}, 44);
  assert.deepEqual(
    detalle.regla.interpretacionTemporalRelativa,
    lectura,
    'Listado y detalle deben exponer la misma lectura autoritativa.'
  );

  const preview = await servicio.previsualizarCondicion({}, {
    agenteId: 11,
    senalId: 22,
    condicion,
    muestraTexto: null
  });
  assert.equal(preview.condicionCanonica,
    '{"configuracion":{"forma":"limite_superior","histeresisSegundos":"5",' +
    '"limite":{"direccion":"futuro","segundos":"90"}},' +
    '"tipo":"momento_utc_relativo","version":1}');
  assert.equal(preview.previsualizacionTemporalRelativa.disponible, true);
  assert.equal(preview.previsualizacionTemporalRelativa.momentoUtc, momentoUtc);
  assert.equal(consultasReloj, 1);
  assert.ok(
    Math.abs(Date.parse(preview.previsualizacionTemporalRelativa.ahoraUtc) - Date.now()) < 5_000,
    'La previsualización debe usar el presente de MariaDB.'
  );

  servicio.repositorioEstadoActualTelemetria.buscarPorSenalId = async () => null;
  const sinFotografia = await servicio.previsualizarCondicion({}, {
    agenteId: 11, senalId: 22, condicion, muestraTexto: null
  });
  assert.equal(sinFotografia.previsualizacionTemporalRelativa.disponible, false);
  assert.equal(
    sinFotografia.previsualizacionTemporalRelativa.motivo,
    'sin_fotografia_vigente'
  );
  assert.equal(sinFotografia.previsualizacionTemporalRelativa.familia, 'relativa');
  assert.equal(consultasReloj, 1, 'Sin M no se consulta N innecesariamente.');
  assert.ok(llamadasPermiso.ver > 0 && llamadasPermiso.modificar === 2);

  await assert.rejects(
    servicio.crearRegla({}, {
      agenteId: 11,
      senalId: 22,
      revision: {
        nombre: 'No activar', descripcion: null, severidadCalculada: 'advertencia',
        mensajeOperativo: 'No activar', metadatos: {}, condicion
      }
    }),
    /todavía no está habilitada/
  );
}

function reglaEntidad({ condicion }) {
  const serializada = {
    id: 44,
    agenteId: 11,
    senalId: 22,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    estado: 'activa',
    revisionVigente: { id: 55, condicion }
  };
  return {
    regla: { ...serializada, revisionVigente: undefined },
    revisionVigente: serializada.revisionVigente,
    serializar() { return structuredClone(serializada); }
  };
}

function entidad(datos) {
  return {
    ...datos,
    serializar() { return structuredClone(datos); }
  };
}
