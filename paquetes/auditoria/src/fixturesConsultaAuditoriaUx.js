import { createHash } from 'node:crypto';
import {
  ACTORES_AUDITORIA,
  CAUSALIDADES_AUDITORIA,
  FLUJOS_AUDITORIA,
  ORIGENES_AUDITORIA,
  listarTiposEventoAuditoria,
  obtenerDefinicionTipoEventoAuditoria,
  resolverFlujoEventoAuditoria
} from './CatalogoAuditoria.js';
import { uuidV7AuditoriaABytes } from './UuidV7Auditoria.js';

export const VOLUMEN_OBJETIVO_FIXTURE_CONSULTA_AUDITORIA = 2_048;
export const TAMANO_CORRELACION_GRANDE_FIXTURE_AUDITORIA = 125;

const ALCANCES = Object.freeze({
  portal: Object.freeze({ tenantId: null, empresaId: null, sitioId: null }),
  tenantA: Object.freeze({ tenantId: '101', empresaId: null, sitioId: null }),
  empresaA: Object.freeze({ tenantId: '101', empresaId: '1001', sitioId: null }),
  sitioA: Object.freeze({ tenantId: '101', empresaId: '1001', sitioId: '10001' }),
  tenantB: Object.freeze({ tenantId: '202', empresaId: null, sitioId: null }),
  empresaB: Object.freeze({ tenantId: '202', empresaId: '2002', sitioId: null }),
  sitioB: Object.freeze({ tenantId: '202', empresaId: '2002', sitioId: '20002' })
});

