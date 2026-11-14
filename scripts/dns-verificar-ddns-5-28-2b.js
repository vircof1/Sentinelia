import assert from 'node:assert/strict';

import { RegistroDns } from '../paquetes/dns/src/RegistroDns.js';
import { ZonaDns } from '../paquetes/dns/src/ZonaDns.js';
import {
  CAUSAS_INELEGIBILIDAD_DDNS_AGENTES,
  evaluarElegibilidadConcesionDdnsAgentes
} from '../paquetes/dns/src/PoliticaElegibilidadDdnsAgentes.js';
import { EjecutorTriggerDns } from '../paquetes/triggers/src/EjecutorTriggerDns.js';

verificarElegibilidadBase();
verificarExclusiones();
verificarInactividad();
verificarLegadoNoAutoritativo();
verificarTriggerConservaSuFrontera();

console.log(
  '[dns-ddns] OK 5.28.2b: categoria=ddns tipos=beta zona=master-publicable ' +
  'registro=publicable exclusividad=trigger-concesion inactivo=elegible-no_operable ' +
  'legado=no_autoritativo reasignacion=no_implicita trigger=frontera_conservada'
);

function verificarElegibilidadBase() {
  const resultado = evaluar();
  assert.deepEqual(resultado, {
    elegible: true,
    operable: true,
    causas: [],
    tipo: 'A',
    estadoRegistro: 'activo',
    legadoDdnsAutoritativo: false
  });
  assert.equal(Object.isFrozen(resultado), true);
  assert.equal(Object.isFrozen(resultado.causas), true);
}

function verificarExclusiones() {
  assertCausa({ registro: { categoria_origen: 'normal' } }, 'CATEGORIA_AJENA');
  assertCausa({ registro: { tipo_registro: 'PTR' } }, 'TIPO_NO_ADMITIDO');
  assertCausa({ zona: { tipo_zona: 'slave' } }, 'ZONA_NO_MASTER');
  assertCausa({ zona: { publicar_en_bind: 0 } }, 'ZONA_NO_PUBLICABLE');
  assertCausa({ zona: { activo: 0 } }, 'ZONA_NO_PUBLICABLE');
  assertCausa({ registro: { publicar_en_bind: 0 } }, 'REGISTRO_NO_PUBLICABLE');
  assertCausa({
    registro: { datos_auxiliares: JSON.stringify({ gobernadoPor: 'trigger' }) }
  }, 'AUTORIDAD_TRIGGER');
  assertCausa({ existeConcesionVigente: true }, 'CONCESION_VIGENTE');

  const ajena = evaluar({ existeConcesionVigente: true });
  assert.equal(ajena.elegible, false,
    'Una concesión previa nunca se reasigna aunque el llamante sea el mismo agente.');
}

function verificarInactividad() {
  const resultado = evaluar({ registro: { activo: 0 } });
  assert.equal(resultado.elegible, true);
  assert.equal(resultado.operable, false);
  assert.equal(resultado.estadoRegistro, 'inactivo');
  assert.deepEqual(resultado.causas, []);
}

function verificarLegadoNoAutoritativo() {
  const resultado = evaluar({
    registro: {
      datos_auxiliares: JSON.stringify({
        gobernadoPor: 'ddns',
        modoControl: 'valor_y_activo',
        criterioActualizacion: 'direccion_agente',
        politicaSobrescritura: 'siempre'
      })
    }
  });
  assert.equal(resultado.elegible, true);
  assert.equal(resultado.legadoDdnsAutoritativo, false);
  assert.equal('modo' in resultado, false);
}

function verificarTriggerConservaSuFrontera() {
  const ejecutor = new EjecutorTriggerDns({});
  const trigger = { id: 8, tenantId: null, empresaId: null, sitioId: null };
  const registroTrigger = registro({
    categoria_origen: 'trigger',
    datos_auxiliares: JSON.stringify({
      gobernadoPor: 'trigger', modoControl: 'valor_y_activo'
    })
  });
  assert.doesNotThrow(() => ejecutor.validarAutorizacionTrigger({
    trigger,
    registro: registroTrigger,
    configuracion: { rolGobernanza: null }
  }));
  const registroDdns = registro();
  assert.throws(() => ejecutor.validarAutorizacionTrigger({
    trigger,
    registro: registroDdns,
    configuracion: { rolGobernanza: null }
  }), /no está gobernado por triggers/u);
}

function assertCausa(cambios, nombre) {
  const resultado = evaluar(cambios);
  assert.equal(resultado.elegible, false);
  assert.equal(
    resultado.causas.includes(CAUSAS_INELEGIBILIDAD_DDNS_AGENTES[nombre]),
    true
  );
}

function evaluar({ registro: cambiosRegistro = {}, zona: cambiosZona = {},
  existeConcesionVigente = false } = {}) {
  return evaluarElegibilidadConcesionDdnsAgentes({
    registro: registro(cambiosRegistro),
    zona: zona(cambiosZona),
    existeConcesionVigente
  });
}

function registro(cambios = {}) {
  return new RegistroDns({
    id: 3,
    zona_id: 2,
    host_relativo: 'host',
    tipo_registro: 'A',
    valor_principal: '192.0.2.1',
    categoria_origen: 'ddns',
    publicar_en_bind: 1,
    datos_auxiliares: JSON.stringify({
      gobernadoPor: 'ddns',
      modoControl: 'valor_y_activo',
      criterioActualizacion: 'direccion_agente',
      politicaSobrescritura: 'solo_si_cambia'
    }),
    activo: 1,
    ...cambios
  });
}

function zona(cambios = {}) {
  return new ZonaDns({
    id: 2,
    nombre_zona: 'example.test',
    tipo_zona: 'master',
    publicar_en_bind: 1,
    activo: 1,
    ...cambios
  });
}
