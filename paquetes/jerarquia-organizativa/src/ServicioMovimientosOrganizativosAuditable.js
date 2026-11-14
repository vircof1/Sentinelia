import { createHash } from 'node:crypto';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearSolicitudCapturaFederacion,
  OPERACIONES_CAPTURA_FEDERACION
} from '../../federacion/src/OperacionesCapturaTecnicaFederacion.js';

export class ServicioMovimientosOrganizativosAuditable {
  constructor({
    fronteraTransaccional,
    servicioAutoridadMovimientos,
    repositorioMovimientos,
    repositorioSesionesWeb,
    repositorioOperacionesAgentes,
    repositorioControlFederacion = null,
    capturadorFederacion = null,
    servicioAuditoria,
    ahora = () => new Date()
  } = {}) {
    if (!fronteraTransaccional?.ejecutar ||
        !servicioAutoridadMovimientos?.autorizarEnTransaccion ||
        !repositorioMovimientos?.moverEmpresaEnTransaccion ||
        !repositorioMovimientos?.moverSitioEnTransaccion ||
        !repositorioSesionesWeb?.bloquearVigentesPorUsuarios ||
        !repositorioSesionesWeb?.invalidarVigentesPorUsuariosEnTransaccion ||
        !repositorioOperacionesAgentes?.incrementarScopeYFencingEnTransaccion ||
        !repositorioOperacionesAgentes?.crearInvalidacionPorMovimientoEnTransaccion ||
        !servicioAuditoria?.registrarMovimientoConResultadosEnTransaccion ||
        typeof ahora !== 'function') {
      throw new Error('El movimiento organizativo auditable requiere todos sus puertos.');
    }
    Object.assign(this, {
      fronteraTransaccional,
      servicioAutoridadMovimientos,
      repositorioMovimientos,
      repositorioSesionesWeb,
      repositorioOperacionesAgentes,
      servicioAuditoria,
      repositorioControlFederacion,
      capturadorFederacion,
      ahora
    });
    if (capturadorFederacion !== null &&
        typeof capturadorFederacion?.capturarEnTransaccion !== 'function') {
      throw new Error('El capturador federado del movimiento no es transaccional.');
    }
  }