export function crearFixtureConsultaAuditoriaUx({
  volumenObjetivo = VOLUMEN_OBJETIVO_FIXTURE_CONSULTA_AUDITORIA,
  tamanoCorrelacionGrande = TAMANO_CORRELACION_GRANDE_FIXTURE_AUDITORIA
} = {}) {
  exigir(Number.isInteger(volumenObjetivo) && volumenObjetivo >= 512, 'La fixture exige al menos 512 eventos.');
  exigir(Number.isInteger(tamanoCorrelacionGrande) && tamanoCorrelacionGrande > 100, 'La correlación grande debe superar 100 eventos.');
  exigir(volumenObjetivo > tamanoCorrelacionGrande + 100, 'El volumen debe dejar espacio para todos los escenarios.');

  const estado = crearEstadoGeneracion();
  const eventos = [];
  const tipos = listarTiposEventoAuditoria();
  const definiciones = tipos.map((tipo) => obtenerDefinicionTipoEventoAuditoria(tipo));
  const emisiones = seleccionarEmisionesCobertura(definiciones);
  const correlacionGrande = siguienteUuid(estado);
  const correlacionCruzaScopes = siguienteUuid(estado);
  const registradoEmpateUtc = fechaFixture(450);

  for (const [indice, definicion] of definiciones.entries()) {
    const scope = Object.values(ALCANCES)[indice % Object.values(ALCANCES).length];
    eventos.push(crearEvento({
      estado,
      definicion,
      emision: emisiones.get(definicion.tipo) || definicion.emisionesPermitidas[0],
      scope,
      registradoEnUtc: fechaFixture(indice),
      correlacionId: siguienteUuid(estado)
    }));
  }

  const definicionGrande = obtenerDefinicionTipoEventoAuditoria('monitor.actualizado');
  for (let indice = 0; indice < tamanoCorrelacionGrande; indice += 1) {
    eventos.push(crearEvento({
      estado,
      definicion: definicionGrande,
      emision: definicionGrande.emisionesPermitidas[0],
      scope: ALCANCES.sitioA,
      sujetoId: 'monitor-repetido-501',
      actorId: 'usuario-repetido-41',
      registradoEnUtc: fechaFixture(200 + indice),
      correlacionId: correlacionGrande
    }));
  }

  const eventoScopeA = crearEvento({
    estado,
    definicion: obtenerDefinicionTipoEventoAuditoria('dns.zona_actualizada'),
    scope: ALCANCES.sitioA,
    registradoEnUtc: fechaFixture(400),
    correlacionId: correlacionCruzaScopes
  });
  const eventoScopeB = crearEvento({
    estado,
    definicion: obtenerDefinicionTipoEventoAuditoria('dns.zona_actualizada'),
    scope: ALCANCES.sitioB,
    registradoEnUtc: fechaFixture(401),
    correlacionId: correlacionCruzaScopes
  });
  eventos.push(eventoScopeA, eventoScopeB);

  const definicionEmpate = obtenerDefinicionTipoEventoAuditoria('usuario.perfil_cambiado');
  const eventoEmpateA = crearEvento({
    estado,
    definicion: definicionEmpate,
    scope: ALCANCES.empresaA,
    registradoEnUtc: registradoEmpateUtc,
    correlacionId: siguienteUuid(estado)
  });
  const eventoEmpateB = crearEvento({
    estado,
    definicion: definicionEmpate,
    scope: ALCANCES.empresaA,
    registradoEnUtc: registradoEmpateUtc,
    correlacionId: siguienteUuid(estado)
  });
  eventos.push(eventoEmpateA, eventoEmpateB);

  eventos.push(crearEvento({
    estado,
    definicion: definicionEmpate,
    emision: { actor: 'usuario', origen: 'web', productor: 'portal_web' },
    scope: ALCANCES.tenantA,
    actorId: 'usuario-repetido-41',
    actorEfectivo: { tipo: 'usuario', id: 'usuario-efectivo-77' },
    modoActuacion: 'impersonado',
    registradoEnUtc: fechaFixture(451),
    correlacionId: siguienteUuid(estado)
  }));

  for (const [indice, causalidadTipo] of CAUSALIDADES_AUDITORIA.entries()) {
    eventos.push(crearEvento({
      estado,
      definicion: obtenerDefinicionTipoEventoAuditoria('monitor.actualizado'),
      scope: indice === CAUSALIDADES_AUDITORIA.length - 1 ? ALCANCES.portal : ALCANCES.empresaA,
      causalidad: {
        tipo: causalidadTipo,
        id: idCausalidad(causalidadTipo, eventoEmpateA.eventoId, estado)
      },
      registradoEnUtc: fechaFixture(500 + indice),
      correlacionId: siguienteUuid(estado)
    }));
  }

  let indiceRelleno = 0;
  const scopesRelleno = Object.values(ALCANCES);
  while (eventos.length < volumenObjetivo) {
    const definicion = definiciones[indiceRelleno % definiciones.length];
    eventos.push(crearEvento({
      estado,
      definicion,
      emision: definicion.emisionesPermitidas[indiceRelleno % definicion.emisionesPermitidas.length],
      scope: scopesRelleno[indiceRelleno % scopesRelleno.length],
      sujetoId: `${definicion.sujetos[0]}-repetido-${indiceRelleno % 23}`,
      actorId: `${definicion.emisionesPermitidas[0].actor}-repetido-${indiceRelleno % 11}`,
      registradoEnUtc: fechaFixture(700 + indiceRelleno),
      correlacionId: siguienteUuid(estado)
    }));
    indiceRelleno += 1;
  }

  const ordenados = ordenarEventosFixtureAuditoria(eventos, { orden: 'asc' });
  return congelar({
    eventos: ordenados,
    alcances: ALCANCES,
    ids: {
      correlacionGrande,
      correlacionCruzaScopes,
      eventosCruceScope: [eventoScopeA.eventoId, eventoScopeB.eventoId],
      eventosEmpate: [eventoEmpateA.eventoId, eventoEmpateB.eventoId],
      registradoEmpateUtc
    },
    resumen: construirResumen(ordenados, { correlacionGrande, correlacionCruzaScopes })
  });
}

