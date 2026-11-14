import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  EvaluadorCondicionesDerivacionTelemetria,
  crearCondicionTipadaDerivacionTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import {
  formatearValorPresentacionTelemetria
} from '../paquetes/agentes/src/PresentacionTelemetriaAgentes.js';
import {
  ProcesadorTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js';
import {
  ProyectorEvaluacionesDerivadasTelemetria
} from '../paquetes/agentes/src/ProyectorEvaluacionesDerivadasTelemetria.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import {
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  ServicioLecturaTelemetriaAgentes
} from '../paquetes/agentes/src/ServicioLecturaTelemetriaAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  verificarRepresentacionesAnterioresIntactas();

  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    '5.24.2 necesita una conexión SQL real para recorrer todos los consumidores.'
  );
  const baseDatos = `sentinelia_fixture_5242_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });

  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.verificarUsoHorarioUtc();

    const agente = await crearAgente(sql);
    const resultado = await verificarConsumidoresTemporales(sql, agente);

    console.log(
      '[agentes] OK 5.24.2: consumidores=historial_fotografia_presentacion ' +
      'evaluacion_calidad=duracion_momento_utc estado_evento=JSON ' +
      `trabajos=${resultado.trabajosProcesados} graficas=temporales_abiertas`
    );
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarConsumidoresTemporales(sql, agente) {
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const observaciones = new RepositorioObservacionesTelemetriaAgentes(sql);
  const fotografia = new RepositorioEstadoActualTelemetriaAgentes(sql);
  const reglas = new RepositorioReglasDerivacionTelemetria(sql);
  const trabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const estadosEvaluados =
    new RepositorioEstadoActualEvaluacionReglasTelemetria(sql);
  const eventos = new RepositorioEventosDerivadosTelemetria(sql);

  const senalDuracion = await catalogo.guardarDeclaracionSenal({
    agenteId: agente.id,
    definicion: {
      categoria: 'copias',
      clave: 'duracion',
      tipoDato: 'duracion',
      unidad: 's',
      nombreHumano: 'Duración de la copia'
    }
  });
  const senalMomento = await catalogo.guardarDeclaracionSenal({
    agenteId: agente.id,
    definicion: {
      categoria: 'copias',
      clave: 'siguiente',
      tipoDato: 'momento_utc',
      nombreHumano: 'Siguiente copia'
    }
  });
  assert.equal(senalDuracion.unidad, null);
  assert.equal(senalMomento.unidad, null);

  const reglaDuracion = await crearReglaCalidad({
    reglas,
    agente,
    senal: senalDuracion
  });
  const reglaMomento = await crearReglaCalidad({
    reglas,
    agente,
    senal: senalMomento
  });
  const inicioRevisionMs = Math.max(
    new Date(reglaDuracion.revisionVigente.vigenteDesdeUtc).getTime(),
    new Date(reglaMomento.revisionVigente.vigenteDesdeUtc).getTime()
  );
  const recibidoEnUtc = new Date(
    inicioRevisionMs + 1
  ).toISOString();
  const lote = await observaciones.insertarLoteAceptado({
    agenteId: agente.id,
    senalesCatalogadas: [senalDuracion, senalMomento],
    recibidoEnUtc,
    observacionesAceptadas: [
      crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: 'copias',
        clave: 'duracion',
        tipoDato: 'duracion',
        unidad: '',
        valorDuracion: 3723.4567,
        calidad: 'estimada',
        observadoEnUtc: '2026-08-25T10:00:00Z'
      }),
      crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: 'copias',
        clave: 'siguiente',
        tipoDato: 'momento_utc',
        valorMomentoUtc: '2030-01-02T03:04:05Z',
        calidad: 'estimada',
        observadoEnUtc: '2026-08-25T10:00:01Z'
      })
    ]
  });
  assert.equal(lote.totalInsertadas, 2);
  await fotografia.aplicarObservacionesHistoricas(lote.insertadas);

  await verificarLecturaYPresentacion({
    agente,
    catalogo,
    observaciones,
    fotografia,
    senalDuracion,
    senalMomento
  });

  for (const [observacion, regla] of [
    [lote.insertadas[0], reglaDuracion],
    [lote.insertadas[1], reglaMomento]
  ]) {
    assert.ok(
      new Date(observacion.recibidoEnUtc).getTime() >=
        new Date(regla.revisionVigente.vigenteDesdeUtc).getTime(),
      `La observación ${observacion.id} debe quedar dentro de la vigencia ` +
      `${regla.revisionVigente.vigenteDesdeUtc} <= ${observacion.recibidoEnUtc}.`
    );
  }

  await trabajos.encolar({
    observacion: lote.insertadas[0],
    regla: reglaDuracion.regla,
    revision: reglaDuracion.revisionVigente
  });
  await trabajos.encolar({
    observacion: lote.insertadas[1],
    regla: reglaMomento.regla,
    revision: reglaMomento.revisionVigente
  });

  const demoraHastaReclamable = Math.max(
    0,
    new Date(recibidoEnUtc).getTime() - Date.now() + 10
  );
  if (demoraHastaReclamable > 0) {
    await new Promise((resolve) => setTimeout(resolve, demoraHastaReclamable));
  }

  const reclamadoPor = 'verificador-telemetria-5.24.2';
  const reclamados = await trabajos.reclamarSiguientes({
    reclamadoPor,
    limite: 10,
    ttlSegundos: 30
  });
  assert.equal(reclamados.length, 2);
  const procesador = new ProcesadorTrabajosEvaluacionTelemetria({
    repositorioTrabajos: trabajos,
    repositorioReglas: reglas,
    repositorioObservaciones: observaciones,
    repositorioCatalogoSenales: catalogo,
    proyectorEvaluaciones: new ProyectorEvaluacionesDerivadasTelemetria({
      repositorioEstadoActual: estadosEvaluados,
      repositorioEventosDerivados: eventos
    }),
    evaluador: new EvaluadorCondicionesDerivacionTelemetria()
  });
  const procesados = [];
  for (const trabajo of reclamados) {
    procesados.push(await procesador.procesar({ trabajo, reclamadoPor }));
  }
  assert.equal(procesados.every(({ ok }) => ok), true);

  await verificarEfectosEvaluados({
    estadosEvaluados,
    eventos,
    reglaDuracion,
    reglaMomento
  });

  return { trabajosProcesados: procesados.length };
}

async function verificarLecturaYPresentacion({
  agente,
  catalogo,
  observaciones,
  fotografia,
  senalDuracion,
  senalMomento
}) {
  const servicio = new ServicioLecturaTelemetriaAgentes({
    servicioProvisionamientoAgentes: {
      async listarAgentesVisibles() {
        return [agente];
      }
    },
    repositorioCatalogoSenales: catalogo,
    repositorioEstadoActual: fotografia,
    repositorioObservaciones: observaciones
  });
  const contexto = {
    nivelScope: 'sitio',
    tenantId: agente.tenantId,
    empresaId: agente.empresaId,
    sitioId: agente.sitioId
  };
  const lecturaDuracion = await servicio.construirLecturaAgente(
    contexto,
    agente.id,
    {
      senalId: senalDuracion.id,
      compararSenalIds: [senalMomento.id],
      limite: 10,
      orden: 'asc'
    }
  );
  const duracionActual = lecturaDuracion.fotografiaActual.find(
    ({ senalId }) => Number(senalId) === Number(senalDuracion.id)
  );
  assert.equal(duracionActual.valorDuracion, 3723.4567);
  assert.equal(lecturaDuracion.historico.observaciones[0].valorDuracion, 3723.4567);
  const tarjetaDuracion = lecturaDuracion.presentacion.senalesActuales.find(
    ({ senalId }) => Number(senalId) === Number(senalDuracion.id)
  );
  assert.equal(tarjetaDuracion.valor.tipoDato, 'duracion');
  assert.equal(tarjetaDuracion.valor.valorBruto, 3723.4567);
  assert.equal(tarjetaDuracion.valor.texto, '1 h 2 min');
  assert.equal(tarjetaDuracion.valor.textoCompleto, '3723.4567 s');
  assert.equal(tarjetaDuracion.aptaVisualizacionTemporal, true);
  assert.equal(lecturaDuracion.presentacion.historico.tieneSerieTemporal, true);
  assert.equal(lecturaDuracion.presentacion.historico.tipoSerieTemporal, 'duracion');
  assert.equal(lecturaDuracion.comparacion.habilitada, false);
  assert.equal(lecturaDuracion.comparacion.senalesRechazadas.length, 1);

  const lecturaMomento = await servicio.construirLecturaAgente(
    contexto,
    agente.id,
    { senalId: senalMomento.id, limite: 10, orden: 'asc' }
  );
  const momentoActual = lecturaMomento.fotografiaActual.find(
    ({ senalId }) => Number(senalId) === Number(senalMomento.id)
  );
  assert.equal(momentoActual.valorMomentoUtc, '2030-01-02T03:04:05Z');
  assert.equal(
    lecturaMomento.historico.observaciones[0].valorMomentoUtc,
    '2030-01-02T03:04:05Z'
  );
  const tarjetaMomento = lecturaMomento.presentacion.senalesActuales.find(
    ({ senalId }) => Number(senalId) === Number(senalMomento.id)
  );
  assert.equal(tarjetaMomento.valor.tipoDato, 'momento_utc');
  assert.equal(tarjetaMomento.valor.valorBruto, '2030-01-02T03:04:05Z');
  assert.equal(tarjetaMomento.valor.textoCompleto, '2030-01-02T03:04:05Z');
  assert.equal(tarjetaMomento.aptaVisualizacionTemporal, true);
  assert.equal(lecturaMomento.presentacion.historico.tieneSerieTemporal, true);
  assert.equal(lecturaMomento.presentacion.historico.tipoSerieTemporal, 'momento_utc');

  const miniaturaDuracion = await servicio.consultarMuestraSenal(
    contexto,
    agente.id,
    { senalId: senalDuracion.id }
  );
  assert.equal(miniaturaDuracion.senal.tipoDato, 'duracion');
  assert.equal(miniaturaDuracion.observaciones[0].valorDuracion, 3723.4567);
  const miniaturaMomento = await servicio.consultarMuestraSenal(
    contexto,
    agente.id,
    { senalId: senalMomento.id }
  );
  assert.equal(miniaturaMomento.senal.tipoDato, 'momento_utc');
  assert.equal(
    miniaturaMomento.observaciones[0].valorMomentoUtc,
    '2030-01-02T03:04:05Z'
  );
}

async function verificarEfectosEvaluados({
  estadosEvaluados,
  eventos,
  reglaDuracion,
  reglaMomento
}) {
  const casos = [
    {
      regla: reglaDuracion,
      tipoDato: 'duracion',
      valor: 3723.4567
    },
    {
      regla: reglaMomento,
      tipoDato: 'momento_utc',
      valor: '2030-01-02T03:04:05Z'
    }
  ];

  for (const caso of casos) {
    const estado = await estadosEvaluados.buscarPorRegla(caso.regla.regla.id);
    assert.equal(estado.resultado, 'coincide');
    assert.equal(estado.tipoDato, caso.tipoDato);
    assert.deepEqual(estado.valorEvaluado, caso.valor);
    assert.equal(estado.evidenciaContextual.senalCatalogada.tipoDato, caso.tipoDato);
    const eventosRegla = await eventos.listarPorRegla(caso.regla.regla.id);
    assert.equal(eventosRegla.length, 1);
    assert.equal(eventosRegla[0].tipoDato, caso.tipoDato);
    assert.deepEqual(eventosRegla[0].valorEvaluado, caso.valor);
  }
}

async function crearReglaCalidad({ reglas, agente, senal }) {
  const condicion = crearCondicionTipadaDerivacionTelemetria({
    senal,
    tipo: 'calidad',
    operador: '=',
    calidadEsperada: 'estimada'
  });
  return reglas.crearConRevisionInicial({
    agenteId: agente.id,
    senalId: senal.id,
    tenantId: agente.tenantId,
    empresaId: agente.empresaId,
    sitioId: agente.sitioId,
    revision: {
      condicion,
      severidadCalculada: 'advertencia',
      mensajeOperativo: `La calidad temporal de ${senal.codigoSenal} requiere atención.`,
      nombre: `Calidad de ${senal.codigoSenal}`,
      descripcion: null,
      metadatos: null
    }
  });
}

async function crearAgente(sql) {
  const alias = `fixture-5242-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    ['Tenant 5.24.2', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [tenant.insertId, 'Empresa 5.24.2', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24.2', alias]
  );
  const guid = randomUUID();
  const [resultado] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid, tenant_id, empresa_id, sitio_id, nombre, secreto_hash
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guid,
      tenant.insertId,
      empresa.insertId,
      sitio.insertId,
      'Agente consumidores temporales 5.24.2',
      'hash-no-utilizable'
    ]
  );
  return {
    id: Number(resultado.insertId),
    guid,
    nombre: 'Agente consumidores temporales 5.24.2',
    tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId),
    sitioId: Number(sitio.insertId),
    estadoAdministrativo: 'activo',
    estadoAcceso: 'habilitado',
    estadoVidaPol: 'sin_datos',
    estadoEfectivo: 'sin_datos'
  };
}