  moverEmpresa(entrada = {}) {
    return this.#mover({
      ...entrada,
      entidad: 'empresa',
      metodoRepositorio: 'moverEmpresaEnTransaccion'
    });
  }

  moverSitio(entrada = {}) {
    return this.#mover({
      ...entrada,
      entidad: 'sitio',
      metodoRepositorio: 'moverSitioEnTransaccion'
    });
  }

  async #mover({
    entidad,
    metodoRepositorio,
    datos,
    contextoUsuarioActual,
    autorizar
  }) {
    if (typeof autorizar !== 'function') {
      throw new Error('La reautorización del movimiento no es invocable.');
    }
    const identidad = crearIdentidadMovimiento(this.ahora());
    const actor = crearActor(contextoUsuarioActual);
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      await this.servicioAutoridadMovimientos.autorizarEnTransaccion({
        entidad,
        datos
      }, { conexion });
      const movimiento = await this.repositorioMovimientos[metodoRepositorio](
        { ...datos, autorizar },
        { conexion }
      );
      const cortesFederacion = this.repositorioControlFederacion
        ? await this.repositorioControlFederacion.cortarDependenciasEnTransaccion({
            usuarioIds: movimiento.usuarios,
            scopeAfectado: { entidad, id: datos.idEmpresa ?? datos.idSitio ?? datos.id },
            causa: 'organizacionMovida', actor
          }, { conexion })
        : [];
      const sesionesBloqueadas = await this.repositorioSesionesWeb
        .bloquearVigentesPorUsuarios(movimiento.usuarios, { conexion });
      const identidadesWeb = new Map(sesionesBloqueadas.map((sesion) => [
        sesion.sesionAuditoriaId,
        crearIdentidadResultado(identidad, 'web', sesion.sesionAuditoriaId)
      ]));
      const sesionesInvalidadas = await this.repositorioSesionesWeb
        .invalidarVigentesPorUsuariosEnTransaccion(movimiento.usuarios, { conexion });
      const invalidacionesAgentes = [];
      for (const agente of movimiento.agentes) {
        if (!agente.sesionAuditoriaId) {
          await this.repositorioOperacionesAgentes
            .incrementarScopeYFencingEnTransaccion(agente.agenteId, { conexion });
          continue;
        }
        const ids = crearIdentidadResultado(
          identidad, 'agente', agente.sesionAuditoriaId
        );
        const scopePosterior = proyectarScopeAgentePosterior(
          agente.scopeAnterior,
          movimiento.scopePosterior,
          entidad
        );
        const operacion = await this.repositorioOperacionesAgentes
          .crearInvalidacionPorMovimientoEnTransaccion({
            operacionId: ids.operacionDurableId,
            causaOperacionId: identidad.claveOperacion,
            agenteId: agente.agenteId,
            sesionAuditoriaId: agente.sesionAuditoriaId,
            huellaIntencion: huellaInvalidacion({
              operacionId: ids.operacionDurableId,
              causaOperacionId: identidad.claveOperacion,
              agenteId: agente.agenteId,
              sesionAuditoriaId: agente.sesionAuditoriaId,
              scope: scopePosterior,
              actor
            }),
            actor: actor.real,
            actorEfectivo: actor.efectivo,
            origen: 'web',
            scope: scopePosterior
          }, { conexion });
        invalidacionesAgentes.push({ agente, ids, operacion });
      }
      const par = crearParMovimiento({
        entidad,
        recurso: movimiento.recurso,
        scopeAnterior: movimiento.scopeAnterior,
        scopePosterior: movimiento.scopePosterior,
        impactoResumen: movimiento.impactoResumen,
        identidad,
        actor
      });
      const resultados = [
        ...sesionesInvalidadas.map((sesion) => crearEventoSesion({
          familia: 'usuario',
          sesionAuditoriaId: sesion.sesionAuditoriaId,
          scope: sesion.scopeEfectivoActual,
          ids: identidadesWeb.get(sesion.sesionAuditoriaId),
          identidad,
          actor
        })),
        ...invalidacionesAgentes.map(({ agente, ids }) => crearEventoSesion({
          familia: 'agente',
          sesionAuditoriaId: agente.sesionAuditoriaId,
          scope: agente.scopeAnterior,
          ids,
          identidad,
          actor
        }))
      ];
      const eventoMetadatos = crearEventoMetadatos({
        entidad,
        anterior: movimiento.recursoAnterior,
        posterior: movimiento.recurso,
        scope: movimiento.scopePosterior,
        identidad,
        actor
      });
      await this.servicioAuditoria.registrarMovimientoConResultadosEnTransaccion({
        cambioEfectivo: true,
        salida: par.salida,
        entrada: par.entrada,
        principales: eventoMetadatos ? [eventoMetadatos] : [],
        resultados
      }, { conexion });
      if (this.capturadorFederacion) {
        await this.capturadorFederacion.capturarEnTransaccion({
          familia: 'estructuraOrganizativa',
          prepararCapturas: ({ interfazCaptura }) =>
            interfazCaptura.prepararCapturaEnTransaccion(
              crearSolicitudCapturaFederacion(
                OPERACIONES_CAPTURA_FEDERACION.ESTRUCTURA_MOVIMIENTO,
                { entidad, id: movimiento.recurso.id }
              ),
              { conexion }
            )
        }, { conexion });
      }
      movimiento.recurso.metaActualizacion = crearMeta(entidad, movimiento);
      if (this.repositorioControlFederacion) {
        movimiento.recurso.metaActualizacion.cortesFederacion = cortesFederacion.length;
      }
      return movimiento.recurso;
    });
  }
}

