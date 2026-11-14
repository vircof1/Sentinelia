import { createHash, timingSafeEqual } from 'node:crypto';

import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  ErrorContratoEliminacionAdministrativaAgente
} from './ContratoEliminacionAdministrativaAgente.js';
import {
  CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
} from '../../coordinacion-durable/src/DiagnosticosOperacionesAdministrativas.js';
import {
  ErrorPreparacionEliminacionAgregadoAgente,
  NucleoPreparacionDependenciasAgenteEnTransaccion
} from './NucleoPreparacionDependenciasAgenteEnTransaccion.js';

const RETENCION_OBLIGACIONES_DIAS = 90;

export class AdaptadorPreparacionEliminacionDirectaAgenteEnTransaccion {
  constructor({
    repositorioEliminacion,
    servicioRetiradaFederada = null,
    repositorioOperacionesSesion = null,
    repositorioObligacionesPostcommit = null,
    nucleoPreparacionDependencias = null,
    preparadorEliminacionDdns = null,
    ahora = () => new Date(),
    retencionObligacionesDias = RETENCION_OBLIGACIONES_DIAS
  } = {}) {
    if (
      typeof repositorioEliminacion?.cargarInventarioBloqueadoEnTransaccion !==
      'function'
    ) {
      throw new Error(
        'El adaptador directo exige el repositorio de eliminación bloqueable.'
      );
    }
    this.repositorioEliminacion = repositorioEliminacion;
    this.servicioRetiradaFederada = servicioRetiradaFederada;
    this.repositorioOperacionesSesion = repositorioOperacionesSesion;
    this.repositorioObligacionesPostcommit = repositorioObligacionesPostcommit;
    this.nucleoPreparacionDependencias = nucleoPreparacionDependencias;
    if (preparadorEliminacionDdns !== null &&
        typeof preparadorEliminacionDdns?.prepararAgenteEnTransaccion !== 'function') {
      throw new TypeError('El adaptador directo recibió un preparador DDNS inválido.');
    }
    this.preparadorEliminacionDdns = preparadorEliminacionDdns;
    if (typeof ahora !== 'function') throw new TypeError('ahora debe ser invocable.');
    if (!Number.isInteger(retencionObligacionesDias) || retencionObligacionesDias < 1) {
      throw new TypeError('retencionObligacionesDias debe ser un entero positivo.');
    }
    this.ahora = ahora;
    this.retencionObligacionesDias = retencionObligacionesDias;
  }

  async prepararInventarioEnTransaccion(
    { lease } = {},
    { conexion } = {}
  ) {
    return (await this.#prepararInventarioConComando(lease, conexion)).inventario;
  }

  async prepararEnTransaccion(
    { lease } = {},
    { conexion } = {}
  ) {
    exigirPuertosPreparacion(this);
    const { inventario, comando } = await this.#prepararInventarioConComando(
      lease,
      conexion
    );
    if (inventario.estado === 'agente_ausente') {
      return congelar({
        ...inventario,
        comando,
        retiradasFederadas: null,
        neutralizacionSesion: null,
        obligacionesPostcommit: [],
        ejecucionesTriggers: {
          eliminadas: '0',
          correoRechazadoEliminadas: '0',
          correoAceptadoPreservadas: '0',
          idsCorreoAceptadoPreservadas: []
        },
        postcondicionesEsperadas: postcondicionesAusente(inventario.sujeto.id)
      });
    }

    const autorizacion = comando.fotografiaAutorizacion;
    const preparacionDdns = this.preparadorEliminacionDdns
      ? await this.preparadorEliminacionDdns.prepararAgenteEnTransaccion({
          agenteId: inventario.sujeto.id,
          operacionId: comando.identidades.operacionId,
          actores: {
            real: autorizacion.actorReal,
            efectivo: autorizacion.actorEfectivo
          }
        }, { conexion })
      : null;
    const nucleo = this.nucleoPreparacionDependencias ||
      new NucleoPreparacionDependenciasAgenteEnTransaccion({
        repositorioDependencias: this.repositorioEliminacion,
        servicioRetiradaFederada: this.servicioRetiradaFederada,
        repositorioOperacionesSesion: this.repositorioOperacionesSesion,
        repositorioObligacionesPostcommit:
          this.repositorioObligacionesPostcommit,
        ahora: this.ahora,
        retencionObligacionesDias: this.retencionObligacionesDias
      });
    const preparacionDependencias = await nucleo.prepararEnTransaccion({
      agenteActual: inventario.sujeto,
      operacionCausal: {
        operacionId: comando.identidades.operacionId,
        tipo: comando.tipoOperacion,
        version: comando.version
      },
      actores: {
        real: autorizacion.actorReal,
        efectivo: autorizacion.actorEfectivo,
        destinatarioUsuarioId: autorizacion.destinatarioUsuarioId
      },
      scope: inventario.sujeto.scope,
      dependencias: {
        conteosFinales: inventario.conteosFinales,
        conjuntosEstructurales: inventario.conjuntosEstructurales
      }
    }, { conexion });

    return congelar({
      ...inventario,
      comando,
      preparacionDdns,
      ...preparacionDependencias
    });
  }

