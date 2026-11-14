import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  ServicioIngestaTelemetriaAgentes
} from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import {
  TIPOS_DATO_TELEMETRIA_AGENTE
} from '../paquetes/agentes/src/TelemetriaAgente.js';

async function main() {
  const clienteSql = new ClienteSqlCatalogoFalso();
  const repositorio = new RepositorioCatalogoSenalesTelemetriaAgentes(clienteSql);

  await verificarAltaDeSenal(repositorio, clienteSql);
  await verificarActualizacionDescriptiva(repositorio, clienteSql);
  await verificarListadoYBusqueda(repositorio);
  await verificarRechazoCambioIncompatible(repositorio, clienteSql);
  await verificarIntegracionDominioCatalogo(repositorio);
  await verificarCatalogoGlobalIncompatibleNoAborta(repositorio);
  await verificarFalloInfraestructuraNoSeDisfraza();
  await verificarContratoSqlEmitido(clienteSql);

  console.log('[agentes-telemetria] OK: catálogo e integración verificados.');
}

async function verificarAltaDeSenal(repositorio, clienteSql) {
  const senal = await repositorio.guardarDeclaracionSenal({
    agenteId: 7,
    definicion: {
      categoria: 'sistema',
      clave: 'cpu',
      tag: 'socket0',
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
      unidad: '%',
      nombreHumano: 'CPU socket 0',
      descripcion: 'Uso de CPU principal.',
      metadatos: {
        origen: 'prueba'
      }
    },
    declaradaEnUtc: '2026-07-07T10:00:00Z'
  });

  assert.equal(senal.id, 1);
  assert.equal(senal.agenteId, 7);
  assert.equal(senal.codigoSenal, 'sistema.cpu:socket0');
  assert.equal(senal.unidad, '%');
  assert.deepEqual(senal.metadatos, { origen: 'prueba' });
  assert.equal(clienteSql.filas[0].tag, 'socket0');
}

async function verificarActualizacionDescriptiva(repositorio, clienteSql) {
  const actualizada = await repositorio.guardarDeclaracionSenal({
    agenteId: 7,
    definicion: {
      categoria: 'sistema',
      clave: 'cpu',
      tag: 'socket0',
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
      unidad: '%',
      nombreHumano: 'Uso CPU socket 0',
      descripcion: 'Lectura declarada por el agente.',
      metadatos: {
        detalle: '4 cores visibles'
      }
    },
    declaradaEnUtc: '2026-07-07T10:05:00Z'
  });

  assert.equal(actualizada.id, 1);
  assert.equal(actualizada.nombreHumano, 'Uso CPU socket 0');
  assert.equal(actualizada.descripcion, 'Lectura declarada por el agente.');
  assert.deepEqual(actualizada.metadatos, { detalle: '4 cores visibles' });
  assert.equal(
    contarFilasPorIdentidad(clienteSql, {
      agenteId: 7,
      categoria: 'sistema',
      clave: 'cpu',
      tag: 'socket0'
    }),
    1,
    'Actualizar una señal no debe duplicar su identidad estable.'
  );

  const sinMetadatos = await repositorio.guardarDeclaracionSenal({
    agenteId: 7,
    definicion: {
      categoria: 'sistema',
      clave: 'cpu',
      tag: 'socket0',
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
      unidad: '%'
    }
  });

  assert.equal(sinMetadatos.nombreHumano, 'Uso CPU socket 0');
  assert.equal(sinMetadatos.descripcion, 'Lectura declarada por el agente.');
  assert.deepEqual(sinMetadatos.metadatos, { detalle: '4 cores visibles' });
}

