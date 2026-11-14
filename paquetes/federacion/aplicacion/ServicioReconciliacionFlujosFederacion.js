import {
  PERFIL_MANIFIESTO_FLUJO_INICIAL_FEDERACION,
  VERSION_MANIFIESTO_FLUJO_INICIAL_FEDERACION,
  crearManifiestoFlujoInicialFederacion
} from '../src/ManifiestoFlujoInicialFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada,
  derivarIdentidadFederada
} from '../src/IdentidadFederada.js';
import { VERSIONES_FAMILIA_FEDERACION } from '../src/CatalogosFederacion.js';

const PERFIL_FLUJO = 'flujo-concesion-efectiva-v1';
const PERFIL_GENERACION = 'generacion-concesion-efectiva-v1';

export class ServicioReconciliacionFlujosFederacion {
  constructor({
    repositorio, repositorioFlujos, servicioCorteInicial, servicioSesiones = null,
    installationLocalId, bootLocalId, guardiaActivacion = null
  } = {}) {
    exigirMetodo(repositorio, 'cargarConcesionActual', 'repositorio');
    exigirMetodo(repositorio, 'registrarPlan', 'repositorio');
    exigirMetodo(repositorio, 'marcarLista', 'repositorio');
    exigirMetodo(repositorio, 'listarManifiestosListos', 'repositorio');
    exigirMetodo(repositorioFlujos, 'crearFlujoInicial', 'repositorioFlujos');
    exigirMetodo(repositorioFlujos, 'obtener', 'repositorioFlujos');
    exigirMetodo(repositorioFlujos, 'avanzarGeneracion', 'repositorioFlujos');
    exigirMetodo(servicioCorteInicial, 'preparar', 'servicioCorteInicial');
    exigirMetodo(servicioCorteInicial, 'cerrar', 'servicioCorteInicial');
    if (servicioSesiones !== null) {
      exigirMetodo(servicioSesiones, 'validarBearer', 'servicioSesiones');
    }
    if (guardiaActivacion !== null) {
      exigirMetodo(guardiaActivacion, 'exigirActiva', 'guardiaActivacion');
    }
    this.repositorio = repositorio;
    this.repositorioFlujos = repositorioFlujos;
    this.servicioCorteInicial = servicioCorteInicial;
    this.servicioSesiones = servicioSesiones;
    this.installationLocalId = identidad(
      installationLocalId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    );
    this.bootLocalId = identidad(bootLocalId, TIPOS_IDENTIDAD_FEDERADA.ARRANQUE);
    this.guardiaActivacion = guardiaActivacion;
  }

