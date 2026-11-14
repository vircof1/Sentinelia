import {
  asegurarTipoDatoDirectamenteMonitorizable,
  crearFuenteFederadaMonitorTelemetria
} from '../../monitores/src/MonitorTelemetriaAgente.js';

export class ServicioFuenteTelemetriaFederada {
  constructor({
    repositorioTelemetriaRemota,
    repositorioVinculosMonitoresTelemetria,
    autorizarLecturaProyeccion,
    autorizarAdministracionMonitorLocal,
    ahora = () => new Date()
  } = {}) {
    if (typeof repositorioTelemetriaRemota?.listarEstadosSenalSeleccionables !== 'function' ||
        typeof repositorioVinculosMonitoresTelemetria?.vincularSenalFederada !== 'function' ||
        typeof autorizarLecturaProyeccion !== 'function' ||
        typeof autorizarAdministracionMonitorLocal !== 'function') {
      throw new Error(
        'La fuente federada exige lectura, vínculo y autorización de ambos extremos.'
      );
    }
    this.repositorioTelemetriaRemota = repositorioTelemetriaRemota;
    this.repositorioVinculosMonitoresTelemetria =
      repositorioVinculosMonitoresTelemetria;
    this.autorizarLecturaProyeccion = autorizarLecturaProyeccion;
    this.autorizarAdministracionMonitorLocal =
      autorizarAdministracionMonitorLocal;
    this.ahora = ahora;
  }

  async describirFuenteSeleccionable({
    contextoUsuarioActual,
    proyeccionId
  } = {}) {
    const fuente = crearFuenteFederadaMonitorTelemetria({ proyeccionId });
    if (await this.autorizarLecturaProyeccion({
      contextoUsuarioActual,
      proyeccionId: fuente.proyeccionId,
      familia: 'telemetria'
    }) !== true) {
      throw new Error('El usuario actual no puede consultar la telemetría remota.');
    }
    const [registro] = await this.repositorioTelemetriaRemota
      .listarEstadosSenalSeleccionables({
        proyeccionId: fuente.proyeccionId
      });
    if (!registro || registro.completitud?.observable !== 'completa' ||
        registro.estadoProyeccion?.vigencia !== 'vigente' ||
        registro.estadoProyeccion?.soporte !== 'sostenida' ||
        registro.estadoProyeccion?.autorizacion !== 'autorizada' ||
        registro.estadoProyeccion?.compatibilidad !== 'compatible' ||
        registro.fotografiaOperativa?.utilizableAhora !== true) {
      throw new Error(
        'La señal remota no está vigente, autorizada, compatible, sostenida y observable.'
      );
    }
    const observacion = registro.payload?.observacion;
    if (!observacion) {
      throw new Error('La fotografía remota no contiene una observación seleccionable.');
    }
    if (observacion.vigenteHastaUtc &&
        new Date(observacion.vigenteHastaUtc) <= this.ahora()) {
      throw new Error('La fotografía remota ha agotado su vigencia declarada.');
    }
    if (registro.fotografiaOperativa.vigenteHastaEfectivaUtc &&
        new Date(registro.fotografiaOperativa.vigenteHastaEfectivaUtc) <= this.ahora()) {
      throw new Error('La fotografía remota ha agotado su vigencia efectiva.');
    }
    asegurarTipoDatoDirectamenteMonitorizable(observacion.tipoDato);
    return Object.freeze({
      fuente,
      senal: Object.freeze({
        fuenteOrigenId: observacion.fuenteOrigenId,
        senalOrigenId: observacion.senalOrigenId,
        tipoDato: observacion.tipoDato,
        unidad: observacion.unidad || null,
        codigoSenal: observacion.codigoSenal || null
      }),
      procedenciaFederada: Object.freeze({
        installationOrigenId: registro.installationOrigenId,
        elementoOrigenId: registro.elementoOrigenId,
        proyeccionId: registro.proyeccionId,
        generacionId: registro.generacionId,
        secuenciaElemento: registro.secuenciaElemento
      })
    });
  }

  async vincularAMonitorLocal({
    contextoUsuarioActual,
    monitorId,
    proyeccionId
  } = {}, { conexion = null } = {}) {
    if (await this.autorizarAdministracionMonitorLocal({
      contextoUsuarioActual,
      monitorId
    }) !== true) {
      throw new Error('El usuario actual no puede administrar el monitor local.');
    }
    const seleccion = await this.describirFuenteSeleccionable({
      contextoUsuarioActual,
      proyeccionId
    });
    const vinculo = await this.repositorioVinculosMonitoresTelemetria
      .vincularSenalFederada({
        monitorId,
        proyeccionId: seleccion.fuente.proyeccionId
      }, { conexion });
    return Object.freeze({ vinculo, seleccion });
  }
}
