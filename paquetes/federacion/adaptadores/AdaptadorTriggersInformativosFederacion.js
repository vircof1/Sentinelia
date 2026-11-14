import { PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION, VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION, validarPayloadTriggersInformativosFederacion } from '../src/PayloadTriggersInformativosFederacion.js';
import { OPERACIONES_CAPTURA_FEDERACION } from '../src/OperacionesCapturaTecnicaFederacion.js';

export class AdaptadorTriggersInformativosFederacion {
  constructor({repositorioLocal=null,repositorioRemoto=null}={}){
    if(repositorioLocal!==null&&['prepararCapturaEnTransaccion','prepararCapturasAdministracionEnTransaccion','prepararCapturasEjecucionesEnTransaccion','listarCapturasEnTransaccion','prepararRetiradaEnTransaccion'].some(m=>typeof repositorioLocal?.[m]!=='function'))throw new Error('El productor local de triggers informativos está incompleto.');
    if(repositorioRemoto!==null&&['materializarEnTransaccion','listarDefiniciones','listarAsignaciones','listarEjecucionesTerminadas','crearBorradorPlantillaLocal'].some(m=>typeof repositorioRemoto?.[m]!=='function'))throw new Error('El repositorio remoto de triggers informativos está incompleto.');
    this.repositorioLocal=repositorioLocal;this.repositorioRemoto=repositorioRemoto;
  }
  validarPayload(p,c){return validarPayloadTriggersInformativosFederacion(p,c);}
  prepararCapturaEnTransaccion(solicitud,opciones){
    if(solicitud?.operacionCapturaTecnica===OPERACIONES_CAPTURA_FEDERACION.TRIGGERS_EJECUCION){
      return local(this.repositorioLocal).prepararCapturasEjecucionesEnTransaccion(solicitud.solicitud,opciones);
    }
    if(solicitud?.operacionCapturaTecnica===OPERACIONES_CAPTURA_FEDERACION.TRIGGERS_ADMINISTRACION){
      return local(this.repositorioLocal).prepararCapturasAdministracionEnTransaccion(solicitud.solicitud,opciones);
    }
    if(solicitud?.operacionCapturaTecnica===OPERACIONES_CAPTURA_FEDERACION.TRIGGERS_RETIRADA){
      return local(this.repositorioLocal).prepararRetiradaEnTransaccion(solicitud.solicitud,opciones);
    }
    return local(this.repositorioLocal).prepararCapturaEnTransaccion(solicitud,opciones);
  }
  prepararCapturasAdministracionEnTransaccion(...a){return local(this.repositorioLocal).prepararCapturasAdministracionEnTransaccion(...a);}
  prepararCapturasEjecucionesEnTransaccion(...a){return local(this.repositorioLocal).prepararCapturasEjecucionesEnTransaccion(...a);}
  listarCapturasEnTransaccion(...a){return local(this.repositorioLocal).listarCapturasEnTransaccion(...a);}
  prepararRetiradaEnTransaccion(...a){return local(this.repositorioLocal).prepararRetiradaEnTransaccion(...a);}
  materializarEnTransaccion(...a){return remoto(this.repositorioRemoto).materializarEnTransaccion(...a);}
  listarDefiniciones(...a){return remoto(this.repositorioRemoto).listarDefiniciones(...a);}
  listarAsignaciones(...a){return remoto(this.repositorioRemoto).listarAsignaciones(...a);}
  listarEjecucionesTerminadas(...a){return remoto(this.repositorioRemoto).listarEjecucionesTerminadas(...a);}
  crearBorradorPlantillaLocal(...a){return remoto(this.repositorioRemoto).crearBorradorPlantillaLocal(...a);}
}
export function crearDefinicionAdaptadorTriggersInformativosFederacion({repositorioLocal=null,repositorioRemoto=null}={}){const adaptador=new AdaptadorTriggersInformativosFederacion({repositorioLocal,repositorioRemoto}),interfaces={payload:adaptador};if(repositorioLocal){interfaces.captura=adaptador;interfaces.fotografiaInicial=adaptador;interfaces.retirada=adaptador;}if(repositorioRemoto)interfaces.materializacion=adaptador;return Object.freeze({familia:'triggersInformativos',versionFamilia:VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,perfilPayload:PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,productivo:Boolean(repositorioLocal&&repositorioRemoto),interfaces:Object.freeze(interfaces)});}
function local(r){if(!r)throw new Error('No hay productor local de triggers informativos.');return r;}
function remoto(r){if(!r)throw new Error('No hay repositorio remoto de triggers informativos.');return r;}