  async #prepararInventarioConComando(lease, conexion) {
    let bloqueado;
    try {
      bloqueado = await this.repositorioEliminacion
        .cargarInventarioBloqueadoEnTransaccion(lease, { conexion });
    } catch (error) {
      if (error instanceof ErrorContratoEliminacionAdministrativaAgente) {
        throw new ErrorPreparacionEliminacionAgregadoAgente(
          CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
            .CONTRATO_INCOMPATIBLE,
          'El comando durable no cumple el contrato de eliminación vigente.'
        );
      }
      if (error?.codigo === 'agente_eliminacion_impacto_no_seguro') {
        throw new ErrorPreparacionEliminacionAgregadoAgente(
          error.codigo,
          error.message
        );
      }
      throw error;
    }
    if (bloqueado.estado === 'agente_ausente') {
      return {
        comando: bloqueado.comando,
        inventario: congelar({
          estado: 'agente_ausente',
          sujeto: bloqueado.comando.sujeto,
          fotografiaAdministrativa: null,
          fotografiaCanonica: null,
          huellaEstructuralSha256: null,
          conteosFinales: [],
          conjuntosEstructurales: conjuntosVacios(),
          ordenBloqueo: bloqueado.ordenBloqueo
        })
      };
    }

    const { comando, impacto, fotografiaAdministrativa } = bloqueado;
    validarMismoSujeto(comando.sujeto, fotografiaAdministrativa);
    const huellaEstructuralSha256 = createHash('sha256')
      .update(canonicalizarRfc8785(impacto.fotografiaCanonica), 'utf8')
      .digest('hex');
    if (!compararHuella(
      comando.fotografiaEstructural.huellaEstructuralSha256,
      huellaEstructuralSha256
    )) {
      throw estructuraModificada(
        'El agregado cambió después de aceptar la eliminación; requiere una confirmación nueva.'
      );
    }

    return {
      comando,
      inventario: congelar({
        estado: 'inventariado',
        sujeto: comando.sujeto,
        fotografiaAdministrativa,
        fotografiaCanonica: impacto.fotografiaCanonica,
        huellaEstructuralSha256,
        conteosFinales: impacto.conteos,
        conjuntosEstructurales: {
          reglas: impacto.fotografiaCanonica.reglas.map(({ id }) => id),
          monitores: impacto.fotografiaCanonica.monitores.map(({ id }) => id),
          asignacionesTrigger:
            impacto.fotografiaCanonica.asignacionesTrigger.map(({ id }) => id),
          triggersCompartidos: [...new Set(
            impacto.fotografiaCanonica.asignacionesTrigger
              .map(({ triggerId }) => triggerId)
          )].sort(compararDecimales),
          perfilesServidor:
            impacto.fotografiaCanonica.perfilesServidor
              .map(({ generacion }) => generacion),
          dependenciasFederadas:
            impacto.fotografiaCanonica.dependenciasFederadas
              .map((dependencia) => ({
                familia: dependencia.familia,
                tipo: dependencia.tipo,
                claveLocal: dependencia.claveLocal,
                elementoOrigenId: dependencia.elementoOrigenId
              })),
          concesionesDdns: impacto.fotografiaCanonica.ddns.concesiones
            .map(({ concesionId }) => concesionId)
        },
        ordenBloqueo: bloqueado.ordenBloqueo
      })
    };
  }
}

function exigirPuertosPreparacion(preparador) {
  if (preparador.nucleoPreparacionDependencias) {
    if (typeof preparador.nucleoPreparacionDependencias
      ?.prepararEnTransaccion !== 'function') {
      throw new Error('El núcleo preparador inyectado no satisface su puerto.');
    }
    return;
  }
  const puertos = [
    [preparador.repositorioEliminacion, 'cargarContextoSesionBloqueadaEnTransaccion'],
    [preparador.repositorioEliminacion, 'eliminarEjecucionesTriggersEnTransaccion'],
    [preparador.servicioRetiradaFederada, 'prepararEnTransaccion'],
    [preparador.repositorioOperacionesSesion, 'neutralizarPorEliminacionEnTransaccion'],
    [preparador.repositorioObligacionesPostcommit, 'crearORecuperarVariasEnTransaccion']
  ];
  if (puertos.some(([puerto, metodo]) => typeof puerto?.[metodo] !== 'function')) {
    throw new Error('El adaptador directo exige todos los puertos de preparación.');
  }
}

function postcondicionesAusente(agenteId) {
  return {
    agenteId,
    raizAntesDelDelete: '0',
    ejecucionesTriggers: '0',
    correoAceptadoPreservadas: '0',
    obligacionesPostcommit: '0',
    operacionesSesionReemplazadas: '0'
  };
}

function compararDecimales(a, b) {
  const izquierda = BigInt(a);
  const derecha = BigInt(b);
  return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
}

function validarMismoSujeto(confirmado, actual) {
  const mismoScope =
    confirmado.scope.nivel === actual.scope.nivel &&
    confirmado.scope.tenantId === actual.scope.tenantId &&
    confirmado.scope.empresaId === actual.scope.empresaId &&
    confirmado.scope.sitioId === actual.scope.sitioId;
  if (
    confirmado.id !== actual.id ||
    confirmado.guid !== actual.guid ||
    !mismoScope
  ) {
    throw estructuraModificada(
      'La identidad o el alcance del agente ya no coinciden con la confirmación.'
    );
  }
}

function compararHuella(esperada, actual) {
  const a = Buffer.from(String(esperada || ''), 'utf8');
  const b = Buffer.from(String(actual || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function estructuraModificada(mensaje) {
  return new ErrorPreparacionEliminacionAgregadoAgente(
    'agente_eliminacion_estructura_modificada',
    mensaje
  );
}

function conjuntosVacios() {
  return {
    reglas: [],
    monitores: [],
    asignacionesTrigger: [],
    triggersCompartidos: [],
    perfilesServidor: [],
    dependenciasFederadas: [],
    concesionesDdns: []
  };
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
