import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  AdaptadorAuditoriaAvisosPlataforma,
  RepositorioAvisosPlataformaSql,
  ServicioAvisosPlataforma,
  construirClaveCausalAvisoPlataforma,
  generarIdAvisoPlataforma,
  idAvisoPlataformaABytes
} from '../paquetes/avisos-plataforma/src/index.js';
import {
  prepararIntencionAuditoriaV1
} from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION_ID = `sfid1.relacion.${'G'.repeat(21)}A`;
const FLUJO_ID = `sfid1.flujo.${'H'.repeat(21)}A`;
const ACTOR_RUNTIME = Object.freeze({ tipo: 'runtime', id: 'sentinelia-runtime' });
const BASE_TIEMPO = Date.now() - 60_000;

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    'La verificación 5.22.10g requiere SQL local configurado.'
  );
  const clienteSql = new ClienteSql(configuracion.sql);
  const auditoria = new RepositorioAuditoriaValidantePrueba();
  const adaptadorAuditoria = new AdaptadorAuditoriaAvisosPlataforma({
    repositorioAuditoria: auditoria
  });
  const repositorio = new RepositorioAvisosPlataformaSql(clienteSql, {
    adaptadorAuditoria
  });
  const servicio = new ServicioAvisosPlataforma({ repositorioAvisos: repositorio });
  const claves = [claveComunicacion(), claveAutoridad(), claveTiempo()];
  try {
    await asegurarMigraciones(clienteSql);
    await limpiar(clienteSql, claves);
    await verificarAtomicidad(clienteSql, servicio, auditoria, claves[0]);
    await verificarRollbackAuditoriaReal(clienteSql, claves[2]);
    await verificarCicloCompleto(clienteSql, servicio, auditoria, claves[0]);
    await verificarResolucionAdministrativa(clienteSql, servicio, auditoria, claves[1]);
    await verificarEstadoPersistido(clienteSql, claves);
  } finally {
    await limpiar(clienteSql, claves);
    await clienteSql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.10g: apertura=atomica replay=idempotente consolidacion=idempotente ' +
    'gravedad=historica resolucion=tipada reapertura=enlazada auditoria=misma-transaccion'
  );
}

async function verificarRollbackAuditoriaReal(clienteSql, claveCausal) {
  const adaptadorReal = new AdaptadorAuditoriaAvisosPlataforma({
    repositorioAuditoria: new RepositorioAuditoria(clienteSql)
  });
  const adaptadorConCaida = {
    async registrarTransicionEnTransaccion(transicion, { conexion }) {
      await adaptadorReal.registrarTransicionEnTransaccion(transicion, { conexion });
      throw new Error('caída simulada después de auditoría real');
    }
  };
  const servicio = new ServicioAvisosPlataforma({
    repositorioAvisos: new RepositorioAvisosPlataformaSql(clienteSql, {
      adaptadorAuditoria: adaptadorConCaida
    })
  });
  const solicitud = deteccion(claveCausal, 0);
  await assert.rejects(
    () => servicio.detectar(solicitud),
    /caída simulada después de auditoría real/
  );
  assert.equal(await contarAvisos(clienteSql, claveCausal), 0);
  const [evento] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM eventos_auditoria WHERE evento_id = ?',
    [idAvisoPlataformaABytes(solicitud.eventoId, 'eventoId')]
  );
  assert.equal(Number(evento.total), 0);
}

async function asegurarMigraciones(clienteSql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  const segunda = await ejecutor.ejecutarPendientes();
  assert.equal(segunda.pendientesAplicadas, 0);
}

