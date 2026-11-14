import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import {
  ServicioAdministracionFederacionPortal
} from '../paquetes/federacion/aplicacion/ServicioAdministracionFederacionPortal.js';

const INSTALACION = `sfid1.instalacion.${'A'.repeat(21)}Q`;
const ARRANQUE = `sfid1.arranque.${'B'.repeat(21)}g`;
const RELACION = `sfid1.relacion.${'C'.repeat(21)}w`;
const REVISION_OFERTA = `sfid1.revision_concesion.${'D'.repeat(21)}A`;
const REVISION_ACEPTACION = `sfid1.revision_concesion.${'E'.repeat(21)}Q`;
const REVISION_EFECTIVA = `sfid1.revision_concesion.${'F'.repeat(21)}g`;
const REVISION_NUEVA = `sfid1.revision_concesion.${'G'.repeat(21)}w`;

await verificarPrevisualizacionYConfirmacion();
await verificarComposicion();
console.log(
  '[federacion] OK 5.22.18c: selectores=tipados impacto=previo ' +
  'revision=inmutable autoridad=SQL reduccion-mixta=inmediata'
);

async function verificarPrevisualizacionYConfirmacion() {
  const relacion = crearRelacion();
  let entradaRegistrada = null;
  const servicio = crearServicio({
    listarVisibles: async () => [relacion],
    revisarDeclaracion: async (entrada) => {
      entradaRegistrada = entrada;
      return { estado: 'revisada', ordinal: 2 };
    }
  });
  const contexto = contextoUsuario();
  const seleccionMixta = {
    activa: true,
    nivelesScope: ['empresa', 'sitio'],
    familias: {
      monitores: {
        campos: ['monitores'],
        permiteContenidoSensible: false,
        permiteRefederacion: false
      },
      telemetria: {
        campos: ['telemetria'],
        permiteContenidoSensible: false,
        permiteRefederacion: true
      }
    }
  };
  const previa = await servicio.previsualizarRevisionConcesion({
    contextoUsuarioActual: contexto,
    relacionId: RELACION,
    seleccion: seleccionMixta
  });
  assert.equal(previa.claseCambio, 'mixta');
  assert.equal(
    previa.impacto.conducta,
    'retiradaInmediataPendienteConsolidacion'
  );
  assert.ok(previa.impacto.incorporaciones.includes('familia:telemetria'));
  assert.ok(previa.impacto.retiradas.includes('campo:monitores:credencialPropia'));
  assert.ok(previa.impacto.retiradasEfectivas.includes('refederacion:monitores'));

  const resultado = await servicio.confirmarRevisionConcesion({
    contextoUsuarioActual: contexto,
    relacionId: RELACION,
    token: previa.token,
    previsualizacion: previa
  });
  assert.equal(resultado.ordinal, 2);
  assert.equal(entradaRegistrada.papel, 'oferta');
  assert.equal(entradaRegistrada.revisionId, REVISION_NUEVA);
  assert.deepEqual(entradaRegistrada.declaracion.toJSON(), seleccionMixta);
  assert.equal(entradaRegistrada.autoridadActualLocal.toJSON().activa, true);
  assert.equal(entradaRegistrada.responsableUsuarioId, '7');

  await assert.rejects(
    servicio.previsualizarRevisionConcesion({
      contextoUsuarioActual: contexto,
      relacionId: RELACION,
      seleccion: relacion.concesion.oferta.seleccion
    }),
    /no cambia/u
  );
  const previaObsoleta = await servicio.previsualizarRevisionConcesion({
    contextoUsuarioActual: contexto,
    relacionId: RELACION,
    seleccion: seleccionMixta
  });
  relacion.concesion.revision = '9';
  await assert.rejects(
    servicio.confirmarRevisionConcesion({
      contextoUsuarioActual: contexto,
      relacionId: RELACION,
      token: previaObsoleta.token,
      previsualizacion: previaObsoleta
    }),
    /cambió desde la previsualización/u
  );
  relacion.concesion.revision = '4';
  await assert.rejects(
    servicio.previsualizarRevisionConcesion({
      contextoUsuarioActual: { ...contexto, impersonacionActiva: true },
      relacionId: RELACION,
      seleccion: seleccionMixta
    }),
    /sesión humana directa/u
  );
  await assert.rejects(
    servicio.previsualizarRevisionConcesion({
      contextoUsuarioActual: contexto,
      relacionId: RELACION,
      seleccion: { ...seleccionMixta, nivelesScope: ['tenant'] }
    }),
    /dentro de tu autoridad/u
  );
}