function crearIdentidadMovimiento(valorFecha) {
  const fecha = valorFecha instanceof Date ? valorFecha : new Date(valorFecha);
  if (Number.isNaN(fecha.getTime())) throw new Error('El reloj del movimiento no es válido.');
  return Object.freeze({
    salidaId: generarUuidV7Auditoria(),
    entradaId: generarUuidV7Auditoria(),
    metadatosId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    claveOperacion: generarUuidV7Auditoria(),
    efectivoEnUtc: fecha.toISOString()
  });
}

function crearEventoMetadatos({ entidad, anterior, posterior, scope, identidad, actor }) {
  const antesCompleto = fotografiaMetadatos(entidad, anterior);
  const despuesCompleto = fotografiaMetadatos(entidad, posterior);
  const camposCambiados = Object.keys(antesCompleto)
    .filter((campo) => antesCompleto[campo] !== despuesCompleto[campo])
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (camposCambiados.length === 0) return null;
  return {
    eventoId: identidad.metadatosId,
    tipo: entidad === 'empresa'
      ? 'organizacion.empresa_actualizada' : 'organizacion.sitio_actualizado',
    versionContrato: 1,
    flujo: 'organizacion',
    claveCadena: cadena('organizacion', scope.tenantId),
    actorReal: actor.real,
    actorEfectivo: actor.efectivo,
    modoActuacion: actor.modo,
    sujeto: { tipo: entidad, id: idDecimal(posterior.id, 'sujeto') },
    origen: 'web',
    scope,
    correlacionId: identidad.correlacionId,
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: `${identidad.claveOperacion}:metadatos`,
    rolEvento: 'principal',
    efectivoEnUtc: identidad.efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'actualizado',
      camposCambiados,
      antes: seleccionar(antesCompleto, camposCambiados),
      despues: seleccionar(despuesCompleto, camposCambiados)
    }
  };
}

function fotografiaMetadatos(entidad, recurso) {
  const base = {
    nombre: recurso.nombre,
    alias: recurso.alias,
    descripcion: recurso.descripcion ?? null,
    activo: recurso.estado === 'activo'
  };
  if (entidad === 'empresa') return { ...base, cif: recurso.cif ?? null };
  return { ...base, timezone: recurso.timezone };
}

function seleccionar(origen, campos) {
  return Object.fromEntries(campos.map((campo) => [campo, origen[campo]]));
}

function crearIdentidadResultado(identidad, familia, sesionAuditoriaId) {
  return Object.freeze({
    eventoId: generarUuidV7Auditoria(),
    operacionDurableId: generarUuidV7Auditoria(),
    claveOperacion: `${identidad.claveOperacion}:${familia}:${sesionAuditoriaId}`
  });
}

function crearActor(contexto) {
  const real = { tipo: 'usuario', id: idDecimal(contexto?.idUsuarioReal, 'actor real') };
  const efectivoId = idDecimal(contexto?.idUsuario, 'actor efectivo');
  const efectivo = real.id === efectivoId
    ? null : { tipo: 'usuario', id: efectivoId };
  return Object.freeze({
    real: Object.freeze(real),
    efectivo: efectivo ? Object.freeze(efectivo) : null,
    modo: efectivo ? 'impersonado' : 'directo'
  });
}

function crearParMovimiento({
  entidad, recurso, scopeAnterior, scopePosterior, impactoResumen, identidad, actor
}) {
  const comun = {
    versionContrato: 1,
    flujo: 'organizacion',
    actorReal: actor.real,
    actorEfectivo: actor.efectivo,
    modoActuacion: actor.modo,
    sujeto: { tipo: entidad, id: idDecimal(recurso.id, 'sujeto') },
    origen: 'web',
    correlacionId: identidad.correlacionId,
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: identidad.claveOperacion,
    efectivoEnUtc: identidad.efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
  };
  return Object.freeze({
    salida: {
      ...comun,
      eventoId: identidad.salidaId,
      tipo: 'scope.entidad_salida',
      claveCadena: cadena('organizacion', scopeAnterior.tenantId),
      scope: scopeAnterior,
      rolEvento: 'salida',
      payload: {
        direccion: 'salida', scopePropio: scopeAnterior,
        eventoContraparteId: identidad.entradaId, impactoResumen
      }
    },
    entrada: {
      ...comun,
      eventoId: identidad.entradaId,
      tipo: 'scope.entidad_entrada',
      claveCadena: cadena('organizacion', scopePosterior.tenantId),
      scope: scopePosterior,
      rolEvento: 'entrada',
      payload: {
        direccion: 'entrada', scopePropio: scopePosterior,
        eventoContraparteId: identidad.salidaId, impactoResumen
      }
    }
  });
}

