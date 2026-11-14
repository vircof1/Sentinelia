import { PERFIL_CANONICO_FEDERACION } from './CanonicalizadorFederacion.js';
import { PERFIL_CATALOGOS_FEDERACION } from './CatalogosFederacion.js';
import { PERFIL_CONFIGURACION_FEDERACION } from './ConfiguracionFederacion.js';
import {
  PERFIL_ENVOLVENTE_FEDERACION,
  PERFIL_OCURRENCIA_ORIGEN_FEDERACION,
  PERFIL_VISTA_AUTORIZADA_FEDERACION
} from './EnvolventeFederacion.js';
import { PERFIL_PUERTOS_FEDERACION } from './PuertosFederacion.js';

export const VERSION_FUNDAMENTOS_FEDERACION = 1;
export const PERFIL_FUNDAMENTOS_FEDERACION =
  'sentinelia-federacion-fundamentos-v1';

export const MANIFIESTO_FUNDAMENTOS_FEDERACION = congelarProfundo({
  perfil: PERFIL_FUNDAMENTOS_FEDERACION,
  version: VERSION_FUNDAMENTOS_FEDERACION,
  unidades: [
    '5.22.9a',
    '5.22.9b',
    '5.22.9c',
    '5.22.9d',
    '5.22.9e',
    '5.22.9f',
    '5.22.9g'
  ],
  perfiles: [
    PERFIL_CATALOGOS_FEDERACION,
    PERFIL_CANONICO_FEDERACION,
    PERFIL_OCURRENCIA_ORIGEN_FEDERACION,
    PERFIL_VISTA_AUTORIZADA_FEDERACION,
    PERFIL_ENVOLVENTE_FEDERACION,
    PERFIL_PUERTOS_FEDERACION,
    PERFIL_CONFIGURACION_FEDERACION
  ],
  garantias: [
    'nucleo_puro',
    'identidades_opacas',
    'catalogos_cerrados',
    'envolvente_canonica',
    'autoridad_actual',
    'puertos_sin_adaptadores',
    'configuracion_contractual',
    'fixtures_minimos'
  ],
  prohibiciones: [
    'sin_efectos_dominio_reales',
    'sin_transporte_concreto',
    'sin_persistencia_concreta',
    'sin_outbox_auditoria_como_transporte'
  ]
});

function congelarProfundo(valor) {
  if (valor === null || typeof valor !== 'object') return valor;
  for (const descendiente of Object.values(valor)) {
    congelarProfundo(descendiente);
  }
  return Object.freeze(valor);
}
