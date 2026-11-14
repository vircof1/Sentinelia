import { PERFIL_PAYLOAD_AVISOS_FEDERADOS, VERSION_PAYLOAD_AVISOS_FEDERADOS, validarPayloadAvisosFederados } from '../src/PayloadAvisosFederados.js';

export class AdaptadorAvisosFederados {
  constructor({ repositorioLocal = null, repositorioRemoto = null } = {}) {
    if (repositorioLocal !== null && ['prepararCapturaEnTransaccion','prepararCapturasMutacionEnTransaccion','listarCapturasEnTransaccion','prepararRetiradaEnTransaccion'].some((m) => typeof repositorioLocal?.[m] !== 'function')) throw new Error('El productor local de avisos federados está incompleto.');
    if (repositorioRemoto !== null && ['materializarEnTransaccion','listarEstados','listarTransiciones'].some((m) => typeof repositorioRemoto?.[m] !== 'function')) throw new Error('El receptor remoto de avisos federados está incompleto.');
    this.repositorioLocal = repositorioLocal; this.repositorioRemoto = repositorioRemoto;
  }
  validarPayload(p,c){return validarPayloadAvisosFederados(p,c);}
  prepararCapturaEnTransaccion(...a){return local(this.repositorioLocal).prepararCapturaEnTransaccion(...a);}
  prepararCapturasMutacionEnTransaccion(...a){return local(this.repositorioLocal).prepararCapturasMutacionEnTransaccion(...a);}
  listarCapturasEnTransaccion(...a){return local(this.repositorioLocal).listarCapturasEnTransaccion(...a);}
  prepararRetiradaEnTransaccion(...a){return local(this.repositorioLocal).prepararRetiradaEnTransaccion(...a);}
  materializarEnTransaccion(...a){return remoto(this.repositorioRemoto).materializarEnTransaccion(...a);}
  listarEstados(...a){return remoto(this.repositorioRemoto).listarEstados(...a);}
  listarTransiciones(...a){return remoto(this.repositorioRemoto).listarTransiciones(...a);}
}

export function crearDefinicionAdaptadorAvisosFederados({ repositorioLocal = null, repositorioRemoto = null } = {}) {
  const adaptador = new AdaptadorAvisosFederados({ repositorioLocal, repositorioRemoto });
  const interfaces = { payload: adaptador };
  if (repositorioLocal) { interfaces.captura = adaptador; interfaces.fotografiaInicial = adaptador; interfaces.retirada = adaptador; }
  if (repositorioRemoto) interfaces.materializacion = adaptador;
  return Object.freeze({ familia:'avisosFederados',versionFamilia:VERSION_PAYLOAD_AVISOS_FEDERADOS,perfilPayload:PERFIL_PAYLOAD_AVISOS_FEDERADOS,productivo:Boolean(repositorioLocal&&repositorioRemoto),interfaces:Object.freeze(interfaces) });
}
function local(r){if(!r)throw new Error('No hay productor local de avisos federados.');return r;}
function remoto(r){if(!r)throw new Error('No hay receptor remoto de avisos federados.');return r;}