async function verificarListadoYBusqueda(repositorio) {
  await repositorio.guardarDeclaracionSenal({
    agenteId: 7,
    definicion: {
      categoria: 'sistema',
      clave: 'ram',
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
      unidad: '%'
    }
  });

  const listado = await repositorio.listarPorAgente(7);
  assert.equal(listado.length, 2);
  assert.deepEqual(
    listado.map((senal) => senal.codigoSenal),
    ['sistema.cpu:socket0', 'sistema.ram']
  );

  const encontrada = await repositorio.buscarPorIdentidad({
    agenteId: 7,
    categoria: 'sistema',
    clave: 'ram'
  });
  assert.equal(encontrada.codigoSenal, 'sistema.ram');
  assert.equal(encontrada.tag, null);
}

async function verificarRechazoCambioIncompatible(repositorio, clienteSql) {
  await assert.rejects(
    () =>
      repositorio.guardarDeclaracionSenal({
        agenteId: 7,
        definicion: {
          categoria: 'sistema',
          clave: 'cpu',
          tag: 'socket0',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'ºC'
        }
      }),
    /tipo de dato o unidad distinta/
  );

  await assert.rejects(
    () =>
      repositorio.guardarDeclaracionSenal({
        agenteId: 7,
        definicion: {
          categoria: 'sistema',
          clave: 'cpu',
          tag: 'socket0',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO
        }
      }),
    /tipo de dato o unidad distinta/
  );

  const filaCpu = clienteSql.filas.find(
    (fila) =>
      fila.agente_id === 7 &&
      fila.categoria === 'sistema' &&
      fila.clave === 'cpu' &&
      fila.tag === 'socket0'
  );
  assert.equal(filaCpu.unidad, '%');
  assert.equal(filaCpu.tipo_dato, TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO);
}

