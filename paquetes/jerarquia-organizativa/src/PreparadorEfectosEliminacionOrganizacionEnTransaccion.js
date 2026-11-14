import { createHash } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearSolicitudCapturaFederacion,
  OPERACIONES_CAPTURA_FEDERACION
} from '../../federacion/src/OperacionesCapturaTecnicaFederacion.js';
import {
  crearResumenImpactoEliminacionOrganizacion,
  CLASES_IMPACTO_ELIMINACION_ORGANIZACION,
  PERFIL_RESUMEN_IMPACTO_ELIMINACION_ORGANIZACION,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION
} from './ContratoEliminacionAdministrativaOrganizacion.js';

const RETENCION_OBLIGACIONES_DIAS = 90;

export class PreparadorEfectosEliminacionOrganizacionEnTransaccion {
  constructor({
    repositorioDependenciasAgentes,
    nucleoPreparacionDependenciasAgente,
    capturadorFederacion,
    repositorioControlFederacion,
    repositorioSesionesWeb,
    repositorioObligacionesOrganizacion,
    preparadorEliminacionDdns = null,
    ahora = () => new Date(),
    retencionObligacionesDias = RETENCION_OBLIGACIONES_DIAS
  } = {}) {
    exigirPuerto(
      repositorioDependenciasAgentes,
      'cargarDependenciasBloqueadasParaAgenteEnTransaccion'
    );
    exigirPuerto(
      nucleoPreparacionDependenciasAgente,
      'prepararEnTransaccion'
    );
    exigirPuerto(capturadorFederacion, 'capturarEnTransaccion');
    exigirPuerto(
      repositorioControlFederacion,
      'cortarDependenciasEnTransaccion'
    );
    exigirPuerto(
      repositorioSesionesWeb,
      'invalidarVigentesPorUsuariosEnTransaccion'
    );
    exigirPuerto(
      repositorioObligacionesOrganizacion,
      'crearORecuperarVariasEnTransaccion'
    );
    exigirPuerto(
      repositorioObligacionesOrganizacion,
      'contarPorOperacionEnTransaccion'
    );
    if (preparadorEliminacionDdns !== null &&
        typeof preparadorEliminacionDdns
          ?.prepararOrganizacionEnTransaccion !== 'function') {
      throw new TypeError('La preparación organizativa recibió un preparador DDNS inválido.');
    }
    if (typeof ahora !== 'function') throw new TypeError('ahora debe ser invocable.');
    if (!Number.isInteger(retencionObligacionesDias) ||
        retencionObligacionesDias < 1) {
      throw new TypeError('retencionObligacionesDias debe ser positivo.');
    }
    Object.assign(this, {
      repositorioDependenciasAgentes,
      nucleoPreparacionDependenciasAgente,
      capturadorFederacion,
      repositorioControlFederacion,
      repositorioSesionesWeb,
      repositorioObligacionesOrganizacion,
      preparadorEliminacionDdns,
      ahora,
      retencionObligacionesDias
    });
  }

