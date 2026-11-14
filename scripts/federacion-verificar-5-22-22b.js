import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION as BLOQUEOS,
  ErrorConfiguracionFederacion,
  PERFIL_CAPACIDADES_CONFIGURACION_FEDERACION,
  VERSION_CAPACIDADES_CONFIGURACION_FEDERACION,
  normalizarConfiguracionFederacion,
  proyectarCapacidadesConfiguracionFederacion
} from '../paquetes/federacion/src/index.js';

await main();

async function main() {
  verificarCatalogo();
  verificarMatrizCapacidades();
  verificarValidacionDeValoresPresentes();
  await verificarFronteraYRegistro();
  console.log(
    '[federacion] OK 5.22.22b: activacion=global emision=independiente ' +
    'recepcion=preparacion_calculada bloqueos=estables nucleo=puro'
  );
}

function verificarCatalogo() {
  assert.equal(VERSION_CAPACIDADES_CONFIGURACION_FEDERACION, 1);
  assert.equal(
    PERFIL_CAPACIDADES_CONFIGURACION_FEDERACION,
    'sentinelia-federacion-capacidades-configuracion-v1'
  );
  assert.deepEqual(BLOQUEOS, {
    FEDERACION_DESACTIVADA: 'federacionDesactivada',
    ORIGEN_PUBLICO_AUSENTE: 'origenPublicoAusente',
    PROXIES_CONFIABLES_AUSENTES: 'proxiesConfiablesAusentes'
  });
  assert.equal(Object.isFrozen(BLOQUEOS), true);
}

function verificarMatrizCapacidades() {
  verificarCaso(
    {},
    false,
    false,
    [BLOQUEOS.FEDERACION_DESACTIVADA],
    [
      BLOQUEOS.FEDERACION_DESACTIVADA,
      BLOQUEOS.ORIGEN_PUBLICO_AUSENTE,
      BLOQUEOS.PROXIES_CONFIABLES_AUSENTES
    ]
  );
  verificarCaso(
    { activacionFederacion: true },
    true,
    false,
    [],
    [
      BLOQUEOS.ORIGEN_PUBLICO_AUSENTE,
      BLOQUEOS.PROXIES_CONFIABLES_AUSENTES
    ]
  );
  verificarCaso(
    {
      activacionFederacion: true,
      origenPublico: 'https://receptor.example.invalid'
    },
    true,
    false,
    [],
    [BLOQUEOS.PROXIES_CONFIABLES_AUSENTES]
  );
  verificarCaso(
    {
      activacionFederacion: true,
      proxiesConfiables: ['192.0.2.1/32']
    },
    true,
    false,
    [],
    [BLOQUEOS.ORIGEN_PUBLICO_AUSENTE]
  );
  verificarCaso(
    {
      activacionFederacion: true,
      origenPublico: 'https://receptor.example.invalid',
      proxiesConfiables: ['192.0.2.1/32']
    },
    true,
    true,
    [],
    []
  );
}

function verificarCaso(
  entrada,
  emisionDisponible,
  recepcionPreparada,
  bloqueosEmision,
  bloqueosRecepcion
) {
  const normalizada = normalizarConfiguracionFederacion(entrada);
  const capacidades = proyectarCapacidadesConfiguracionFederacion(normalizada);
  assert.deepEqual(capacidades, {
    perfil: PERFIL_CAPACIDADES_CONFIGURACION_FEDERACION,
    version: VERSION_CAPACIDADES_CONFIGURACION_FEDERACION,
    activacionGlobal: normalizada.activacionFederacion,
    emisionDisponible,
    recepcionPreparada,
    bloqueos: {
      emision: bloqueosEmision,
      recepcion: bloqueosRecepcion
    }
  });
  assert.equal(Object.isFrozen(capacidades), true);
  assert.equal(Object.isFrozen(capacidades.bloqueos), true);
  assert.equal(Object.isFrozen(capacidades.bloqueos.emision), true);
  assert.equal(Object.isFrozen(capacidades.bloqueos.recepcion), true);
  assert.deepEqual(
    proyectarCapacidadesConfiguracionFederacion(normalizada),
    capacidades
  );
}

function verificarValidacionDeValoresPresentes() {
  assert.throws(
    () => normalizarConfiguracionFederacion({
      activacionFederacion: true,
      origenPublico: 'http://receptor.example.invalid'
    }),
    (error) => error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'origen_publico_invalido'
  );
  assert.throws(
    () => normalizarConfiguracionFederacion({
      activacionFederacion: true,
      proxiesConfiables: ['*']
    }),
    (error) => error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'proxy_confiable_invalido'
  );
}

async function verificarFronteraYRegistro() {
  const nucleo = await leer('../paquetes/federacion/src/ConfiguracionFederacion.js');
  assert.doesNotMatch(
    nucleo,
    /from\s+['"](?:mysql2?|redis|express|proxy-addr|node:)/u
  );
  assert.doesNotMatch(
    nucleo,
    /origen_publico_requerido|proxy_confiable_requerido/u
  );
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
