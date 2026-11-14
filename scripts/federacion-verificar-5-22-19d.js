import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ProcesadorFlujoEmisionFederacionRuntime
} from '../apps/sentinelia-runtime/src/federacion/ProcesadorFlujoEmisionFederacionRuntime.js';
import {
  ServicioAdministracionFederacionPortal
} from '../paquetes/federacion/aplicacion/ServicioAdministracionFederacionPortal.js';
import {
  FuenteEntropiaCriptograficaNode
} from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const TOKEN = `sfop1_${'A'.repeat(64)}`;

await verificarMatrizHumanaCerrada();
await verificarFronterasSqlActuales();
await verificarBacklogSinAutoridadNoAlcanzaLaRed();

console.log(
  '[federacion] OK 5.22.19d: operaciones=clasificadas ' +
  'scope=SQL autoridad=actual responsable_perdido=corte_atomico ' +
  'impersonacion=sin_mutaciones backlog=sin_salida_no_autorizada'
);

async function verificarMatrizHumanaCerrada() {
  const fuente = await leer(
    '../paquetes/federacion/aplicacion/ServicioAdministracionFederacionPortal.js'
  );
  const inicioClase = fuente.indexOf('export class ServicioAdministracionFederacionPortal');
  const finClase = fuente.indexOf('\n}\n\nfunction ', inicioClase);
  assert.ok(inicioClase >= 0 && finClase > inicioClase);
  const cuerpoClase = fuente.slice(inicioClase, finClase);
  const metodosPublicos = [...cuerpoClase.matchAll(
    /^  (?:async )?([a-z][A-Za-z0-9]*)\([^)]*/gmu
  )].map((coincidencia) => coincidencia[1]).filter((nombre) => nombre !== 'constructor');
  assert.deepEqual(metodosPublicos, [
    'obtenerPanel',
    'previsualizarRevisionConcesion',
    'confirmarRevisionConcesion',
    'sincronizarConcesion',
    'crearRecepcion',
    'emitirInvitacion',
    'revocarInvitacion',
    'confirmarIdentidad',
    'emitirRecuperacion',
    'aprobarLocalizacion',
    'importarInvitacion',
    'importarRecuperacion',
    'transferirResponsabilidad',
    'deshabilitarRelacion',
    'eliminarRelacion',
    'resolverConflicto'
  ], 'Toda operación humana pública debe permanecer clasificada por esta matriz.');

  let mutaciones = 0;
  let lecturas = 0;
  const mutar = async () => { mutaciones += 1; return {}; };
  const relacion = relacionVisible();
  const repositorioRelaciones = {
    crearRecepcion: mutar,
    async listarVisibles() { lecturas += 1; return [relacion]; },
    async obtenerContextoTransferencia() {
      lecturas += 1;
      return {
        direccion: 'emision',
        scope: relacion.scope,
        responsable: {
          usuarioId: '8', activa: true, scope: relacion.scope, puedeConfigurar: true
        }
      };
    }
  };
  const autorizacion = new Proxy({
    esSesionDirecta: (contexto) => !contexto?.impersonacionActiva
  }, {
    get(objetivo, propiedad) {
      if (propiedad in objetivo) return objetivo[propiedad];
      return () => true;
    }
  });
  const servicio = new ServicioAdministracionFederacionPortal({
    repositorioRelaciones,
    servicioInvitaciones: { emitir: mutar, revocar: mutar },
    servicioConfirmacionIdentidad: { confirmar: mutar },
    servicioContinuidad: { emitirRecuperacion: mutar, aprobarLocalizacion: mutar },
    servicioImportacion: { importarInvitacion: mutar, importarRecuperacion: mutar },
    servicioControl: {
      revisarDeclaracion: mutar,
      transferirResponsabilidad: mutar,
      deshabilitarRelacion: mutar,
      eliminarRelacion: mutar
    },
    servicioSincronizacion: { sincronizar: mutar },
    servicioConflictos: { listarAbiertos: async () => [], resolver: mutar },
    servicioAutorizacion: autorizacion,
    generadorIdentidades: {
      generar(tipo) { return generador.generar(tipo); }
    },
    installationId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootId: generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)
  });
  const contexto = {
    idUsuario: 7,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    impersonacionActiva: true
  };

  const panel = await servicio.obtenerPanel(contexto);
  assert.equal(panel.relaciones.length, 1, 'La lectura conserva el scope efectivo.');
  assert.ok(lecturas > 0);

  const operacionesMutadoras = [
    () => servicio.previsualizarRevisionConcesion({
      contextoUsuarioActual: contexto,
      relacionId: relacion.relacionId,
      seleccion: relacion.concesion.oferta.seleccion
    }),
    () => servicio.confirmarRevisionConcesion({
      contextoUsuarioActual: contexto,
      relacionId: relacion.relacionId,
      token: 'previa',
      previsualizacion: {
        token: 'previa', relacionId: relacion.relacionId,
        expiraEnMs: Date.now() + 60_000
      }
    }),
    () => servicio.sincronizarConcesion({
      contextoUsuarioActual: contexto,
      relacionId: relacion.relacionId
    }),
    () => servicio.crearRecepcion(contexto),
    () => servicio.emitirInvitacion({
      contextoUsuarioActual: contexto, relacionId: relacion.relacionId
    }),
    () => servicio.revocarInvitacion({
      contextoUsuarioActual: contexto, relacionId: relacion.relacionId,
      invitacionId: 'invitacion'
    }),
    () => servicio.confirmarIdentidad({
      contextoUsuarioActual: contexto, relacionId: relacion.relacionId,
      installationRemotaId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      nombreRemotoDeclarado: 'remota'
    }),
    () => servicio.emitirRecuperacion({
      contextoUsuarioActual: contexto, relacionId: relacion.relacionId
    }),
    () => servicio.aprobarLocalizacion({
      contextoUsuarioActual: contexto, relacionId: relacion.relacionId,
      localizacionId: '01890f47-7cf5-7b00-8000-000000000001'
    }),
    () => servicio.importarInvitacion({
      contextoUsuarioActual: contexto, representacion: {}
    }),
    () => servicio.importarRecuperacion({
      contextoUsuarioActual: contexto, representacion: {}
    }),
    () => servicio.transferirResponsabilidad({
      contextoUsuarioActual: contexto, relacionId: relacion.relacionId,
      nuevoResponsableUsuarioId: '8'
    }),
    () => servicio.deshabilitarRelacion({
      contextoUsuarioActual: contexto, relacionId: relacion.relacionId
    }),
    () => servicio.eliminarRelacion({
      contextoUsuarioActual: contexto, relacionId: relacion.relacionId
    }),
    () => servicio.resolverConflicto({
      contextoUsuarioActual: contexto,
      incidenteId: 'incidente',
      installationClonNuevaId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      relacionesLegitimas: [], relacionesClon: [], relacionesNuevasClon: []
    })
  ];
  for (const operar of operacionesMutadoras) {
    await assert.rejects(
      Promise.resolve().then(operar),
      (error) => error?.codigo === 'FEDERACION_PERMISO_DENEGADO'
    );
  }
  assert.equal(mutaciones, 0, 'La impersonación no alcanza ningún puerto mutador.');
}

