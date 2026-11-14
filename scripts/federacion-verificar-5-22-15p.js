import assert from 'node:assert/strict';

import {
  FAMILIAS_FEDERACION,
  TIPOS_REGISTRO_AVISOS_FEDERADOS,
  TIPOS_REGISTRO_MONITORES_FEDERACION,
  TIPOS_REGISTRO_TELEMETRIA_FEDERACION,
  TIPOS_REGISTRO_TRIGGERS_INFORMATIVOS_FEDERACION,
  clasificarRegistroFamiliaFederacion,
  evaluarReferenciaNoVisibleFamiliaFederacion,
  listarContratosFamiliasFederacion,
  obtenerContratoFamiliaFederacion,
  obtenerPoliticaRetiradaFamiliaFederacion,
  validarSelectorFamiliaFederacion
} from '../paquetes/federacion/src/index.js';

await main();

async function main() {
  verificarCoberturaFamilias();
  verificarSelectoresYSensibilidad();
  verificarReferenciasYCompletitud();
  verificarRetencionYRetirada();
  console.log(
    '[federacion] OK 5.22.15p: familias=7 selectores=conjunto_completo ' +
    'sensibilidad=explicita referencias=no_visibles_tipadas ' +
    'completitud=causal retencion=clasificada retirada=sin_resurreccion'
  );
}

function verificarCoberturaFamilias() {
  const contratos = listarContratosFamiliasFederacion();
  assert.deepEqual(
    contratos.map((contrato) => contrato.familia).sort(),
    [...FAMILIAS_FEDERACION.valores].sort()
  );
  assert.deepEqual(
    obtenerContratoFamiliaFederacion('telemetria').tiposRegistro,
    [...TIPOS_REGISTRO_TELEMETRIA_FEDERACION].sort()
  );
  assert.deepEqual(
    obtenerContratoFamiliaFederacion('monitores').tiposRegistro,
    [...TIPOS_REGISTRO_MONITORES_FEDERACION].sort()
  );
  assert.deepEqual(
    obtenerContratoFamiliaFederacion('triggersInformativos').tiposRegistro,
    [...TIPOS_REGISTRO_TRIGGERS_INFORMATIVOS_FEDERACION].sort()
  );
  assert.deepEqual(
    obtenerContratoFamiliaFederacion('avisosFederados').tiposRegistro,
    [...TIPOS_REGISTRO_AVISOS_FEDERADOS].sort()
  );
  for (const contrato of contratos) {
    assert.equal(contrato.selector.exigeConjuntoFuncionalCompleto, true);
    assert.deepEqual(
      Object.keys(contrato.retencion.porTipoRegistro).sort(),
      [...contrato.tiposRegistro].sort()
    );
    assert.deepEqual(
      [...contrato.completitud.capacidadesBase,
        ...contrato.completitud.capacidadesNoAplicables].sort(),
      ['interpretable', 'observable', 'reconstruible']
    );
  }
}

function verificarSelectoresYSensibilidad() {
  const monitor = validarSelectorFamiliaFederacion({
    familia: 'monitores',
    campos: ['monitores', 'credencialPropia'],
    permiteContenidoSensible: true,
    permiteRefederacion: false
  });
  assert.deepEqual(monitor.camposSensiblesSeleccionados, ['credencialPropia']);
  assert.throws(
    () => validarSelectorFamiliaFederacion({
      familia: 'monitores', campos: ['credencialPropia'],
      permiteContenidoSensible: true, permiteRefederacion: false
    }),
    (error) => error.codigo === 'conjunto_funcional_no_seleccionado'
  );
  assert.throws(
    () => validarSelectorFamiliaFederacion({
      familia: 'monitores', campos: ['monitores', 'credencialPropia'],
      permiteContenidoSensible: false, permiteRefederacion: false
    }),
    (error) => error.codigo === 'contenido_sensible_sin_autorizacion'
  );
  assert.throws(
    () => validarSelectorFamiliaFederacion({
      familia: 'telemetria', campos: ['telemetria'],
      permiteContenidoSensible: true, permiteRefederacion: false
    }),
    (error) => error.codigo === 'familia_sin_contenido_sensible'
  );
  assert.throws(
    () => validarSelectorFamiliaFederacion({
      familia: 'avisosFederados', campos: ['avisosFederados', 'historico'],
      permiteContenidoSensible: false, permiteRefederacion: false
    }),
    (error) => error.codigo === 'campo_selector_desconocido'
  );
}