export function ordenarEventosFixtureAuditoria(eventos, { orden = 'asc' } = {}) {
  exigir(['asc', 'desc'].includes(orden), 'El orden de la fixture debe ser asc o desc.');
  const factor = orden === 'asc' ? 1 : -1;
  return Object.freeze([...eventos].sort((a, b) => {
    const fecha = a.registradoEnUtc.localeCompare(b.registradoEnUtc);
    return factor * (fecha || a.eventoId.localeCompare(b.eventoId));
  }));
}

export function filtrarEventosFixtureAuditoriaPorScope(eventos, contexto = {}) {
  let visibles;
  if (contexto.nivelScope === 'portal') {
    visibles = eventos;
  } else if (contexto.nivelScope === 'tenant' && contexto.tenantId != null) {
    visibles = eventos.filter((evento) => mismoId(evento.scope.tenantId, contexto.tenantId));
  } else if (contexto.nivelScope === 'empresa' && contexto.empresaId != null) {
    visibles = eventos.filter((evento) => mismoId(evento.scope.empresaId, contexto.empresaId));
  } else if (contexto.nivelScope === 'sitio' && contexto.sitioId != null) {
    visibles = eventos.filter((evento) => mismoId(evento.scope.sitioId, contexto.sitioId));
  } else {
    visibles = [];
  }
  return Object.freeze([...visibles]);
}

export function construirMaterializacionSqlFixtureAuditoria(fixture) {
  exigir(Array.isArray(fixture?.eventos) && fixture.eventos.length > 0, 'La materialización exige una fixture con eventos.');
  const porCadena = new Map();
  for (const evento of fixture.eventos) {
    const actual = porCadena.get(evento.claveCadena);
    if (!actual || Number(evento.secuencia) > Number(actual.secuencia)) {
      porCadena.set(evento.claveCadena, evento);
    }
  }
  const cadenas = [...porCadena.values()].map((ultimo) => ({
    claveCadena: ultimo.claveCadena,
    flujo: ultimo.flujo,
    tenantId: ultimo.scope.tenantId,
    ultimaSecuencia: ultimo.secuencia,
    ultimoHash: Buffer.from(ultimo.hashActual, 'hex'),
    fechaCreacionUtc: fechaSqlFixture(fixture.eventos.find((evento) =>
      evento.claveCadena === ultimo.claveCadena
    ).registradoEnUtc),
    fechaActualizacionUtc: fechaSqlFixture(ultimo.registradoEnUtc)
  }));
  const eventos = fixture.eventos.map((evento) => ({
    cadenaClave: evento.claveCadena,
    eventoId: uuidV7AuditoriaABytes(evento.eventoId),
    eventoContraparteId: evento.eventoContraparteId
      ? uuidV7AuditoriaABytes(evento.eventoContraparteId)
      : null,
    tipoEvento: evento.tipoEvento,
    versionContrato: evento.versionContrato,
    flujo: evento.flujo,
    claveCadena: evento.claveCadena,
    secuencia: evento.secuencia,
    actorRealTipo: evento.actorReal.tipo,
    actorRealId: evento.actorReal.id,
    actorEfectivoTipo: evento.actorEfectivo?.tipo ?? null,
    actorEfectivoId: evento.actorEfectivo?.id ?? null,
    modoActuacion: evento.modoActuacion,
    sujetoTipo: evento.sujeto.tipo,
    sujetoId: evento.sujeto.id,
    origen: evento.origen,
    scopeTenantId: evento.scope.tenantId,
    scopeEmpresaId: evento.scope.empresaId,
    scopeSitioId: evento.scope.sitioId,
    correlacionId: uuidV7AuditoriaABytes(evento.correlacionId),
    causalidadTipo: evento.causalidadTipo,
    causalidadId: evento.causalidadId,
    productor: evento.productor,
    claveOperacion: Buffer.from(evento.claveOperacion, 'ascii'),
    rolEvento: evento.rolEvento,
    efectivoEnUtc: fechaSqlFixture(evento.efectivoEnUtc),
    registradoEnUtc: fechaSqlFixture(evento.registradoEnUtc),
    versionCanonicalizador: evento.versionCanonicalizador,
    versionEncadenado: evento.versionEncadenado,
    payload: JSON.stringify(evento.payload),
    hashPayload: Buffer.from(evento.hashPayload, 'hex'),
    hashAnterior: Buffer.from(evento.hashAnterior, 'hex'),
    hashActual: Buffer.from(evento.hashActual, 'hex')
  }));
  return congelar({ cadenas, eventos });
}