  async reconciliarDesdeConcesionEfectiva({ relacionId, revisionEfectivaId } = {}) {
    await this.guardiaActivacion?.exigirActiva('reconciliar_flujos_concesion');
    const concesion = await this.repositorio.cargarConcesionActual(
      identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION),
      identidad(revisionEfectivaId, TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
    );
    if (concesion.seleccion.vacia || !concesion.seleccion.activa) {
      return Object.freeze({ estado: 'sinAltas', relacionId, flujos: Object.freeze([]) });
    }
    const flujos = [];
    for (const familia of Object.keys(concesion.seleccion.familias).sort()) {
      flujos.push(await this.#reconciliarFamilia(concesion, familia));
    }
    return Object.freeze({
      estado: concesion.direccion === 'emision'
        ? 'fotografiasPreparadas' : 'pendienteManifiesto',
      relacionId: concesion.relacionId,
      flujos: Object.freeze(flujos)
    });
  }

  async recibirManifiesto({ token, manifiesto: entrada } = {}) {
    await this.guardiaActivacion?.exigirActiva('recibir_manifiesto_flujo_inicial');
    if (!this.servicioSesiones) {
      throw error('RECEPCION_MANIFIESTO_NO_DISPONIBLE',
        'La recepción de manifiestos no está compuesta.', 503);
    }
    const sesion = await this.servicioSesiones.validarBearer(token);
    const manifiesto = crearManifiestoFlujoInicialFederacion(entrada);
    if (sesion.relacionId !== manifiesto.relacionId ||
        sesion.installationRemotaId !== manifiesto.installationEmisoraId ||
        sesion.bootRemotoId !== manifiesto.bootEmisorId ||
        sesion.installationLocalId !== this.installationLocalId) {
      throw error('MANIFIESTO_FLUJO_INICIAL_NO_AUTORIZADO',
        'La sesión no testimonia al propietario del manifiesto.', 403);
    }
    const concesion = await this.repositorio.cargarConcesionActual(
      manifiesto.relacionId, null
    );
    if (concesion.direccion !== 'recepcion' ||
        concesion.ofertaId !== manifiesto.ofertaId ||
        concesion.aceptacionId !== manifiesto.aceptacionId ||
        !concesion.seleccion.familias[manifiesto.familia]) {
      throw error('MANIFIESTO_AJENO_A_CONCESION_EFECTIVA',
        'El manifiesto no pertenece a la concesión efectiva receptora.');
    }
    const plan = construirPlan(
      concesion,
      manifiesto.familia,
      manifiesto.scopeOrigenDeclarado
    );
    if (plan.flujoId !== manifiesto.flujoId ||
        plan.generacionId !== manifiesto.generacionId) {
      throw error('IDENTIDAD_FLUJO_INICIAL_DIVERGENTE',
        'El manifiesto no conserva las identidades derivadas del acuerdo.');
    }
    await this.repositorio.registrarPlan(plan);
    await asegurarFlujo(this.repositorioFlujos, {
      flujo: definicionFlujo(plan, concesion),
      generacion: definicionGeneracion(plan, {
        installationId: manifiesto.installationEmisoraId,
        bootId: manifiesto.bootEmisorId,
        fronteraInicial: manifiesto.fronteraInicial
      }),
      corteInicialPendiente: false
    });
    const reconciliacion = await this.repositorio.marcarLista({
      flujoId: plan.flujoId,
      fronteraInicial: manifiesto.fronteraInicial
    });
    await completarGeneracionVaciaConfirmada(this.repositorioFlujos, {
      flujoId: plan.flujoId,
      generacionId: plan.generacionId,
      fronteraInicial: manifiesto.fronteraInicial
    });
    return Object.freeze({ ...reconciliacion, estado: 'reconciliada' });
  }

  async confirmarManifiestoPublicado({ manifiesto: entrada } = {}) {
    const manifiesto = crearManifiestoFlujoInicialFederacion(entrada);
    if (manifiesto.installationEmisoraId !== this.installationLocalId) {
      throw error(
        'CONFIRMACION_MANIFIESTO_AJENO',
        'Solo la instalación emisora puede confirmar su manifiesto publicado.'
      );
    }
    return confirmarGeneracionPublicada(this.repositorioFlujos, {
      flujoId: manifiesto.flujoId,
      generacionId: manifiesto.generacionId,
      fronteraInicial: manifiesto.fronteraInicial
    });
  }

  async consultarManifiestos({ token, relacionId } = {}) {
    const relacion = identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION);
    if (!this.servicioSesiones) {
      throw error('CONSULTA_MANIFIESTOS_NO_DISPONIBLE',
        'La consulta de manifiestos no está compuesta.', 503);
    }
    const sesion = await this.servicioSesiones.validarBearer(token);
    if (sesion.relacionId !== relacion ||
        sesion.installationLocalId !== this.installationLocalId) {
      throw error('CONSULTA_MANIFIESTOS_NO_AUTORIZADA',
        'La sesión no autoriza consultar esa relación.', 403);
    }
    return this.listarManifiestosPreparados({ relacionId: relacion });
  }