  async prepararEnTransaccion({ inventario } = {}, { conexion } = {}) {
    if (!conexion || typeof conexion !== 'object') {
      throw new TypeError('La preparación organizativa exige conexión prestada.');
    }
    const entrada = normalizarInventario(inventario);
    const { comando, raiz } = entrada;
    const usuariosAfectados = entrada.usuarios
      .filter(({ scope }) => pertenece(scope, raiz))
      .map(({ id }) => id);
    const actor = actorFederacion(comando);
    const actores = {
      real: {
        usuarioId: comando.fotografiaAutorizacion.actorReal.usuarioId
      },
      efectivo: {
        usuarioId: comando.fotografiaAutorizacion.actorEfectivo.usuarioId
      }
    };

    const preparacionDdns = this.preparadorEliminacionDdns
      ? await this.preparadorEliminacionDdns.prepararOrganizacionEnTransaccion({
          raiz: { tipo: raiz.tipo, id: raiz.id },
          agenteIds: entrada.agentes.map(({ id }) => id),
          operacionId: comando.identidades.operacionId,
          actores
        }, { conexion })
      : null;

    const retiradaEstructuraFederada = await this.capturadorFederacion
      .capturarEnTransaccion({
        familia: 'estructuraOrganizativa',
        prepararCapturas: ({ interfazCaptura }) =>
          interfazCaptura.prepararCapturaEnTransaccion(
            crearSolicitudCapturaFederacion(
              OPERACIONES_CAPTURA_FEDERACION.ESTRUCTURA_RETIRADA,
              { entidad: raiz.tipo, id: raiz.id }
            ),
            { conexion }
          )
      }, { conexion });
    const preparacionesAgentes = [];
    for (const agente of entrada.agentes) {
      const dependencias = await this.repositorioDependenciasAgentes
        .cargarDependenciasBloqueadasParaAgenteEnTransaccion(
          { agenteActual: agente },
          { conexion }
        );
      preparacionesAgentes.push(
        await this.nucleoPreparacionDependenciasAgente.prepararEnTransaccion({
          agenteActual: agente,
          operacionCausal: {
            operacionId: comando.identidades.operacionId,
            tipo: comando.tipoOperacion,
            version: comando.version
          },
          actores: {
            real: {
              usuarioId: comando.fotografiaAutorizacion.actorReal.usuarioId
            },
            efectivo: {
              usuarioId: comando.fotografiaAutorizacion.actorEfectivo.usuarioId
            },
            destinatarioUsuarioId: null
          },
          scope: { nivel: 'sitio', ...agente.scope },
          dependencias
        }, { conexion })
      );
    }

    const cortesFederacion = await this.repositorioControlFederacion
      .cortarDependenciasEnTransaccion({
        usuarioIds: usuariosAfectados,
        scopeAfectado: { entidad: raiz.tipo, id: raiz.id },
        causa: 'organizacionEliminada',
        actor
      }, { conexion });
    const sesionesWeb = await this.repositorioSesionesWeb
      .invalidarVigentesPorUsuariosEnTransaccion(
        usuariosAfectados,
        { conexion }
      );

    const creadaEnUtc = fechaValida(this.ahora(), 'ahora');
    const retenerHastaUtc = new Date(
      creadaEnUtc.getTime() + this.retencionObligacionesDias * 86_400_000
    );
    const obligacionesRaiz = crearObligacionesRaiz({
      entrada,
      usuariosAfectados
    });
    const referenciasRaiz = await this.repositorioObligacionesOrganizacion
      .crearORecuperarVariasEnTransaccion({
        operacionId: comando.identidades.operacionId,
        obligaciones: obligacionesRaiz,
        creadaEnUtc,
        retenerHastaUtc
      }, { conexion });
    const cantidadObligaciones = await this.repositorioObligacionesOrganizacion
      .contarPorOperacionEnTransaccion(
        { operacionId: comando.identidades.operacionId },
        { conexion }
      );
    const ejecucionesTriggers = agregarEjecucionesTriggers(
      preparacionesAgentes
    );
    const impactoFinal = reemplazarConteoObligaciones(
      entrada.impactoFinal,
      cantidadObligaciones
    );
    return congelarProfundo({
      inventario: entrada,
      usuariosAfectados,
      retiradaEstructuraFederada,
      cortesFederacion,
      sesionesWeb,
      preparacionDdns,
      preparacionesAgentes,
      ejecucionesTriggers,
      obligacionesRaiz: referenciasRaiz,
      impactoFinal
    });
  }
}

function crearObligacionesRaiz({ entrada, usuariosAfectados }) {
  const { comando, raiz } = entrada;
  const operacionId = comando.identidades.operacionId;
  const objetivoRaiz = { tipo: raiz.tipo, id: raiz.id };
  const tipos = ['retirar_estructura_organizacion_redis'];
  if (usuariosAfectados.length > 0) {
    tipos.push('invalidar_sesiones_usuarios_redis');
  }
  if (conteo(entrada.impactoFinal, 'monitores') !== '0') {
    tipos.push('invalidar_catalogo_monitores');
  }
  const obligaciones = tipos.map((tipo) => ({
    obligacionId: derivarIdentidad(operacionId, `${tipo}:${raiz.tipo}:${raiz.id}`),
    tipo,
    objetivo: objetivoRaiz
  }));
  const destinatarioId = comando.fotografiaAutorizacion.destinatarioUsuarioId;
  if (entrada.usuarios.some(({ id }) => id === destinatarioId)) {
    obligaciones.push({
      obligacionId: derivarIdentidad(
        operacionId,
        `publicar_invalidacion_portal:usuario:${destinatarioId}`
      ),
      tipo: 'publicar_invalidacion_portal',
      objetivo: { destinatarioUsuarioId: destinatarioId }
    });
  }
  return obligaciones;
}