async function verificarAtomicidad(clienteSql, servicio, auditoria, claveCausal) {
  auditoria.fallarSiguiente = true;
  await assert.rejects(
    () => servicio.detectar(deteccion(claveCausal, 0)),
    /fallo auditable simulado/
  );
  assert.equal(await contarAvisos(clienteSql, claveCausal), 0);
  assert.equal(await contarHistorico(clienteSql, claveCausal), 0);
  auditoria.estadoSiguiente = 'existente';
  await assert.rejects(
    () => servicio.detectar(deteccion(claveCausal, 0)),
    /no devolvió exactamente un evento de aviso/
  );
  assert.equal(await contarAvisos(clienteSql, claveCausal), 0);
  assert.equal(await contarHistorico(clienteSql, claveCausal), 0);
}

async function verificarCicloCompleto(clienteSql, servicio, auditoria, claveCausal) {
  const solicitudApertura = deteccion(claveCausal, 1);
  const abierto = await servicio.detectar(solicitudApertura);
  assert.equal(abierto.estado, 'abierto');
  assert.equal(abierto.aviso.contadorDetecciones, 1);
  assert.equal(abierto.eventoAuditoria.estado, 'incorporado');

  const repetido = await servicio.detectar(solicitudApertura);
  assert.equal(repetido.estado, 'ya_procesado');
  assert.equal(repetido.aviso.avisoId, abierto.aviso.avisoId);
  assert.equal(repetido.aviso.contadorDetecciones, 1,
    'Repetir el mismo evento no puede inventar otra detección.');
  assert.equal(repetido.eventoAuditoria, null);
  await assert.rejects(
    () => servicio.detectar({
      ...solicitudApertura,
      claveCausal: claveAutoridad()
    }),
    /pertenece a otra causa/
  );

  const consolidado = await servicio.detectar(deteccion(claveCausal, 2));
  assert.equal(consolidado.estado, 'consolidado');
  assert.equal(consolidado.aviso.avisoId, abierto.aviso.avisoId);
  assert.equal(consolidado.aviso.contadorDetecciones, 2);

  const escalado = await servicio.cambiarGravedad(cambioGravedad(
    claveCausal,
    'critica',
    3
  ));
  assert.equal(escalado.estado, 'escalado');
  assert.equal(escalado.transicion.transicionTipo, 'escalado');
  const sinCambio = await servicio.cambiarGravedad(cambioGravedad(
    claveCausal,
    'critica',
    4
  ));
  assert.equal(sinCambio.estado, 'sin_cambios');
  assert.equal(sinCambio.transicion, null);

  const desescalado = await servicio.cambiarGravedad(cambioGravedad(
    claveCausal,
    'advertencia',
    5
  ));
  assert.equal(desescalado.estado, 'desescalado');
  const resuelto = await servicio.resolver(resolucionTecnica(claveCausal, 6));
  assert.equal(resuelto.estado, 'resuelto');
  assert.equal(resuelto.aviso.estadoCiclo, 'resuelto');
  const resolucionRepetida = await servicio.resolver(resolucionTecnica(claveCausal, 7));
  assert.equal(resolucionRepetida.estado, 'sin_cambios');

  const deteccionTardia = await servicio.detectar(deteccion(claveCausal, 5));
  assert.equal(deteccionTardia.estado, 'sin_cambios');
  assert.equal(deteccionTardia.aviso.avisoId, abierto.aviso.avisoId);
  assert.equal(deteccionTardia.transicion, null,
    'Una detección anterior al cierre no debe reabrir ni abortar el consumidor.');

  const reabierto = await servicio.detectar(deteccion(claveCausal, 8));
  assert.equal(reabierto.estado, 'reabierto');
  assert.notEqual(reabierto.aviso.avisoId, abierto.aviso.avisoId);
  assert.equal(reabierto.aviso.cicloAnteriorId, abierto.aviso.avisoId);
  assert.equal(reabierto.transicion.transicionTipo, 'reapertura');
  assert.ok(auditoria.intenciones.every(({ preparada }) => preparada.huella.length === 32));
}