  async listarManifiestosPreparados({ relacionId } = {}) {
    const relacion = identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION);
    const concesion = await this.repositorio.cargarConcesionActual(relacion, null);
    if (concesion.direccion !== 'emision') {
      throw error('CONSULTA_MANIFIESTOS_DIRECCION_INVALIDA',
        'Solo la relación emisora publica manifiestos iniciales.');
    }
    const planes = await this.repositorio.listarManifiestosListos(relacion);
    return Object.freeze({
      relacionId: relacion,
      manifiestos: Object.freeze(planes.map((plan) =>
        crearManifiestoFlujoInicialFederacion({
          perfil: PERFIL_MANIFIESTO_FLUJO_INICIAL_FEDERACION,
          version: VERSION_MANIFIESTO_FLUJO_INICIAL_FEDERACION,
          relacionId: plan.relacionId,
          ofertaId: plan.ofertaId,
          aceptacionId: plan.aceptacionId,
          familia: plan.familia,
          versionFamilia: plan.versionFamilia,
          scopeOrigenDeclarado: plan.scopeOrigenDeclarado,
          flujoId: plan.flujoId,
          generacionId: plan.generacionId,
          installationEmisoraId: plan.installationEmisoraId,
          bootEmisorId: plan.bootEmisorId,
          fronteraInicial: plan.fronteraInicial
        })))
    });
  }

  async #reconciliarFamilia(concesion, familia) {
    const plan = construirPlan(concesion, familia);
    const registrado = await this.repositorio.registrarPlan(plan);
    if (concesion.direccion === 'recepcion') return registrado;
    if (registrado.estado !== 'lista') {
      await asegurarCorte(this.servicioCorteInicial, this.repositorioFlujos, {
        flujo: definicionFlujo(plan, concesion),
        generacion: definicionGeneracion(plan, {
          installationId: this.installationLocalId,
          bootId: this.bootLocalId,
          fronteraInicial: '0'
        })
      });
    }
    const cierre = await this.servicioCorteInicial.cerrar({
      flujoId: plan.flujoId,
      generacionId: plan.generacionId
    });
    const reconciliacion = await this.repositorio.marcarLista({
      flujoId: plan.flujoId,
      fronteraInicial: cierre.fronteraInicial
    });
    const flujoPersistido = await this.repositorioFlujos.obtener(plan.flujoId);
    if (!flujoPersistido) {
      throw error('FLUJO_INICIAL_NO_RECUPERABLE',
        'El flujo desapareció tras cerrar su fotografía.', 500);
    }
    return Object.freeze({
      ...reconciliacion,
      manifiesto: crearManifiestoFlujoInicialFederacion({
        perfil: PERFIL_MANIFIESTO_FLUJO_INICIAL_FEDERACION,
        version: VERSION_MANIFIESTO_FLUJO_INICIAL_FEDERACION,
        relacionId: plan.relacionId,
        ofertaId: plan.ofertaId,
        aceptacionId: plan.aceptacionId,
        familia,
        versionFamilia: VERSIONES_FAMILIA_FEDERACION[familia],
        scopeOrigenDeclarado: concesion.contexto,
        flujoId: plan.flujoId,
        generacionId: plan.generacionId,
        installationEmisoraId:
          flujoPersistido.generacion.propietario.installationId,
        bootEmisorId: flujoPersistido.generacion.propietario.bootId,
        fronteraInicial: cierre.fronteraInicial
      })
    });
  }
}

function construirPlan(concesion, familia, scopeOrigenDeclarado = undefined) {
  const componentes = [concesion.relacionId, familia,
    String(VERSIONES_FAMILIA_FEDERACION[familia])];
  const flujoId = String(derivarIdentidadFederada({
    tipo: TIPOS_IDENTIDAD_FEDERADA.FLUJO,
    perfil: PERFIL_FLUJO,
    componentes
  }));
  return Object.freeze({
    flujoId,
    generacionId: String(derivarIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      perfil: PERFIL_GENERACION,
      componentes: [flujoId, concesion.revisionEfectivaId]
    })),
    relacionId: concesion.relacionId,
    familia,
    revisionEfectivaId: concesion.revisionEfectivaId,
    ofertaId: concesion.ofertaId,
    aceptacionId: concesion.aceptacionId,
    direccion: concesion.direccion,
    scopeOrigenDeclarado: scopeOrigenDeclarado === undefined
      ? (concesion.direccion === 'emision' ? concesion.contexto : null)
      : scopeOrigenDeclarado
  });
}