function crearEvento({
  estado,
  definicion,
  emision = definicion.emisionesPermitidas[0],
  scope,
  registradoEnUtc,
  correlacionId,
  sujetoId = null,
  actorId = null,
  actorEfectivo = null,
  modoActuacion = actorEfectivo ? 'impersonado' : 'directo',
  causalidad = null
}) {
  const sujetoTipo = definicion.sujetos[0];
  const flujo = resolverFlujoFixture(definicion, sujetoTipo, estado);
  const claveCadena = scope.tenantId == null
    ? `${flujo}:portal`
    : `${flujo}:tenant:${scope.tenantId}`;
  const secuencia = siguienteSecuencia(estado, claveCadena);
  const eventoId = siguienteUuid(estado);
  const huella = createHash('sha256').update(`${claveCadena}:${secuencia}:${eventoId}`).digest('hex');
  return congelar({
    eventoId,
    eventoContraparteId: null,
    tipoEvento: definicion.tipo,
    versionContrato: definicion.versionContrato,
    flujo,
    claveCadena,
    secuencia,
    actorReal: {
      tipo: emision.actor,
      id: resolverActorIdFixture(
        emision.actor,
        actorId || `${emision.actor}-${Number(secuencia) % 17 + 1}`
      )
    },
    actorEfectivo,
    modoActuacion,
    sujeto: {
      tipo: sujetoTipo,
      id: resolverSujetoIdFixture({
        tipo: sujetoTipo,
        candidato: sujetoId || `${sujetoTipo}-${Number(secuencia) % 29 + 1}`,
        eventoId
      })
    },
    origen: emision.origen,
    scope: { ...scope },
    correlacionId,
    causalidadTipo: causalidad?.tipo ?? null,
    causalidadId: causalidad?.id ?? null,
    productor: emision.productor,
    claveOperacion: `fixture:${eventoId}`,
    rolEvento: definicion.roles[0],
    efectivoEnUtc: registradoEnUtc,
    registradoEnUtc,
    versionCanonicalizador: 'sentinelia-auditoria-jcs-v1',
    versionEncadenado: 'sentinelia-auditoria-sha256-v1',
    payload: { fixture: 'consulta_auditoria_ux', indice: estado.totalEventos },
    hashPayload: huella,
    hashAnterior: huella,
    hashActual: huella
  });
}

function seleccionarEmisionesCobertura(definiciones) {
  const seleccionadas = new Map(definiciones.map((definicion) => [
    definicion.tipo,
    definicion.emisionesPermitidas[0]
  ]));
  const usados = new Set();
  for (const objetivo of [
    ...ORIGENES_AUDITORIA.map((valor) => ({ campo: 'origen', valor })),
    ...ACTORES_AUDITORIA.map((valor) => ({ campo: 'actor', valor }))
  ]) {
    const definicion = definiciones.find((candidata) =>
      !usados.has(candidata.tipo) &&
      candidata.emisionesPermitidas.some((emision) => emision[objetivo.campo] === objetivo.valor)
    );
    exigir(definicion, `No existe emisión auditable para cubrir ${objetivo.campo}=${objetivo.valor}.`);
    seleccionadas.set(
      definicion.tipo,
      definicion.emisionesPermitidas.find((emision) => emision[objetivo.campo] === objetivo.valor)
    );
    usados.add(definicion.tipo);
  }
  return seleccionadas;
}

function resolverFlujoFixture(definicion, sujetoTipo, estado) {
  if (definicion.flujo) return definicion.flujo;
  if (definicion.tipo === 'cadena.iniciada') {
    const flujo = FLUJOS_AUDITORIA[estado.flujoTransversal % FLUJOS_AUDITORIA.length];
    estado.flujoTransversal += 1;
    return flujo;
  }
  return resolverFlujoEventoAuditoria(definicion.tipo, sujetoTipo);
}