function reemplazarConteoObligaciones(impacto, cantidad) {
  const conteos = impacto.conteos.map((actual) =>
    actual.categoria === 'obligaciones_postcommit'
      ? { ...actual, cantidad: String(cantidad) }
      : actual
  );
  if (!conteos.some(({ categoria }) => categoria === 'obligaciones_postcommit')) {
    conteos.push({
      categoria: 'obligaciones_postcommit',
      cantidad: String(cantidad),
      precision: 'exacta'
    });
  }
  return crearResumenImpactoEliminacionOrganizacion({
    perfil: PERFIL_RESUMEN_IMPACTO_ELIMINACION_ORGANIZACION,
    version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
    clase: CLASES_IMPACTO_ELIMINACION_ORGANIZACION.FINAL,
    conteos
  });
}

function agregarEjecucionesTriggers(preparaciones) {
  const ids = preparaciones.flatMap(
    ({ ejecucionesTriggers }) =>
      ejecucionesTriggers?.idsCorreoAceptadoPreservadas || []
  ).map(String);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError('Una ejecución de correo aparece en más de un agente.');
  }
  return {
    eliminadas: sumarPreparaciones(preparaciones, 'eliminadas'),
    correoAceptadoPreservadas:
      sumarPreparaciones(preparaciones, 'correoAceptadoPreservadas'),
    idsCorreoAceptadoPreservadas: ids
  };
}

function sumarPreparaciones(preparaciones, campo) {
  return preparaciones.reduce((total, preparacion) =>
    total + BigInt(preparacion.ejecucionesTriggers?.[campo] ?? 0), 0n
  ).toString();
}

function normalizarInventario(entrada) {
  if (!entrada?.comando || !entrada?.raiz || !Array.isArray(entrada.usuarios) ||
      !Array.isArray(entrada.agentes) || !entrada?.impactoFinal) {
    throw new TypeError('El inventario organizativo no está completo.');
  }
  const agentes = [...entrada.agentes];
  for (let indice = 1; indice < agentes.length; indice += 1) {
    if (BigInt(agentes[indice - 1].id) >= BigInt(agentes[indice].id)) {
      throw new TypeError('Los agentes deben llegar únicos y ordenados por id.');
    }
  }
  return congelarProfundo({
    comando: entrada.comando,
    raiz: entrada.raiz,
    usuarios: entrada.usuarios,
    agentes,
    preparacionAudienciaCorreo: entrada.preparacionAudienciaCorreo ?? null,
    impactoFinal: entrada.impactoFinal,
    ordenBloqueo: entrada.ordenBloqueo
  });
}

function actorFederacion(comando) {
  const realId = comando.fotografiaAutorizacion.actorReal.usuarioId;
  const efectivoId = comando.fotografiaAutorizacion.actorEfectivo.usuarioId;
  return Object.freeze({
    real: Object.freeze({ tipo: 'usuario', id: realId }),
    efectivo: realId === efectivoId
      ? null
      : Object.freeze({ tipo: 'usuario', id: efectivoId }),
    modo: realId === efectivoId ? 'directo' : 'impersonado'
  });
}

function pertenece(scope, raiz) {
  if (raiz.tipo === 'tenant') return scope.tenantId === raiz.id;
  if (raiz.tipo === 'empresa') return scope.empresaId === raiz.id;
  return scope.sitioId === raiz.id;
}

function conteo(impacto, categoria) {
  return String(impacto.conteos.find(
    (actual) => actual.categoria === categoria
  )?.cantidad ?? '0');
}

function derivarIdentidad(operacionId, etiqueta) {
  const padre = uuidV7AuditoriaABytes(operacionId);
  const salida = createHash('sha256')
    .update(padre)
    .update('\0', 'utf8')
    .update(etiqueta, 'utf8')
    .digest()
    .subarray(0, 16);
  padre.copy(salida, 0, 0, 6);
  salida[6] = 0x70 | (salida[6] & 0x0f);
  salida[8] = 0x80 | (salida[8] & 0x3f);
  if (salida.equals(padre)) salida[15] ^= 0x01;
  return bytesAUuidV7Auditoria(salida);
}

function fechaValida(valor, campo) {
  const fecha = valor instanceof Date ? new Date(valor) : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new TypeError(`${campo} no es válido.`);
  return fecha;
}

function exigirPuerto(puerto, metodo) {
  if (typeof puerto?.[metodo] !== 'function') {
    throw new Error(`La preparación organizativa exige ${metodo}().`);
  }
}

function congelarProfundo(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelarProfundo(hijo);
    Object.freeze(valor);
  }
  return valor;
}