function definicionFlujo(plan, concesion) {
  return {
    flujoId: plan.flujoId, relacionId: plan.relacionId,
    direccion: plan.direccion, familia: plan.familia,
    versionFamilia: VERSIONES_FAMILIA_FEDERACION[plan.familia],
    contexto: concesion.contexto
  };
}

function definicionGeneracion(plan, propietario) {
  return {
    generacionId: plan.generacionId, clase: 'inicial',
    fronteraInicial: propietario.fronteraInicial,
    propietario: { installationId: propietario.installationId,
      bootId: propietario.bootId, version: 1 }
  };
}

async function asegurarCorte(servicio, repositorioFlujos, entrada) {
  const existente = await repositorioFlujos.obtener(entrada.flujo.flujoId);
  if (!existente) {
    try { return await servicio.preparar(entrada); } catch (fallo) {
      if (!esDuplicado(fallo)) throw fallo;
      return servicio.prepararReemplazo(entrada);
    }
  }
  if (existente.generacion.generacionId === entrada.generacion.generacionId) {
    return exigirFlujoExistente(existente, entrada);
  }
  return servicio.prepararReemplazo(entrada);
}

async function asegurarFlujo(repositorio, entrada) {
  const existente = await repositorio.obtener(entrada.flujo.flujoId);
  if (!existente) {
    try { return await repositorio.crearFlujoInicial(entrada); } catch (fallo) {
      if (!esDuplicado(fallo)) throw fallo;
      return repositorio.prepararGeneracionConcesion({
        flujoId: entrada.flujo.flujoId,
        generacionId: entrada.generacion.generacionId,
        installationPropietariaId: entrada.generacion.propietario.installationId,
        bootPropietarioId: entrada.generacion.propietario.bootId,
        contexto: entrada.flujo.contexto,
        corteInicialPendiente: false
      });
    }
  }
  if (existente.generacion.generacionId === entrada.generacion.generacionId) {
    return exigirFlujoExistente(existente, entrada);
  }
  return repositorio.prepararGeneracionConcesion({
    flujoId: entrada.flujo.flujoId,
    generacionId: entrada.generacion.generacionId,
    installationPropietariaId: entrada.generacion.propietario.installationId,
    bootPropietarioId: entrada.generacion.propietario.bootId,
    contexto: entrada.flujo.contexto,
    corteInicialPendiente: false
  });
}

function exigirFlujoExistente(flujo, entrada) {
  if (!flujo || flujo.generacion.generacionId !== entrada.generacion.generacionId ||
      flujo.relacionId !== entrada.flujo.relacionId ||
      flujo.familia !== entrada.flujo.familia ||
      flujo.direccion !== entrada.flujo.direccion ||
      flujo.versionFamilia !== entrada.flujo.versionFamilia ||
      !mismoScope(flujo.contexto, entrada.flujo.contexto) ||
      (entrada.corteInicialPendiente === false &&
        (flujo.generacion.propietario.installationId !==
          entrada.generacion.propietario.installationId ||
         flujo.generacion.propietario.bootId !== entrada.generacion.propietario.bootId ||
         flujo.generacion.frontera.posicionInicial !==
          entrada.generacion.fronteraInicial))) {
    throw error('FLUJO_INICIAL_EXISTENTE_DIVERGENTE',
      'La identidad o el contexto del flujo inicial ya pertenecen a otro agregado.');
  }
  return flujo;
}