async function verificarResolucionAdministrativa(
  clienteSql,
  servicio,
  auditoria,
  claveCausal
) {
  const abierto = await servicio.detectar(deteccion(claveCausal, 10));
  assert.equal(abierto.estado, 'abierto');
  const resuelto = await servicio.resolver({
    ...base(claveCausal, 11),
    actor: {
      tipo: 'usuario',
      real: { tipo: 'usuario', id: '7' },
      efectivo: null,
      modo: 'directo'
    },
    viaResolucion: 'administrativa'
  });
  assert.equal(resuelto.estado, 'resuelto');
  const intencion = auditoria.intenciones.at(-1).intencion;
  assert.equal(intencion.tipo, 'plataforma.aviso_resuelto');
  assert.equal(intencion.actorReal.tipo, 'usuario');
  assert.equal(intencion.origen, 'web');
  assert.equal(intencion.productor, 'portal_federacion');

  assert.throws(
    () => servicio.resolver({
      ...base(claveComunicacion(), 12),
      actor: {
        tipo: 'usuario',
        real: { tipo: 'usuario', id: '7' },
        efectivo: null,
        modo: 'directo'
      },
      viaResolucion: 'administrativa'
    }),
    /no admite resolución administrativa/
  );
  assert.equal(await contarAvisos(clienteSql, claveCausal), 1);
}

async function verificarEstadoPersistido(clienteSql, claves) {
  const comunicacion = construirClaveCausalAvisoPlataforma(claves[0]);
  const filas = await clienteSql.consultar(
    `SELECT estado_ciclo, contador_detecciones, HEX(ciclo_anterior_aviso_id) AS anterior
     FROM avisos_plataforma
     WHERE clave_causal = ?
     ORDER BY primera_deteccion_utc ASC`,
    [Buffer.from(comunicacion.hashHex, 'hex')]
  );
  assert.equal(filas.length, 2);
  assert.equal(filas[0].estado_ciclo, 'resuelto');
  assert.equal(Number(filas[0].contador_detecciones), 2);
  assert.equal(filas[1].estado_ciclo, 'pendiente');
  assert.ok(filas[1].anterior);
  assert.equal(await contarHistorico(clienteSql, claves[0]), 6);
  assert.equal(await contarHistorico(clienteSql, claves[1]), 2);
  const snapshots = await clienteSql.consultar(
    `SELECT h.ordinal, h.contexto_humano, h.resumen
     FROM historico_avisos_plataforma h
     INNER JOIN avisos_plataforma a ON a.aviso_id = h.aviso_id
     WHERE a.clave_causal = ?
     ORDER BY a.id, h.ordinal`,
    [Buffer.from(comunicacion.hashHex, 'hex')]
  );
  assert.equal(snapshots.length, 6);
  assert.equal(json(snapshots[0].contexto_humano).instalacion, 'remota-prueba');
  assert.equal(json(snapshots[1].resumen).detecciones, 3);

  const [activos] = await clienteSql.consultar(
    `SELECT COUNT(*) AS total
     FROM avisos_plataforma
     WHERE clave_causal = ? AND estado_ciclo = 'pendiente'`,
    [Buffer.from(comunicacion.hashHex, 'hex')]
  );
  assert.equal(Number(activos.total), 1);
}

class RepositorioAuditoriaValidantePrueba {
  constructor() {
    this.fallarSiguiente = false;
    this.estadoSiguiente = 'incorporado';
    this.intenciones = [];
  }

  async incorporarEnTransaccion(intenciones, { conexion } = {}) {
    assert.equal(typeof conexion?.execute, 'function');
    if (this.fallarSiguiente) {
      this.fallarSiguiente = false;
      throw new Error('fallo auditable simulado');
    }
    const preparadas = intenciones.map((intencion) => ({
      intencion,
      preparada: prepararIntencionAuditoriaV1(intencion)
    }));
    this.intenciones.push(...preparadas);
    const estado = this.estadoSiguiente;
    this.estadoSiguiente = 'incorporado';
    return {
      eventos: preparadas.map(({ intencion }) => ({
        estado,
        eventoId: intencion.eventoId
      }))
    };
  }
}