function crearEventoSesion({
  familia, sesionAuditoriaId, scope, ids, identidad, actor
}) {
  const agente = familia === 'agente';
  return {
    eventoId: ids.eventoId,
    tipo: agente ? 'agente.sesion_invalidada' : 'usuario.sesion_invalidada',
    versionContrato: 1,
    flujo: agente ? 'agentes' : 'usuarios',
    claveCadena: cadena(agente ? 'agentes' : 'usuarios', scope.tenantId),
    actorReal: actor.real,
    actorEfectivo: actor.efectivo,
    modoActuacion: actor.modo,
    sujeto: {
      tipo: agente ? 'sesion_agente' : 'sesion_usuario',
      id: sesionAuditoriaId
    },
    origen: 'web',
    scope,
    correlacionId: identidad.correlacionId,
    causalidad: { tipo: 'evento_auditoria', id: identidad.salidaId },
    productor: 'portal_web',
    claveOperacion: ids.claveOperacion,
    rolEvento: 'resultado',
    efectivoEnUtc: identidad.efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      sesionAuditoriaId,
      resultado: 'invalidada',
      causa: 'scope_cambiado'
    }
  };
}

function proyectarScopeAgentePosterior(anterior, posteriorRaiz, entidad) {
  if (entidad === 'empresa') {
    return Object.freeze({ ...anterior, tenantId: posteriorRaiz.tenantId });
  }
  return Object.freeze({
    ...anterior,
    tenantId: posteriorRaiz.tenantId,
    empresaId: posteriorRaiz.empresaId
  });
}

function huellaInvalidacion(datos) {
  return createHash('sha256').update(
    [
      'sentinelia:movimiento:invalidacion:v1',
      datos.causaOperacionId,
      datos.operacionId,
      datos.agenteId,
      datos.sesionAuditoriaId,
      datos.actor.real.tipo,
      datos.actor.real.id,
      datos.actor.efectivo?.tipo ?? '-',
      datos.actor.efectivo?.id ?? '-',
      datos.scope.tenantId,
      datos.scope.empresaId,
      datos.scope.sitioId ?? '-'
    ].join('\0'),
    'utf8'
  ).digest('hex');
}

function crearMeta(entidad, movimiento) {
  if (entidad === 'empresa') return {
    cambioTenant: true,
    tenantAnteriorId: movimiento.scopeAnterior.tenantId,
    tenantAnteriorNombre: null,
    tenantNuevoId: movimiento.scopePosterior.tenantId,
    tenantNuevoNombre: movimiento.recurso.tenantNombre
  };
  return {
    cambioEmpresa: true,
    empresaAnteriorId: movimiento.scopeAnterior.empresaId,
    empresaAnteriorNombre: null,
    empresaNuevaId: movimiento.scopePosterior.empresaId,
    empresaNuevaNombre: movimiento.recurso.empresaNombre,
    tenantAnteriorId: movimiento.scopeAnterior.tenantId,
    tenantAnteriorNombre: null,
    tenantNuevoId: movimiento.scopePosterior.tenantId,
    tenantNuevoNombre: movimiento.recurso.tenantNombre
  };
}

function cadena(flujo, tenantId) {
  return `${flujo}:tenant:${idDecimal(tenantId, 'tenantId')}`;
}

function idDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error(`${nombre} debe ser id decimal positivo.`);
  return texto;
}