function verificarRepresentacionesAnterioresIntactas() {
  const casos = [
    [
      { tipoDato: 'numero', valorNumero: 5, unidad: '%' },
      { texto: '5 %', valorBruto: 5, unidad: '%', esJson: false, detalleJson: null,
        aptaVisualizacionTemporal: true }
    ],
    [
      { tipoDato: 'booleano', valorBooleano: false },
      { texto: 'No', valorBruto: false, unidad: null, esJson: false,
        detalleJson: null, aptaVisualizacionTemporal: true }
    ],
    [
      { tipoDato: 'texto', valorTexto: 'copia completa' },
      { texto: 'copia completa', valorBruto: 'copia completa', unidad: null,
        esJson: false, detalleJson: null, aptaVisualizacionTemporal: false }
    ],
    [
      { tipoDato: 'estado', valorEstado: 'disponible' },
      { texto: 'disponible', valorBruto: 'disponible', unidad: null,
        esJson: false, detalleJson: null, aptaVisualizacionTemporal: false }
    ],
    [
      { tipoDato: 'json', valorJson: { copias: 2 } },
      { texto: '{\n  "copias": 2\n}', valorBruto: { copias: 2 }, unidad: null,
        esJson: true, detalleJson: '{\n  "copias": 2\n}',
        aptaVisualizacionTemporal: false }
    ]
  ];

  for (const [lectura, esperado] of casos) {
    const valor = formatearValorPresentacionTelemetria(lectura);
    assert.deepEqual(
      {
        texto: valor.texto,
        valorBruto: valor.valorBruto,
        unidad: valor.unidad,
        esJson: valor.esJson,
        detalleJson: valor.detalleJson,
        aptaVisualizacionTemporal: valor.aptaVisualizacionTemporal
      },
      esperado
    );
  }
}