function deteccion(claveCausal, desplazamiento) {
  return {
    ...base(claveCausal, desplazamiento),
    contextoHumano: { instalacion: 'remota-prueba', detalle: 'fixture saneado' },
    resumen: { detecciones: desplazamiento + 1 }
  };
}

function cambioGravedad(claveCausal, gravedad, desplazamiento) {
  return { ...base(claveCausal, desplazamiento), gravedad };
}

function resolucionTecnica(claveCausal, desplazamiento) {
  return {
    ...base(claveCausal, desplazamiento),
    viaResolucion: 'causa_desaparecida'
  };
}

function base(claveCausal, desplazamiento) {
  return {
    eventoId: generarIdAvisoPlataforma(),
    correlacionId: generarIdAvisoPlataforma(),
    efectivoEnUtc: instante(desplazamiento),
    causalidad: null,
    actor: ACTOR_RUNTIME,
    claveCausal
  };
}

function claveComunicacion() {
  return {
    versionCatalogo: 1,
    tipoCodigo: 'comunicacion',
    causaCodigo: 'relacion_silenciosa',
    objetoTipo: 'relacion_federada',
    objetoId: RELACION_ID,
    relacionId: RELACION_ID,
    flujoId: FLUJO_ID,
    scope: { tenantId: null, empresaId: null, sitioId: null }
  };
}

function claveAutoridad() {
  return {
    versionCatalogo: 1,
    tipoCodigo: 'autoridad',
    causaCodigo: 'perdida_autoridad_responsable',
    objetoTipo: 'responsable_federacion',
    objetoId: 'usuario:7',
    relacionId: null,
    flujoId: null,
    scope: { tenantId: null, empresaId: null, sitioId: null }
  };
}

function claveTiempo() {
  return {
    versionCatalogo: 1,
    tipoCodigo: 'tiempo',
    causaCodigo: 'desfase_temporal_fuera_tolerancia',
    objetoTipo: 'instalacion_federada',
    objetoId: 'sfid1.instalacion.AAAAAAAAAAAAAAAAAAAAAA',
    relacionId: null,
    flujoId: null,
    scope: { tenantId: null, empresaId: null, sitioId: null }
  };
}

function instante(desplazamiento) {
  return new Date(BASE_TIEMPO + desplazamiento * 1000).toISOString();
}

async function contarAvisos(clienteSql, claveCausal) {
  const clave = construirClaveCausalAvisoPlataforma(claveCausal);
  const [fila] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM avisos_plataforma WHERE clave_causal = ?',
    [Buffer.from(clave.hashHex, 'hex')]
  );
  return Number(fila.total);
}

async function contarHistorico(clienteSql, claveCausal) {
  const clave = construirClaveCausalAvisoPlataforma(claveCausal);
  const [fila] = await clienteSql.consultar(
    `SELECT COUNT(*) AS total
     FROM historico_avisos_plataforma h
     INNER JOIN avisos_plataforma a ON a.aviso_id = h.aviso_id
     WHERE a.clave_causal = ?`,
    [Buffer.from(clave.hashHex, 'hex')]
  );
  return Number(fila.total);
}

async function limpiar(clienteSql, clavesCausales) {
  for (const entrada of clavesCausales) {
    const clave = construirClaveCausalAvisoPlataforma(entrada);
    const filas = await clienteSql.consultar(
      `SELECT aviso_id
       FROM avisos_plataforma
       WHERE clave_causal = ?
       ORDER BY primera_deteccion_utc DESC, id DESC`,
      [Buffer.from(clave.hashHex, 'hex')]
    );
    for (const fila of filas) {
      await clienteSql.ejecutar(
        'DELETE FROM historico_avisos_plataforma WHERE aviso_id = ?',
        [fila.aviso_id]
      );
      await clienteSql.ejecutar(
        'DELETE FROM avisos_plataforma WHERE aviso_id = ?',
        [fila.aviso_id]
      );
    }
  }
}

function json(valor) {
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
}

await main();
