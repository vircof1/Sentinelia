import { createHash } from 'node:crypto';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import {
  crearSolicitudCapturaFederacion,
  OPERACIONES_CAPTURA_FEDERACION
} from '../../federacion/src/OperacionesCapturaTecnicaFederacion.js';
import {
  crearErrorInventarioAgentesNoVerificable,
  crearErrorOrganizacionConAgentes
} from './ErroresEliminacionOrganizativa.js';

const DEFINICIONES = Object.freeze({
  tenant: Object.freeze({ tabla: 'tenants', tipo: 'organizacion.tenant_eliminado' }),
  empresa: Object.freeze({ tabla: 'empresas', tipo: 'organizacion.empresa_eliminada' }),
  sitio: Object.freeze({ tabla: 'sitios', tipo: 'organizacion.sitio_eliminado' })
});

export class ServicioEliminacionesOrganizativasAuditable {
  constructor({
    fronteraTransaccional,
    repositorioCrud,
    repositorioEliminaciones,
    servicioImpacto,
    repositorioSesionesWeb,
    repositorioOperacionesAgentes,
    repositorioControlFederacion = null,
    capturadorFederacion = null,
    servicioAuditoria,
    limpiadorPostCommit,
    ahora = () => new Date()
  } = {}) {
    if (!fronteraTransaccional?.ejecutar ||
        !repositorioCrud?.buscarBloqueadoEnTransaccion ||
        !repositorioEliminaciones?.listarDescendientesEnTransaccion ||
        !repositorioEliminaciones?.eliminarEnTransaccion ||
        !servicioImpacto?.evaluarEnTransaccion ||
        !repositorioSesionesWeb?.invalidarVigentesPorUsuariosEnTransaccion ||
        !repositorioOperacionesAgentes?.neutralizarPorEliminacionEnTransaccion ||
        !servicioAuditoria?.registrarEnTransaccion ||
        !limpiadorPostCommit?.ejecutar || typeof ahora !== 'function') {
      throw new Error('La eliminación organizativa auditable requiere todos sus puertos.');
    }
    Object.assign(this, {
      fronteraTransaccional,
      repositorioCrud,
      repositorioEliminaciones,
      servicioImpacto,
      repositorioSesionesWeb,
      repositorioOperacionesAgentes,
      servicioAuditoria,
      limpiadorPostCommit,
      capturadorFederacion,
      ahora
    });
    this.repositorioControlFederacion = repositorioControlFederacion;
    if (capturadorFederacion !== null &&
        typeof capturadorFederacion?.capturarEnTransaccion !== 'function') {
      throw new Error('El capturador federado de eliminaciones no es transaccional.');
    }
  }

  async eliminar({ entidad, id, contextoUsuarioActual, autorizar } = {}) {
    const definicion = DEFINICIONES[entidad];
    if (!definicion) throw new Error('Entidad organizativa no eliminable.');
    if (typeof autorizar !== 'function') {
      throw new Error('La reautorización de la eliminación no es invocable.');
    }
    const identidad = crearIdentidad(this.ahora());
    const actor = crearActor(contextoUsuarioActual);
    const resultado = await this.fronteraTransaccional.ejecutar(async (conexion) => {
      const raiz = await this.repositorioCrud.buscarBloqueadoEnTransaccion(
        entidad, id, { conexion }
      );
      if (!raiz) throw new Error(`El ${entidad} ya no existe.`);
      if (await autorizar(raiz) !== true) {
        throw new Error(`El scope actual ya no autoriza eliminar ${entidad}.`);
      }
      const impacto = await this.servicioImpacto.evaluarEnTransaccion({
        tablaRaiz: definicion.tabla,
        idRaiz: id
      }, { conexion });
      if (Number(impacto.resumen.totalBloqueosPotenciales) > 0) {
        throw new Error('La eliminación conserva dependencias que bloquean la cascada.');
      }
      const descendientes = await this.repositorioEliminaciones
        .listarDescendientesEnTransaccion(entidad, id, { conexion });
      asegurarAgentesEliminables(descendientes, { entidad, id });
      const retiradasFederadas = this.capturadorFederacion
        ? await this.capturadorFederacion.capturarEnTransaccion({
            familia: 'estructuraOrganizativa',
            prepararCapturas: ({ interfazCaptura }) =>
              interfazCaptura.prepararCapturaEnTransaccion(
                crearSolicitudCapturaFederacion(
                  OPERACIONES_CAPTURA_FEDERACION.ESTRUCTURA_RETIRADA,
                  { entidad, id }
                ),
                { conexion }
              )
          }, { conexion })
        : null;
      const cortesFederacion = this.repositorioControlFederacion
        ? await this.repositorioControlFederacion.cortarDependenciasEnTransaccion({
            usuarioIds: descendientes.usuarios,
            scopeAfectado: { entidad, id },
            causa: 'organizacionEliminada', actor
          }, { conexion })
        : [];
      const sesionesWeb = await this.repositorioSesionesWeb
        .invalidarVigentesPorUsuariosEnTransaccion(descendientes.usuarios, { conexion });
      const invalidacionesTecnicas = [];
      for (const agente of descendientes.agentes) {
        const operacionId = generarUuidV7Auditoria();
        const entrada = {
          operacionId,
          causaOperacionId: identidad.claveOperacion,
          agenteId: agente.agenteId,
          sesionAuditoriaId: agente.sesionAuditoriaId,
          actor: actor.real,
          actorEfectivo: actor.efectivo,
          origen: 'web',
          scope: agente.scope
        };
        const neutralizacion = await this.repositorioOperacionesAgentes
          .neutralizarPorEliminacionEnTransaccion({
            ...entrada,
            huellaIntencion: agente.sesionAuditoriaId
              ? huellaInvalidacion(entrada)
              : undefined
          }, { conexion });
        invalidacionesTecnicas.push(Object.freeze({ agente, ...neutralizacion }));
      }
      await this.repositorioEliminaciones.eliminarEnTransaccion(
        entidad, id, { conexion }
      );
      await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: crearEvento({
          entidad,
          tipo: definicion.tipo,
          raiz,
          impacto,
          identidad,
          actor
        })
      }, { conexion });
      return Object.freeze({
        entidad,
        id: String(id),
        usuarios: descendientes.usuarios,
        sesionesWeb,
        invalidacionesTecnicas: Object.freeze(invalidacionesTecnicas),
        ...(retiradasFederadas ? { retiradasFederadas } : {}),
        ...(this.repositorioControlFederacion ? { cortesFederacion } : {})
      });
    });
    await this.limpiadorPostCommit.ejecutar(resultado);
    return true;
  }
}