async function verificarIntegracionDominioCatalogo(repositorio) {
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: repositorio,
    generarRequestId: () => 'req_catalogo_integracion',
    reloj: () => new Date('2026-07-07T10:20:00Z')
  });

  const sinCatalogoPrevio = await servicio.prepararLote({
    agenteId: 7,
    lote: {
      observaciones: [
        {
          categoria: 'aplicacion',
          clave: 'latencia',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'ms',
          observadoEnUtc: '2026-07-07T10:15:00Z',
          valorNumero: 12
        }
      ]
    }
  });
  assert.equal(sinCatalogoPrevio.resultado.ok, true);
  assert.equal(sinCatalogoPrevio.resultado.aceptadas, 1);
  assert.equal(sinCatalogoPrevio.senalesCatalogadas.length, 1);
  assert.equal(
    sinCatalogoPrevio.senalesCatalogadas[0].codigoSenal,
    'aplicacion.latencia'
  );
  assert.equal(sinCatalogoPrevio.senalesCatalogadas[0].unidad, 'ms');

  await assert.rejects(
    () =>
      servicio.prepararLote({
        agenteId: 7,
        lote: {
          observaciones: [
            {
              categoria: 'aplicacion',
              clave: 'latencia',
              tag: 'recuperada',
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
              unidad: 'ms',
              observadoEnUtc: '2026-07-07T10:00:00Z',
              valorNumero: 18
            }
          ]
        }
      }),
    /emitidoEnUtc.*observaciones diferidas/
  );

  const diferidoConMarcaEmision = await servicio.prepararLote({
    agenteId: 7,
    lote: {
      emitidoEnUtc: '2026-07-07T10:20:00Z',
      observaciones: [
        {
          categoria: 'aplicacion',
          clave: 'latencia',
          tag: 'recuperada',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'ms',
          observadoEnUtc: '2026-07-07T10:00:00Z',
          valorNumero: 18
        }
      ]
    }
  });
  assert.equal(diferidoConMarcaEmision.resultado.ok, true);
  assert.equal(
    diferidoConMarcaEmision.lote.emitidoEnUtc,
    '2026-07-07T10:20:00.000Z'
  );

  const conDefinicionEmbebida = await servicio.prepararLote({
    agenteId: 7,
    lote: {
      emitidoEnUtc: '2026-07-07T10:16:00Z',
      observaciones: [
        {
          categoria: 'energia',
          clave: 'consumo',
          tag: 'linea-a',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'W',
          observadoEnUtc: '2026-07-07T10:16:00Z',
          valorNumero: 120.5,
          definicionSenal: {
            categoria: 'energia',
            clave: 'consumo',
            tag: 'linea-a',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'W',
            nombreHumano: 'Consumo línea A'
          }
        }
      ]
    }
  });
  assert.equal(conDefinicionEmbebida.resultado.ok, true);
  assert.equal(conDefinicionEmbebida.senalesCatalogadas.length, 1);
  assert.equal(conDefinicionEmbebida.senalesCatalogadas[0].codigoSenal, 'energia.consumo:linea-a');

  const catalogoGlobal = await servicio.prepararLote({
    agenteId: 7,
    lote: {
      catalogo: {
        senales: [
          {
            categoria: 'almacenamiento',
            clave: 'disco',
            tag: 'sda',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: '%',
            nombreHumano: 'Disco principal'
          }
        ]
      },
      observaciones: [
        {
          categoria: 'almacenamiento',
          clave: 'disco',
          tag: 'sda',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: '%',
          observadoEnUtc: '2026-07-07T10:17:00Z',
          valorNumero: 71
        }
      ]
    }
  });
  assert.equal(catalogoGlobal.resultado.ok, true);
  assert.equal(catalogoGlobal.senalesCatalogadas.length, 1);
  assert.equal(catalogoGlobal.senalesCatalogadas[0].codigoSenal, 'almacenamiento.disco:sda');

  const catalogoDuplicado = await servicio.prepararLote({
    agenteId: 7,
    lote: {
      catalogo: {
        senales: [
          {
            categoria: 'red',
            clave: 'latencia',
            tag: 'wan',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ms'
          }
        ]
      },
      observaciones: [
        {
          categoria: 'red',
          clave: 'latencia',
          tag: 'wan',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'ms',
          observadoEnUtc: '2026-07-07T10:17:30Z',
          valorNumero: 32,
          definicionSenal: {
            categoria: 'red',
            clave: 'latencia',
            tag: 'wan',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ms'
          }
        }
      ]
    }
  });
  assert.equal(catalogoDuplicado.resultado.ok, true);
  assert.equal(
    catalogoDuplicado.senalesCatalogadas.length,
    1,
    'La misma señal declarada en catálogo y observación no debe duplicarse.'
  );

  const parcial = await servicio.prepararLote({
    agenteId: 7,
    lote: {
      observaciones: [
        {
          categoria: 'energia',
          clave: 'consumo',
          tag: 'linea-a',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'W',
          observadoEnUtc: '2026-07-07T10:18:00Z',
          valorNumero: 122
        },
        {
          categoria: 'energia',
          clave: 'consumo',
          tag: 'linea-a',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'kWh',
          observadoEnUtc: '2026-07-07T10:18:00Z',
          valorNumero: 1.2
        }
      ]
    }
  });
  assert.equal(parcial.resultado.ok, false);
  assert.equal(parcial.resultado.resultado, 'parcial');
  assert.equal(parcial.resultado.aceptadas, 1);
  assert.equal(parcial.resultado.rechazadas, 1);
  assert.equal(parcial.resultado.errores[0].indice, 1);
  assert.match(parcial.resultado.errores[0].message, /unidad distinta/);

  const parcialPorTipo = await servicio.prepararLote({
    agenteId: 7,
    lote: {
      observaciones: [
        {
          categoria: 'energia',
          clave: 'consumo',
          tag: 'linea-a',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO,
          observadoEnUtc: '2026-07-07T10:19:00Z',
          valorTexto: 'ciento veintidos'
        }
      ]
    }
  });
  assert.equal(parcialPorTipo.resultado.ok, false);
  assert.equal(parcialPorTipo.resultado.resultado, 'rechazado');
  assert.equal(parcialPorTipo.resultado.aceptadas, 0);
  assert.equal(parcialPorTipo.resultado.rechazadas, 1);
  assert.match(parcialPorTipo.resultado.errores[0].message, /tipo de dato|unidad distinta/);
}

