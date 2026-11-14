import {
  sanearDiagnosticoOperacionDurable
} from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ErrorActivacionArtefactosBind } from './ActivadorArtefactosBindDns.js';

export class PublicadorCoordinadoBindDns {
  constructor({
    coordinador,
    servicioFotografia,
    seccionCritica,
    activador,
    repositorioCoordinacion,
    servicioRechazosDdns = null,
    servicioBloqueosDdns = null,
    leaseTtlSegundos = 30,
    graciaLimpiezaMs = 86_400_000,
    limiteLimpieza = 20
  } = {}) {
    if (!coordinador?.reclamarSiguiente || !coordinador?.avanzar ||
        !coordinador?.registrarFallo || !servicioFotografia?.prepararEfecto ||
        !seccionCritica?.ejecutar || !activador?.activar ||
        !activador?.limpiar || !repositorioCoordinacion?.verificarAutoridadConLease) {
      throw new Error('El publicador coordinado BIND requiere coordinación, fotografía, sección crítica y activador.');
    }
    this.coordinador = coordinador;
    this.servicioFotografia = servicioFotografia;
    this.seccionCritica = seccionCritica;
    this.activador = activador;
    this.repositorioCoordinacion = repositorioCoordinacion;
    this.servicioRechazosDdns = servicioRechazosDdns;
    this.servicioBloqueosDdns = servicioBloqueosDdns;
    this.leaseTtlSegundos = entero(leaseTtlSegundos, 1, 300, 'leaseTtlSegundos');
    this.graciaLimpiezaMs = entero(graciaLimpiezaMs, 0, 31_536_000_000, 'graciaLimpiezaMs');
    this.limiteLimpieza = entero(limiteLimpieza, 1, 1_000, 'limiteLimpieza');
  }