function asegurarAgentesEliminables(descendientes, { entidad, id }) {
  if (!Array.isArray(descendientes?.agentes)) {
    throw crearErrorInventarioAgentesNoVerificable({ entidad, id });
  }
  if (descendientes.agentes.length > 0) {
    throw crearErrorOrganizacionConAgentes({
      entidad,
      id,
      cantidadAgentes: descendientes.agentes.length
    });
  }
}

function crearEvento({ entidad, tipo, raiz, impacto, identidad, actor }) {
  const scope = scopeDe(entidad, raiz);
  const dependencias = BigInt(impacto.resumen.totalEliminacionesEnCascada);
  const referencias = BigInt(impacto.resumen.totalReferenciasDesacopladas);
  return {
    eventoId: identidad.eventoId,
    tipo,
    versionContrato: 1,
    flujo: 'organizacion',
    claveCadena: `organizacion:tenant:${scope.tenantId}`,
    actorReal: actor.real,
    actorEfectivo: actor.efectivo,
    modoActuacion: actor.modo,
    sujeto: { tipo: entidad, id: idDecimal(raiz.id, 'sujeto') },
    origen: 'web',
    scope,
    correlacionId: identidad.correlacionId,
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: identidad.claveOperacion,
    rolEvento: 'principal',
    efectivoEnUtc: identidad.efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'eliminado',
      antes: fotografiar(entidad, raiz),
      despues: null,
      impactoResumen: dependencias === 0n && referencias === 0n ? null : {
        dependenciasEliminadas: dependencias.toString(),
        referenciasDesacopladas: referencias.toString()
      }
    }
  };
}

function crearIdentidad(valorFecha) {
  const fecha = valorFecha instanceof Date ? valorFecha : new Date(valorFecha);
  if (Number.isNaN(fecha.getTime())) throw new Error('El reloj de eliminación no es válido.');
  return Object.freeze({
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    claveOperacion: generarUuidV7Auditoria(),
    efectivoEnUtc: fecha.toISOString()
  });
}

function crearActor(contexto) {
  const real = { tipo: 'usuario', id: idDecimal(contexto?.idUsuarioReal, 'actor real') };
  const efectivoId = idDecimal(contexto?.idUsuario, 'actor efectivo');
  const efectivo = real.id === efectivoId ? null : { tipo: 'usuario', id: efectivoId };
  return Object.freeze({
    real: Object.freeze(real),
    efectivo: efectivo ? Object.freeze(efectivo) : null,
    modo: efectivo ? 'impersonado' : 'directo'
  });
}

function fotografiar(entidad, recurso) {
  const base = {
    nombre: recurso.nombre,
    alias: recurso.alias,
    descripcion: recurso.descripcion ?? null,
    activo: recurso.estado === 'activo'
  };
  if (entidad === 'empresa') return {
    tenantId: String(recurso.tenantId), ...base, cif: recurso.cif ?? null
  };
  if (entidad === 'sitio') return {
    tenantId: String(recurso.tenantId),
    empresaId: String(recurso.empresaId),
    ...base,
    timezone: recurso.timezone
  };
  return base;
}

function scopeDe(entidad, recurso) {
  return {
    tenantId: idDecimal(entidad === 'tenant' ? recurso.id : recurso.tenantId, 'tenantId'),
    empresaId: entidad === 'empresa' ? idDecimal(recurso.id, 'empresaId')
      : entidad === 'sitio' ? idDecimal(recurso.empresaId, 'empresaId') : null,
    sitioId: entidad === 'sitio' ? idDecimal(recurso.id, 'sitioId') : null
  };
}

function huellaInvalidacion(datos) {
  return createHash('sha256').update(JSON.stringify({
    operacionId: datos.operacionId,
    causaOperacionId: datos.causaOperacionId,
    agenteId: String(datos.agenteId),
    sesionAuditoriaId: datos.sesionAuditoriaId,
    actor: datos.actor,
    actorEfectivo: datos.actorEfectivo,
    origen: datos.origen,
    scope: datos.scope
  })).digest();
}

function idDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error(`${nombre} debe ser un id decimal positivo.`);
  return texto;
}