async function verificarCatalogoGlobalIncompatibleNoAborta(repositorio) {
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: repositorio,
    generarRequestId: () => 'req_catalogo_global_parcial',
    reloj: () => new Date('2026-07-07T10:22:00Z')
  });

  const resultado = await servicio.prepararLote({
    agenteId: 7,
    lote: {
      catalogo: {
        senales: [
          {
            categoria: 'energia',
            clave: 'consumo',
            tag: 'linea-a',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'kWh'
          },
          {
            categoria: 'ambiente',
            clave: 'temperatura',
            tag: 'frigo-1',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ºC'
          }
        ]
      },
      observaciones: [
        {
          categoria: 'ambiente',
          clave: 'humedad',
          tag: 'frigo-1',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: '%',
          observadoEnUtc: '2026-07-07T10:22:00Z',
          valorNumero: 44
        }
      ]
    }
  });

  assert.equal(resultado.resultado.ok, false);
  assert.equal(resultado.resultado.resultado, 'parcial');
  assert.equal(resultado.resultado.aceptadas, 1);
  assert.equal(resultado.resultado.rechazadas, 0);
  assert.equal(resultado.erroresCatalogo.length, 1);
  assert.equal(resultado.erroresCatalogo[0].campo, 'catalogo.senales.0');
  assert.equal(resultado.senalesCatalogadas.length, 2);
  assert.deepEqual(
    resultado.senalesCatalogadas.map((senal) => senal.codigoSenal).sort(),
    ['ambiente.humedad:frigo-1', 'ambiente.temperatura:frigo-1']
  );
}

async function verificarFalloInfraestructuraNoSeDisfraza() {
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: {
      async buscarPorIdentidad() {
        throw new Error('SQL no disponible: tipo de dato o unidad distinta');
      }
    },
    generarRequestId: () => 'req_fallo_sql',
    reloj: () => new Date('2026-07-07T10:25:00Z')
  });

  await assert.rejects(
    () =>
      servicio.prepararLote({
        agenteId: 7,
        lote: {
          observaciones: [
            {
              categoria: 'sistema',
              clave: 'cpu',
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
              unidad: '%',
              observadoEnUtc: '2026-07-07T10:25:00Z',
              valorNumero: 42
            }
          ]
        }
      }),
    /SQL no disponible/
  );
}

async function verificarContratoSqlEmitido(clienteSql) {
  const insercion = clienteSql.consultasEjecutadas.find((consulta) =>
    consulta.sql.includes('INSERT INTO senales_telemetria_agentes')
  );

  assert.ok(insercion, 'El repositorio debe emitir un INSERT de catálogo.');
  assert.ok(
    insercion.sql.includes('ON DUPLICATE KEY UPDATE'),
    'El alta de catálogo debe ser idempotente mediante upsert.'
  );
  assert.ok(
    insercion.sql.includes('LAST_INSERT_ID(id)'),
    'El upsert debe recuperar el id existente.'
  );
  assert.equal(
    insercion.parametros[3],
    'socket0',
    'El tag declarado se persiste como componente físico de identidad.'
  );

  const insercionSinTag = clienteSql.consultasEjecutadas.find(
    (consulta) =>
      consulta.sql.includes('INSERT INTO senales_telemetria_agentes') &&
      consulta.parametros[2] === 'ram'
  );
  assert.equal(
    insercionSinTag.parametros[3],
    '',
    'El tag opcional debe enviarse como cadena vacía para blindar la unicidad SQL.'
  );

  const contratoSql = await readFile(
    new URL('../migraciones/sql/0001_esquema_inicial.sql', import.meta.url),
    'utf8'
  );
  assert.match(
    contratoSql,
    /CHECK\s*\([\s\S]*metadatos_descriptivos[\s\S]*2048[\s\S]*\)/,
    'La tabla de catálogo debe limitar también en SQL el tamaño de metadatos.'
  );
}

class ClienteSqlCatalogoFalso {
  constructor() {
    this.filas = [];
    this.siguienteId = 1;
    this.consultasEjecutadas = [];
  }