function construirResumen(eventos, { correlacionGrande, correlacionCruzaScopes }) {
  return {
    totalEventos: eventos.length,
    totalFlujos: new Set(eventos.map((evento) => evento.flujo)).size,
    totalTiposEvento: new Set(eventos.map((evento) => evento.tipoEvento)).size,
    totalActoresTipo: new Set(eventos.map((evento) => evento.actorReal.tipo)).size,
    totalOrigenes: new Set(eventos.map((evento) => evento.origen)).size,
    totalCausalidadesTipo: new Set(eventos.map((evento) => evento.causalidadTipo).filter(Boolean)).size,
    eventosCorrelacionGrande: eventos.filter((evento) => evento.correlacionId === correlacionGrande).length,
    eventosCorrelacionCruzaScopes: eventos.filter((evento) => evento.correlacionId === correlacionCruzaScopes).length
  };
}

function crearEstadoGeneracion() {
  return {
    contadorUuid: 1,
    totalEventos: 0,
    flujoTransversal: 0,
    secuenciaPorCadena: new Map()
  };
}

function siguienteUuid(estado) {
  const sufijo = estado.contadorUuid.toString(16).padStart(12, '0');
  estado.contadorUuid += 1;
  return `018f8f70-7b5c-7a55-b32a-${sufijo}`;
}

function siguienteSecuencia(estado, claveCadena) {
  const secuencia = (estado.secuenciaPorCadena.get(claveCadena) || 0) + 1;
  estado.secuenciaPorCadena.set(claveCadena, secuencia);
  estado.totalEventos += 1;
  return String(secuencia);
}

function fechaFixture(indice) {
  return new Date(Date.UTC(2026, 6, 20, 0, 0, 0, indice)).toISOString();
}

function idCausalidad(tipo, eventoId, estado) {
  if (tipo === 'evento_auditoria') return eventoId;
  if (tipo === 'solicitud_recuperacion_password') return siguienteUuid(estado);
  if (tipo === 'operacion_sesion_agente') return siguienteUuid(estado);
  if (tipo === 'aviso_plataforma') return siguienteUuid(estado);
  if (tipo === 'intencion_ddns') return siguienteUuid(estado);
  const tiposFederados = {
    relacion_federacion: 'relacion',
    ocurrencia_federacion: 'ocurrencia_origen',
    entrega_federacion: 'entrega'
  };
  if (tiposFederados[tipo]) return identidadFederadaFixture(tiposFederados[tipo]);
  return String(7_000 + CAUSALIDADES_AUDITORIA.indexOf(tipo));
}

function resolverActorIdFixture(tipo, candidato) {
  return tipo === 'instancia_remota'
    ? identidadFederadaFixture('instalacion')
    : candidato;
}

function resolverSujetoIdFixture({ tipo, candidato, eventoId }) {
  if (tipo === 'frontera_internet') return 'portal';
  if (tipo === 'aviso_plataforma') return eventoId;
  const tiposFederados = {
    instalacion_federada: 'instalacion',
    relacion_federada: 'relacion',
    revision_concesion_federada: 'revision_concesion',
    flujo_federado: 'flujo',
    lote_federado: 'lote',
    proyeccion_federada: 'proyeccion'
  };
  return tiposFederados[tipo]
    ? identidadFederadaFixture(tiposFederados[tipo])
    : candidato;
}

function identidadFederadaFixture(tipo) {
  return `sfid1.${tipo}.${'A'.repeat(22)}`;
}

function mismoId(a, b) {
  return a != null && String(a) === String(b);
}

function fechaSqlFixture(fechaUtc) {
  return String(fechaUtc).slice(0, -1).replace('T', ' ');
}

function congelar(valor) {
  if (ArrayBuffer.isView(valor)) return valor;
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelar(hijo);
  }
  return valor;
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