function verificarReferenciasYCompletitud() {
  const triggerOpaco = evaluarReferenciaNoVisibleFamiliaFederacion({
    familia: 'monitores', referencia: 'trigger', modo: 'opaca'
  });
  assert.equal(triggerOpaco.conservaIdentidad, true);
  assert.deepEqual(triggerOpaco.capacidadesDegradadas, []);
  const actorOmitido = evaluarReferenciaNoVisibleFamiliaFederacion({
    familia: 'avisosFederados', referencia: 'actor', modo: 'omitida'
  });
  assert.equal(actorOmitido.conservaIdentidad, false);
  const sujetoAuditoria = evaluarReferenciaNoVisibleFamiliaFederacion({
    familia: 'auditoria', referencia: 'sujeto', modo: 'opaca'
  });
  assert.deepEqual(sujetoAuditoria.capacidadesDegradadas, ['interpretable']);
  assert.throws(
    () => evaluarReferenciaNoVisibleFamiliaFederacion({
      familia: 'estructuraOrganizativa', referencia: 'linaje', modo: 'omitida'
    }),
    (error) => error.codigo === 'modo_referencia_no_visible_invalido'
  );
  assert.deepEqual(
    obtenerContratoFamiliaFederacion('monitores')
      .sensibilidad.credencialPropia.capacidadesDegradadas,
    ['reconstruible']
  );
}

function verificarRetencionYRetirada() {
  assert.deepEqual(
    clasificarRegistroFamiliaFederacion({
      familia: 'telemetria', tipoRegistro: 'fotografiaSenal'
    }),
    {
      familia: 'telemetria', tipoRegistro: 'fotografiaSenal',
      claseRetencion: 'estadoOperativoActual', minimoOperativoProtegido: true
    }
  );
  assert.equal(
    clasificarRegistroFamiliaFederacion({
      familia: 'telemetria', tipoRegistro: 'observacion'
    }).minimoOperativoProtegido,
    false
  );
  assert.equal(
    clasificarRegistroFamiliaFederacion({
      familia: 'monitores', tipoRegistro: 'alerta', payload: { estadoAlerta: 'activa' }
    }).claseRetencion,
    'estadoOperativoActual'
  );
  assert.equal(
    clasificarRegistroFamiliaFederacion({
      familia: 'monitores', tipoRegistro: 'alerta', payload: { estadoAlerta: 'cerrada' }
    }).claseRetencion,
    'historico'
  );
  assert.throws(
    () => clasificarRegistroFamiliaFederacion({
      familia: 'monitores', tipoRegistro: 'alerta'
    }),
    (error) => error.codigo === 'discriminante_retencion_ausente'
  );
  assert.equal(obtenerPoliticaRetiradaFamiliaFederacion('auditoria').origen, 'prohibida');
  assert.equal(
    obtenerPoliticaRetiradaFamiliaFederacion('auditoria').conservarHistoricoTrasSalida,
    true
  );
  for (const familia of FAMILIAS_FEDERACION.valores.filter((f) => f !== 'auditoria')) {
    const retirada = obtenerPoliticaRetiradaFamiliaFederacion(familia);
    assert.equal(retirada.origen, 'permitida');
    assert.equal(retirada.sinPayload, true);
    assert.equal(retirada.noResurreccion, true);
  }
}
