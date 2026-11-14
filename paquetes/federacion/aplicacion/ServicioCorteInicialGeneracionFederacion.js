import { FronteraTransaccionalFederacion } from '../adaptadores/FronteraTransaccionalFederacion.js';

export class ErrorCorteInicialGeneracionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorCorteInicialGeneracionFederacion';
    this.codigo = codigo;
  }
}

export class ServicioCorteInicialGeneracionFederacion {
  constructor({
    clienteSql,
    repositorioFlujos,
    repositorioOcurrencias,
    adaptadorCaptura,
    fuenteFotografia,
    guardiaActivacion = null
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El corte inicial federado requiere SQL operativo.');
    }
    if (typeof repositorioFlujos?.crearFlujoInicial !== 'function') {
      throw new Error('El corte inicial federado requiere el repositorio de flujos.');
    }
    if (typeof repositorioOcurrencias?.bloquearCorteInicialEnTransaccion !== 'function' ||
        typeof repositorioOcurrencias?.cerrarCorteInicialEnTransaccion !== 'function') {
      throw new Error('El corte inicial federado requiere el repositorio de ocurrencias.');
    }
    if (typeof adaptadorCaptura?.capturarEnTransaccion !== 'function') {
      throw new Error('El corte inicial federado requiere captura transaccional.');
    }
    if (typeof fuenteFotografia?.listarCapturasEnTransaccion !== 'function') {
      throw new Error('El corte inicial federado requiere una fuente de fotografía local.');
    }
    this.repositorioFlujos = repositorioFlujos;
    this.repositorioOcurrencias = repositorioOcurrencias;
    this.adaptadorCaptura = adaptadorCaptura;
    this.fuenteFotografia = fuenteFotografia;
    if (guardiaActivacion !== null &&
        typeof guardiaActivacion?.exigirActiva !== 'function') {
      throw new Error('guardiaActivacion debe implementar exigirActiva().');
    }
    this.guardiaActivacion = guardiaActivacion;
    this.frontera = new FronteraTransaccionalFederacion(clienteSql);
  }

  async preparar({ flujo, generacion } = {}) {
    await this.guardiaActivacion?.exigirActiva('preparar_corte_inicial');
    return this.repositorioFlujos.crearFlujoInicial({
      flujo,
      generacion,
      corteInicialPendiente: true
    });
  }

  async prepararReemplazo({ flujo, generacion } = {}) {
    await this.guardiaActivacion?.exigirActiva('preparar_corte_revision_concesion');
    if (typeof this.repositorioFlujos?.prepararGeneracionConcesion !== 'function') {
      throw new Error('El repositorio no admite reemplazo por concesión.');
    }
    return this.repositorioFlujos.prepararGeneracionConcesion({
      flujoId: flujo.flujoId,
      generacionId: generacion.generacionId,
      installationPropietariaId: generacion.propietario.installationId,
      bootPropietarioId: generacion.propietario.bootId,
      contexto: flujo.contexto,
      corteInicialPendiente: true
    });
  }

  async cerrar({ flujoId, generacionId } = {}) {
    await this.guardiaActivacion?.exigirActiva('cerrar_corte_inicial');
    return this.frontera.ejecutar(async (conexion) => {
      const corte = await this.repositorioOcurrencias
        .bloquearCorteInicialEnTransaccion(
          { flujoId, generacionId },
          { conexion }
        );
      if (corte.estado === 'cerrado') {
        return Object.freeze({
          ...corte,
          totalFotografia: corte.fronteraInicial,
          estadoEjecucion: 'yaCerrado'
        });
      }

      const capturas = await this.fuenteFotografia.listarCapturasEnTransaccion(
        { flujoId: corte.flujoId, generacionId: corte.generacionId },
        { conexion }
      );
      exigirCapturas(capturas);
      for (const captura of capturas) {
        await this.adaptadorCaptura.capturarEnTransaccion({
          definicion: captura.definicion,
          destinos: [{
            flujoId: corte.flujoId,
            generacionId: corte.generacionId,
            prioridad: captura.prioridad ?? 'reconstruccion',
            clasePosicion: 'fotografiaInicial'
          }]
        }, { conexion });
      }

      const cierre = await this.repositorioOcurrencias
        .cerrarCorteInicialEnTransaccion(
          { flujoId: corte.flujoId, generacionId: corte.generacionId },
          { conexion }
        );
      return Object.freeze({
        ...cierre,
        estadoEjecucion: 'cerrado'
      });
    });
  }
}

function exigirCapturas(capturas) {
  if (!Array.isArray(capturas)) {
    throw new ErrorCorteInicialGeneracionFederacion(
      'fotografia_inicial_invalida',
      'La fuente local debe entregar una lista ordenada de capturas.'
    );
  }
  for (const captura of capturas) {
    if (!captura || typeof captura !== 'object' ||
        !captura.definicion || typeof captura.definicion !== 'object') {
      throw new ErrorCorteInicialGeneracionFederacion(
        'captura_fotografia_invalida',
        'Cada elemento de la fotografía debe declarar una captura federable.'
      );
    }
  }
}