  async publicarSiguiente({ limpiar = true } = {}) {
    const reclamada = await this.coordinador.reclamarSiguiente();
    if (!reclamada) {
      return Object.freeze({
        ok: true,
        omitida: true,
        motivo: 'sin_operaciones_dns'
      });
    }

    const { lease } = reclamada;
    let efectoPosibleObservado = Boolean(reclamada.operacion?.efectoPosible);
    let fotografia = null;
    let operacion = reclamada.operacion;
    try {
      const preparada = await this.servicioFotografia.prepararEfecto({
        lease,
        operacion: reclamada.operacion
      });
      efectoPosibleObservado = efectoPosibleObservado ||
        Boolean(preparada.operacion?.efectoPosible);

      if (preparada.consolidarSinRenderizar) {
        return Object.freeze({
          ok: true,
          omitida: true,
          motivo: 'recarga_ya_confirmada',
          lease,
          operacion: preparada.operacion
        });
      }

      if (preparada.divergente) {
        return Object.freeze({
          ok: false,
          recuperable: true,
          motivo: 'proyeccion_divergente',
          lease,
          operacion: preparada.operacion,
          sucesora: preparada.sucesora
        });
      }

      operacion = preparada.operacion;
      fotografia = preparada.fotografia;
      const validarAutoridad = () => this.#validarAutoridad(lease);
      const activacion = await this.seccionCritica.ejecutar({
        venceEnUtcMs: Date.now() + this.leaseTtlSegundos * 1000,
        validarAutoridad,
        trabajo: async () => {
          await exigirAutoridad(validarAutoridad);
          return this.activador.activar({
            generacionDns: operacion.generacionDns,
            proyeccion: fotografia.proyeccion,
            validarAutoridad
          });
        }
      });
      const limpieza = limpiar
        ? await this.activador.limpiar({
            generacionesProtegidas: [operacion.generacionDns],
            graciaMs: this.graciaLimpiezaMs,
            limite: this.limiteLimpieza
          })
        : Object.freeze({ eliminadas: 0 });

      return Object.freeze({
        ok: true,
        activada: Boolean(activacion.activada),
        adoptada: Boolean(activacion.adoptada),
        lease,
        operacion,
        fotografia,
        activacion,
        limpieza,
        resumen: resumenFotografia(fotografia, activacion)
      });
    } catch (error) {
      const rechazoDdns = await this.servicioRechazosDdns?.resolver?.({
        lease,
        operacion,
        fotografia,
        error
      });
      if (rechazoDdns?.atribuido) {
        return Object.freeze({
          ok: false,
          recuperable: !rechazoDdns.agotado,
          motivo: rechazoDdns.agotado
            ? 'publicacion_fallida'
            : 'rechazo_atribuible',
          lease,
          operacion: rechazoDdns.operacion,
          rechazoDdns
        });
      }
      const bloqueoDdns = await this.servicioBloqueosDdns?.resolver?.({
        lease,
        operacion,
        error
      });
      if (bloqueoDdns?.bloqueado) {
        return Object.freeze({
          ok: false,
          recuperable: true,
          motivo: 'publicacion_bloqueada',
          lease,
          operacion: bloqueoDdns.operacion,
          bloqueoDdns
        });
      }
      return this.#registrarFracaso(lease, error, {
        efectoPosibleObservado
      });
    }
  }

  async #validarAutoridad(lease) {
    return this.repositorioCoordinacion.verificarAutoridadConLease({
      generacionDns: lease.operacionId,
      instanciaId: lease.instanciaId,
      leaseToken: lease.leaseToken,
      fencingToken: lease.fencingToken
    });
  }

  async #registrarFracaso(lease, error, { efectoPosibleObservado = false } = {}) {
    const diagnostico = sanearDiagnosticoOperacionDurable({
      codigo: error?.codigo || 'bind_activacion_no_aplicada',
      mensaje: error?.message || 'No se pudo activar la proyección BIND.'
    });
    const efectoPosible = efectoPosibleObservado ||
      error instanceof ErrorActivacionArtefactosBind ||
      /efecto|selector|directorio|staging|BIND|lease|fencing/i.test(String(error?.message || ''));

    try {
      const resultado = efectoPosible
        ? await this.coordinador.avanzar(lease, {
            transicion: 'recuperacion_pendiente',
            datos: { diagnostico }
          })
        : await this.coordinador.registrarFallo(lease, {
            ...diagnostico,
            permanente: false,
            demoraReintentoSegundos: 5
          });
      return Object.freeze({
        ok: false,
        recuperable: efectoPosible,
        motivo: diagnostico.codigo,
        lease,
        operacion: resultado.operacion,
        diagnostico
      });
    } catch (causaRegistro) {
      return Object.freeze({
        ok: false,
        recuperable: true,
        motivo: 'lease_perdido_durante_fracaso',
        lease,
        diagnostico,
        errorRegistro: sanearDiagnosticoOperacionDurable({
          codigo: causaRegistro?.codigo || 'lease_perdido_durante_fracaso',
          mensaje: causaRegistro?.message || 'No se pudo registrar el fallo BIND.'
        })
      });
    }
  }
}

function resumenFotografia(fotografia, activacion) {
  const artefactos = fotografia?.proyeccion?.listarArtefactos?.() || [];
  return Object.freeze({
    zonas: String(fotografia?.catalogo?.zonas?.length ?? 0),
    artefactos: String(artefactos.length),
    cambios: activacion?.activada ? '1' : '0'
  });
}

async function exigirAutoridad(validarAutoridad) {
  if (await validarAutoridad() !== true) {
    throw new AutoridadPublicacionBindPerdida();
  }
}

export class AutoridadPublicacionBindPerdida extends Error {
  constructor() {
    super('El publicador BIND perdió lease o fencing antes del efecto filesystem.');
    this.name = 'AutoridadPublicacionBindPerdida';
    this.codigo = 'bind_autoridad_perdida';
  }
}

function entero(valor, minimo, maximo, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nombre} queda fuera de rango.`);
  }
  return numero;
}