async function verificarComposicion() {
  const [vista, rutas, controlador, repositorioControl, repositorioRelaciones,
    manifiesto] = await Promise.all([
    leer('../apps/sentinelia-web/src/views/portal/federacion.ejs'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioRelacionesFederacionSql.js'),
    leer('../paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js')
  ]);
  ejs.compile(vista, { filename: 'portal/federacion.ejs' });
  assert.match(vista, /Impacto antes de registrar la concesión/u);
  assert.match(vista, /Permitir refederación conservando procedencia y recorrido/u);
  assert.match(vista, /Autorizar campo sensible/u);
  assert.match(rutas, /concesion\/previsualizar/u);
  assert.match(rutas, /concesion\/confirmar/u);
  assert.match(controlador, /previsualizacionConcesionFederacion/u);
  assert.match(repositorioControl, /\['reduccion', 'mixta'\]\.includes\(claseCambio\)/u);
  assert.match(repositorioControl, /exigirResponsableRevisionActual/u);
  assert.match(repositorioControl, /FROM usuarios WHERE id=\? FOR UPDATE/u);
  assert.match(repositorioRelaciones, /revision_efectiva_actual_id/u);
  assert.match(manifiesto, /concesion\/confirmar'[\s\S]*federacion\.concesion_revisada/u);
}

function crearServicio({ listarVisibles, revisarDeclaracion }) {
  const verdadero = () => true;
  return new ServicioAdministracionFederacionPortal({
    repositorioRelaciones: {
      crearRecepcion: async () => ({}),
      listarVisibles
    },
    servicioInvitaciones: { emitir: async () => ({}), revocar: async () => ({}) },
    servicioConfirmacionIdentidad: { confirmar: async () => ({}) },
    servicioContinuidad: {
      emitirRecuperacion: async () => ({}),
      aprobarLocalizacion: async () => ({})
    },
    servicioControl: { revisarDeclaracion },
    servicioAutorizacion: {
      puedeAccederFederacion: verdadero,
      puedeConfigurarEmisionesFederacion: verdadero,
      puedeConfigurarRecepcionesFederacion: verdadero,
      puedeGestionarCredencialesFederacion: verdadero,
      puedeActivarRelacionesFederacion: verdadero,
      puedeTransferirResponsabilidadFederacion: verdadero,
      puedeResolverConflictosFederacion: verdadero,
      puedeVerDiagnosticoFederacion: verdadero,
      esSesionDirecta: (contexto) => !contexto.impersonacionActiva
    },
    generadorIdentidades: { generar: () => REVISION_NUEVA },
    installationId: INSTALACION,
    bootId: ARRANQUE
  });
}

function crearRelacion() {
  const seleccion = {
    activa: true,
    nivelesScope: ['empresa', 'sitio'],
    familias: {
      monitores: {
        campos: ['credencialPropia', 'monitores'],
        permiteContenidoSensible: true,
        permiteRefederacion: true
      }
    }
  };
  return {
    relacionId: RELACION,
    direccion: 'emision',
    estadoCiclo: 'vinculada',
    estadoAutoridad: 'autorizada',
    estadoIdentidad: 'valida',
    estadoCompatibilidad: 'compatible',
    responsableUsuarioId: '7',
    scope: { tenantId: '1', empresaId: '2', sitioId: null },
    versionAutoridad: '3',
    concesion: {
      revision: '4',
      oferta: { revisionId: REVISION_OFERTA, ordinal: 1, seleccion },
      aceptacion: { revisionId: REVISION_ACEPTACION, ordinal: 1, seleccion },
      efectiva: {
        revisionId: REVISION_EFECTIVA,
        ordinal: 1,
        seleccion: { ...seleccion, vacia: false }
      }
    }
  };
}

function contextoUsuario() {
  return {
    idUsuario: 7,
    tenantId: 1,
    empresaId: 2,
    sitioId: null,
    impersonacionActiva: false
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