async function confirmarGeneracionPublicada(repositorioFlujos, {
  flujoId,
  generacionId,
  fronteraInicial
}) {
  const frontera = String(fronteraInicial);
  for (let intento = 1; intento <= 4; intento += 1) {
    let flujo = await repositorioFlujos.obtener(flujoId);
    if (!flujo || flujo.generacion?.generacionId !== generacionId ||
        flujo.generacion?.frontera?.posicionInicial !== frontera) {
      throw error(
        'GENERACION_PUBLICADA_DIVERGENTE',
        'La generación publicada no coincide con el flujo persistido.'
      );
    }
    if (frontera === '0' && flujo.generacion.estado === 'completa' &&
        flujo.generacion.frontera.historicamenteCompleta) {
      return Object.freeze({ completada: true, estado: 'yaCompleta' });
    }
    if (frontera !== '0' && flujo.generacion.estado !== 'preparada') {
      return Object.freeze({ completada: false, estado: 'yaPublicada' });
    }
    try {
      if (flujo.generacion.estado === 'preparada') {
        flujo = await repositorioFlujos.avanzarGeneracion({
          flujoId,
          propietario: flujo.generacion.propietario,
          versionEstadoEsperada: flujo.generacion.versionEstado,
          versionFronteraEsperada: flujo.generacion.frontera.version,
          estadoGeneracion: 'transfiriendo',
          estadoFlujo: 'sincronizando',
          frontera: fronteraVacia({ sincronizando: true })
        });
      }
      if (frontera !== '0') {
        return Object.freeze({ completada: false, estado: 'transfiriendo' });
      }
      if (flujo.generacion.estado !== 'transfiriendo') {
        throw error(
          'GENERACION_VACIA_NO_COMPLETABLE',
          'La generación vacía no se encuentra en un estado completable.'
        );
      }
      await repositorioFlujos.avanzarGeneracion({
        flujoId,
        propietario: flujo.generacion.propietario,
        versionEstadoEsperada: flujo.generacion.versionEstado,
        versionFronteraEsperada: flujo.generacion.frontera.version,
        estadoGeneracion: 'completa',
        estadoFlujo: 'operativoCompleto',
        frontera: fronteraVacia({
          sincronizando: false,
          operativamenteCompleta: true,
          historicamenteCompleta: true
        })
      });
      return Object.freeze({ completada: true, estado: 'completada' });
    } catch (fallo) {
      if (fallo?.codigo !== 'version_concurrente' || intento === 4) throw fallo;
    }
  }
  throw error(
    'GENERACION_PUBLICADA_CONCURRENTE',
    'La generación publicada cambió repetidamente durante su confirmación.'
  );
}

function completarGeneracionVaciaConfirmada(repositorioFlujos, entrada) {
  if (String(entrada?.fronteraInicial) !== '0') {
    return Object.freeze({ completada: false, causa: 'frontera_con_datos' });
  }
  return confirmarGeneracionPublicada(repositorioFlujos, entrada);
}

function fronteraVacia({
  sincronizando,
  operativamenteCompleta = false,
  historicamenteCompleta = false
}) {
  return {
    posicionOperativa: operativamenteCompleta ? '0' : null,
    posicionHistorica: historicamenteCompleta ? '0' : null,
    sincronizando,
    operativamenteCompleta,
    historicamenteCompleta,
    parcialPorScope: false,
    degradada: false
  };
}

function mismoScope(a, b) {
  return ['nivel', 'tenantId', 'empresaId', 'sitioId'].every((clave) => a[clave] === b[clave]);
}

function identidad(valor, tipo) {
  return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
}

function esDuplicado(fallo) {
  return fallo?.code === 'ER_DUP_ENTRY' || fallo?.errno === 1062;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}

function error(codigo, mensaje, statusCode = 409) {
  const fallo = new Error(mensaje);
  fallo.codigo = codigo;
  fallo.statusCode = statusCode;
  return fallo;
}
