export class ErrorHarnessFamiliasFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorHarnessFamiliasFederacion';
    this.codigo = codigo;
  }
}

export async function ejecutarMiniRutaCriticaFamiliaFederacion({
  registro,
  familia,
  versionFamilia,
  escenario
} = {}) {
  if (typeof registro?.obtenerProductivo !== 'function') {
    throw new ErrorHarnessFamiliasFederacion(
      'registro_harness_invalido',
      'El harness necesita un registro de adaptadores de familias.'
    );
  }
  if (!escenario || typeof escenario !== 'object') {
    throw new ErrorHarnessFamiliasFederacion(
      'escenario_harness_invalido',
      'El harness necesita un escenario completo de familia.'
    );
  }
  const adaptador = registro.obtenerProductivo({ familia, versionFamilia });
  const { interfaces } = adaptador;
  const fotografia = await interfaces.fotografiaInicial
    .listarCapturasEnTransaccion(
      escenario.solicitudFotografia,
      escenario.contextoTransaccional
    );
  if (!Array.isArray(fotografia)) {
    throw new ErrorHarnessFamiliasFederacion(
      'fotografia_harness_invalida',
      'La fotografía inicial debe entregar una lista ordenada.'
    );
  }
  const captura = await interfaces.captura.prepararCapturaEnTransaccion(
    escenario.cambio,
    escenario.contextoTransaccional
  );
  const payloadActualizacion = await interfaces.payload.validarPayload(
    exigirPayload(captura, 'captura'),
    { operacion: 'actualizacion', versionFamilia }
  );
  const materializacion = await interfaces.materializacion
    .materializarEnTransaccion({
      operacion: 'actualizacion',
      payload: payloadActualizacion,
      contexto: escenario.contextoMaterializacion
    }, escenario.contextoTransaccional);
  const retirada = await interfaces.retirada.prepararRetiradaEnTransaccion(
    escenario.retirada,
    escenario.contextoTransaccional
  );
  const materializacionRetirada = await interfaces.materializacion
    .materializarEnTransaccion({
      operacion: 'retirada',
      payload: null,
      retirada,
      contexto: escenario.contextoMaterializacion
    }, escenario.contextoTransaccional);
  return congelarProfundo({
    familia: adaptador.familia,
    versionFamilia: adaptador.versionFamilia,
    perfilPayload: adaptador.perfilPayload,
    fotografia,
    captura,
    payloadActualizacion,
    materializacion,
    retirada,
    materializacionRetirada
  });
}

function exigirPayload(resultado, etapa) {
  if (!resultado || typeof resultado !== 'object' || !('payload' in resultado)) {
    throw new ErrorHarnessFamiliasFederacion(
      'payload_harness_ausente',
      `La etapa ${etapa} no entregó un payload tipado.`
    );
  }
  return resultado.payload;
}

function congelarProfundo(valor) {
  if (valor === null || typeof valor !== 'object') return valor;
  for (const descendiente of Object.values(valor)) congelarProfundo(descendiente);
  return Object.freeze(valor);
}