async function verificarFronterasSqlActuales() {
  const fuentes = await Promise.all(Object.entries({
    control: '../paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js',
    invitaciones: '../paquetes/federacion/adaptadores/RepositorioInvitacionesFederacionSql.js',
    continuidad: '../paquetes/federacion/adaptadores/RepositorioContinuidadFederacionSql.js',
    identidad: '../paquetes/federacion/adaptadores/RepositorioIdentidadesCandidatasFederacionSql.js',
    conflictos:
      '../paquetes/federacion/adaptadores/RepositorioConflictosIdentidadFederacionSql.js',
    sesiones: '../paquetes/federacion/adaptadores/RepositorioSesionesFederacionSql.js',
    entregas: '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js',
    procedencia: '../paquetes/federacion/adaptadores/RepositorioProcedenciaEmisionFederacionSql.js',
    explorador: '../paquetes/federacion/adaptadores/RepositorioExploradorDatosRemotosFederacionSql.js',
    usuarios: '../paquetes/usuarios/src/ServicioUsuarios.js',
    movimientos:
      '../paquetes/jerarquia-organizativa/src/ServicioMovimientosOrganizativosAuditable.js',
    eliminaciones:
      '../paquetes/jerarquia-organizativa/src/ServicioEliminacionesOrganizativasAuditable.js',
    reconstrucciones:
      '../paquetes/federacion/aplicacion/ServicioReconstruccionesManualesFederacion.js',
    reconstruccionesPortal:
      '../apps/sentinelia-web/src/servicios/ServicioReconstruccionesFederacionPortal.js',
    alertasRemotas:
      '../apps/sentinelia-web/src/servicios/ServicioAlertasRemotasPortal.js',
    avisosPlataforma:
      '../apps/sentinelia-web/src/servicios/ServicioPresentacionAvisosPlataforma.js',
    bootstrap: '../apps/sentinelia-runtime/src/BootstrapRuntime.js'
  }).map(async ([nombre, ruta]) => [nombre, await leer(ruta)]));
  const f = Object.fromEntries(fuentes);

  assert.match(f.control, /exigirResponsableRevisionActual/u);
  assert.match(f.control, /exigirOperadorControlActual/u);
  assert.match(f.control, /FROM usuarios WHERE id=\? FOR UPDATE/u);
  assert.match(f.invitaciones, /exigirRelacionReceptoraAutorizada/u);
  assert.match(f.invitaciones, /exigirGestorInvitacionActual/u);
  assert.match(f.continuidad, /exigirGestorHumano/u);
  assert.match(f.identidad, /responsable_usuario_id/u);
  assert.match(f.identidad, /estado_autoridad/u);
  assert.match(f.conflictos, /exigirOperadorPortal/u);
  assert.match(f.conflictos, /permiso_resolver_conflictos_federacion/u);
  assert.match(f.conflictos, /FROM usuarios WHERE id=\? FOR UPDATE/u);
  assert.match(f.sesiones, /estado_autoridad/u);
  assert.match(f.entregas, /exigirDestinoOperativo/u);
  assert.match(f.entregas, /estadoAutoridad !== 'autorizada'/u);
  assert.match(f.procedencia, /r\.estado_autoridad='autorizada'/u);
  assert.match(f.procedencia, /revision_efectiva_actual_id/u);
  assert.match(f.explorador, /scope_tenant_id/u);
  assert.match(f.explorador, /scope_empresa_id/u);
  assert.match(f.explorador, /scope_sitio_id/u);
  assert.match(f.usuarios, /reevaluarAutoridadUsuarioEnTransaccion/u);
  assert.match(f.usuarios, /cortarDependenciasEnTransaccion/u);
  assert.match(f.movimientos, /cortarDependenciasEnTransaccion/u);
  assert.match(f.eliminaciones, /cortarDependenciasEnTransaccion/u);
  assert.match(f.reconstrucciones, /contextoUsuarioActual\.impersonacionActiva/u);
  assert.match(f.reconstruccionesPortal, /if \(contexto\?\.impersonacionActiva\) return false/u);
  assert.match(f.reconstruccionesPortal, /f\.scope_tenant_id=\?/u);
  assert.match(f.reconstruccionesPortal, /f\.scope_empresa_id=\?/u);
  assert.match(f.reconstruccionesPortal, /f\.scope_sitio_id=\?/u);
  assert.match(f.alertasRemotas, /if \(contexto\?\.impersonacionActiva\)/u);
  assert.match(f.avisosPlataforma, /if \(contexto\?\.impersonacionActiva\)/u);
  assert.match(f.bootstrap, /repositorioProcedencia:\s+new RepositorioProcedenciaEmisionFederacionSql/u);
}