  async ejecutar(sql, parametros = []) {
    this.consultasEjecutadas.push({ tipo: 'ejecutar', sql, parametros });

    if (sql.includes('INSERT INTO senales_telemetria_agentes')) {
      return [this.aplicarUpsert(parametros)];
    }

    throw new Error(`SQL de escritura no soportado por el cliente falso: ${sql}`);
  }

  async consultar(sql, parametros = []) {
    this.consultasEjecutadas.push({ tipo: 'consultar', sql, parametros });

    if (sql.includes('WHERE s.id = ?')) {
      return this.filas.filter((fila) => fila.id === Number(parametros[0]));
    }

    if (
      sql.includes('WHERE s.agente_id = ?') &&
      sql.includes('AND s.categoria = ?') &&
      sql.includes('AND s.clave = ?') &&
      sql.includes('AND s.tag = ?')
    ) {
      return this.filas.filter(
        (fila) =>
          fila.agente_id === Number(parametros[0]) &&
          fila.categoria === parametros[1] &&
          fila.clave === parametros[2] &&
          fila.tag === parametros[3]
      );
    }

    if (sql.includes('WHERE s.agente_id = ?')) {
      return this.filas
        .filter((fila) => fila.agente_id === Number(parametros[0]))
        .sort((a, b) =>
          `${a.categoria}\u0000${a.clave}\u0000${a.tag}\u0000${a.id}`.localeCompare(
            `${b.categoria}\u0000${b.clave}\u0000${b.tag}\u0000${b.id}`
          )
        );
    }

    throw new Error(`SQL de lectura no soportado por el cliente falso: ${sql}`);
  }

  aplicarUpsert([
    agenteId,
    categoria,
    clave,
    tag,
    codigoSenal,
    tipoDato,
    unidad,
    nombreHumano,
    descripcion,
    metadatosSerializados,
    declaradaEnUtc
  ]) {
    const existente = this.filas.find(
      (fila) =>
        fila.agente_id === Number(agenteId) &&
        fila.categoria === categoria &&
        fila.clave === clave &&
        fila.tag === tag
    );

    if (!existente) {
      const fila = {
        id: this.siguienteId++,
        agente_id: Number(agenteId),
        categoria,
        clave,
        tag,
        codigo_senal: codigoSenal,
        tipo_dato: tipoDato,
        unidad,
        nombre_humano: nombreHumano,
        descripcion,
        metadatos_descriptivos: metadatosSerializados,
        consolidada_en_utc: '2026-07-07 10:00:00',
        ultima_declaracion_utc: declaradaEnUtc || '2026-07-07 10:00:00',
        fecha_creacion: '2026-07-07 10:00:00',
        fecha_actualizacion: '2026-07-07 10:00:00'
      };
      this.filas.push(fila);
      return { insertId: fila.id, affectedRows: 1 };
    }

    if (existente.tipo_dato === tipoDato && existente.unidad === unidad) {
      existente.codigo_senal = codigoSenal;
      existente.nombre_humano = nombreHumano || existente.nombre_humano;
      existente.descripcion = descripcion || existente.descripcion;
      existente.metadatos_descriptivos =
        metadatosSerializados ?? existente.metadatos_descriptivos;
      existente.ultima_declaracion_utc =
        declaradaEnUtc || '2026-07-07 10:10:00';
      existente.fecha_actualizacion = '2026-07-07 10:10:00';
    }

    return { insertId: existente.id, affectedRows: 2 };
  }
}

function contarFilasPorIdentidad(
  clienteSql,
  {
    agenteId,
    categoria,
    clave,
    tag = ''
  }
) {
  return clienteSql.filas.filter(
    (fila) =>
      fila.agente_id === Number(agenteId) &&
      fila.categoria === categoria &&
      fila.clave === clave &&
      fila.tag === tag
  ).length;
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando catálogo');
  console.error(error);
  process.exit(1);
});
