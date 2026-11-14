import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada,
  exigirIdentidadFederada
} from '../src/index.js';

export class CoordinadorArranqueLogicoFederacion {
  constructor({
    fronteraTransaccional,
    repositorioIdentidad,
    generadorIdentidades,
    publicadorArranque
  } = {}) {
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    exigirMetodo(repositorioIdentidad, 'obtenerIdentidadInstalacion', 'repositorioIdentidad');
    exigirMetodo(repositorioIdentidad, 'asegurarIdentidadEnTransaccion', 'repositorioIdentidad');
    exigirMetodo(repositorioIdentidad, 'registrarArranqueEnTransaccion', 'repositorioIdentidad');
    exigirMetodo(generadorIdentidades, 'generar', 'generadorIdentidades');
    exigirMetodo(publicadorArranque, 'asegurar', 'publicadorArranque');
    exigirMetodo(publicadorArranque, 'reemplazar', 'publicadorArranque');
    this.fronteraTransaccional = fronteraTransaccional;
    this.repositorioIdentidad = repositorioIdentidad;
    this.generadorIdentidades = generadorIdentidades;
    this.publicadorArranque = publicadorArranque;
    Object.freeze(this);
  }

  async asegurarActual({ bootIdConocido = null } = {}) {
    const conocido = bootIdConocido === null
      ? null
      : exigirIdentidadFederada(bootIdConocido, {
          tipo: TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
          campo: 'bootIdConocido'
        });
    const installationId = await this.#asegurarIdentidad();
    const candidato = this.generadorIdentidades.generar(
      TIPOS_IDENTIDAD_FEDERADA.ARRANQUE
    );
    const presencia = await this.publicadorArranque.asegurar({
      installationId,
      bootIdCandidato: candidato,
      bootIdConocido: conocido
    });
    return this.#persistirPresencia({ installationId, presencia });
  }

  async iniciarNuevoArranque({ bootIdActualEsperado } = {}) {
    const esperado = exigirIdentidadFederada(bootIdActualEsperado, {
      tipo: TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
      campo: 'bootIdActualEsperado'
    });
    const installationId = await this.#asegurarIdentidad();
    const nuevo = this.generadorIdentidades.generar(
      TIPOS_IDENTIDAD_FEDERADA.ARRANQUE
    );
    const presencia = await this.publicadorArranque.reemplazar({
      installationId,
      bootIdActual: esperado,
      bootIdNuevo: nuevo
    });
    return this.#persistirPresencia({ installationId, presencia });
  }

  async #asegurarIdentidad() {
    const conocida = await this.repositorioIdentidad.obtenerIdentidadInstalacion();
    const candidata = conocida?.installationId ?? this.generadorIdentidades.generar(
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    );
    const identidad = await this.fronteraTransaccional.ejecutar((conexion) =>
      this.repositorioIdentidad.asegurarIdentidadEnTransaccion({
        installationId: candidata,
        conexion
      })
    );
    return identidad.installationId;
  }

  async #persistirPresencia({ installationId, presencia }) {
    const bootId = crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
      valor: presencia.bootId
    });
    const registro = await this.fronteraTransaccional.ejecutar((conexion) =>
      this.repositorioIdentidad.registrarArranqueEnTransaccion({
        installationId,
        bootId,
        conexion
      })
    );
    return Object.freeze({
      installationId: registro.installationId,
      bootId: registro.bootId,
      origen: presencia.codigo,
      ttlSegundos: Number(presencia.ttlSegundos || 0) || null,
      iniciadoEnUtc: registro.iniciadoEnUtc,
      registradoEnUtc: registro.registradoEnUtc
    });
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