async function verificarBacklogSinAutoridadNoAlcanzaLaRed() {
  const ids = crearIds();
  const referencia = {
    posicionFlujo: '1',
    prioridad: 'operativaActual',
    intentos: 0,
    identidadOcurrencia: {
      installationOrigenId: ids.installationId,
      familia: 'monitores',
      elementoOrigenId: ids.elementoId,
      ocurrenciaOrigenId: ids.ocurrenciaId
    }
  };
  const ocurrencia = {
    familia: 'monitores', familiaVersion: 1,
    installationOrigenId: ids.installationId,
    elementoOrigenId: ids.elementoId,
    ocurrenciaOrigenId: ids.ocurrenciaId,
    secuenciaElemento: '1', operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000', campos: {}, evidenciaIntegridad: []
  };
  const flujo = {
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    familia: 'monitores',
    versionFamilia: 1
  };

  const sinTrabajo = contadoresRed();
  const procesadorVacio = crearProcesador({
    ids, referencia, ocurrencia, red: sinTrabajo, referencias: []
  });
  assert.deepEqual(await procesadorVacio.procesar({
    lease: {}, flujo, renovar: async () => true, exigirVigente: async () => true
  }), { totalLotes: 0 });
  assert.deepEqual(sinTrabajo, { sesiones: 0, capacidades: 0, entregas: 0, resultados: 0 });

  const antesDeSesion = contadoresRed();
  const perdidaInicial = errorAutoridad();
  const procesadorSinAutoridad = crearProcesador({
    ids, referencia, ocurrencia, red: antesDeSesion,
    resolverProcedencia: async () => { throw perdidaInicial; }
  });
  await assert.rejects(
    procesadorSinAutoridad.procesar({
      lease: {}, flujo, renovar: async () => true, exigirVigente: async () => true
    }),
    (error) => error === perdidaInicial
  );
  assert.deepEqual(
    antesDeSesion,
    { sesiones: 0, capacidades: 0, entregas: 0, resultados: 0 },
    'La autoridad se revalida antes de abrir sesión o consultar capacidad.'
  );

  const antesDeEntrega = contadoresRed();
  const perdidaTardia = errorAutoridad();
  let validaciones = 0;
  const procesadorCarrera = crearProcesador({
    ids, referencia, ocurrencia, red: antesDeEntrega,
    resolverProcedencia: async ({ candidatos }) => {
      validaciones += 1;
      if (validaciones === 2) throw perdidaTardia;
      return metadatosAutorizados(ids, candidatos, ocurrencia);
    }
  });
  await assert.rejects(
    procesadorCarrera.procesar({
      lease: {}, flujo, renovar: async () => true, exigirVigente: async () => true
    }),
    (error) => error === perdidaTardia
  );
  assert.deepEqual(antesDeEntrega, {
    sesiones: 1, capacidades: 1, entregas: 0, resultados: 0
  });
  assert.equal(validaciones, 2, 'Cada lote vuelve a acreditar autoridad justo antes de salir.');
}

function crearProcesador({
  ids,
  referencia,
  ocurrencia,
  red,
  referencias = [referencia],
  resolverProcedencia = async ({ candidatos }) =>
    metadatosAutorizados(ids, candidatos, ocurrencia)
}) {
  return new ProcesadorFlujoEmisionFederacionRuntime({
    repositorioCoordinacion: {
      async prepararCandidatos(_lease, opciones) {
        return referencias.map((entrada) => ({
          ...entrada, entregaId: String(opciones.generarEntregaId())
        }));
      },
      async aplicarResultados() { red.resultados += 1; }
    },
    repositorioOcurrencias: {
      async buscarOcurrenciaPorIdentidad() { return ocurrencia; }
    },
    servicioCliente: {
      async obtenerCapacidad() { red.capacidades += 1; return capacidad(); },
      async entregarLote() { red.entregas += 1; throw new Error('Salida inesperada.'); }
    },
    gestorSesiones: {
      async obtenerToken() { red.sesiones += 1; return TOKEN; }
    },
    generadorIdentidades: {
      generar(tipo) {
        return tipo === TIPOS_IDENTIDAD_FEDERADA.ENTREGA
          ? ids.entregaId
          : ids.loteId;
      }
    },
    repositorioProcedencia: { resolverParaLote: resolverProcedencia }
  });
}

function metadatosAutorizados(ids, candidatos, ocurrencia) {
  return {
    revisionConcesionEfectiva: ids.revisionId,
    ocurrenciasAutorizadas: new Map(candidatos.map((candidato) => [
      candidato.entregaId, ocurrencia
    ])),
    procedencias: new Map(candidatos.map((candidato) => [
      candidato.entregaId,
      {
        installationEmisoraId: ids.installationId,
        bootEmisorId: ids.bootId,
        recorridoInstalaciones: [ids.installationId],
        tiemposSaltosDisponibles: []
      }
    ]))
  };
}

function capacidad() {
  return {
    perfil: 'sentinelia-federacion-capacidad-receptora-v1',
    protocoloVersion: 1,
    disponible: true,
    prioridadOperativaActual: true,
    maximoOcurrenciasPorLote: 10,
    maximoBytesPorLote: 4096,
    maximoBytesPorOcurrencia: 2048,
    capacidadTemporalOcurrencias: 10,
    toleranciaTemporalMs: 5000,
    familiasSoportadas: ['monitores'],
    versionesFamilia: { monitores: 1 }
  };
}

function relacionVisible() {
  const seleccion = {
    activa: true,
    nivelesScope: ['portal'],
    familias: {}
  };
  return {
    relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    direccion: 'emision',
    estadoCiclo: 'vinculada',
    estadoAutoridad: 'autorizada',
    estadoIdentidad: 'valida',
    estadoCompatibilidad: 'compatible',
    responsableUsuarioId: '7',
    scope: { tenantId: null, empresaId: null, sitioId: null },
    versionAutoridad: '1',
    concesion: {
      revision: '1',
      oferta: { revisionId: null, seleccion },
      aceptacion: null,
      efectiva: null
    }
  };
}

function crearIds() {
  return {
    relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    entregaId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    loteId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    installationId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootId: generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    elementoId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    revisionId: generar(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
  };
}

function errorAutoridad() {
  const error = new Error('La autoridad actual ya no permite emitir el backlog.');
  error.codigo = 'revision_efectiva_emision_ausente';
  return error;
}

function contadoresRed() {
  return { sesiones: 0, capacidades: 0, entregas: 0, resultados: 0 };
}

function generar(tipo) {
  return String(generador.generar(tipo));
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
