import {
  TIPOS_IDENTIDAD_FEDERADA,
  exigirIdentidadFederada
} from '../src/index.js';

export class BootstrapIdentidadInstalacionFederacion {
  constructor({ fronteraTransaccional, repositorioIdentidad, generadorIdentidades } = {}) {
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    exigirMetodo(
      repositorioIdentidad,
      'obtenerIdentidadInstalacion',
      'repositorioIdentidad'
    );
    exigirMetodo(
      repositorioIdentidad,
      'registrarArranqueEnTransaccion',
      'repositorioIdentidad'
    );
    exigirMetodo(generadorIdentidades, 'generar', 'generadorIdentidades');
    this.fronteraTransaccional = fronteraTransaccional;
    this.repositorioIdentidad = repositorioIdentidad;
    this.generadorIdentidades = generadorIdentidades;
    Object.freeze(this);
  }

  async asegurar({ bootId } = {}) {
    const arranque = exigirIdentidadFederada(bootId, {
      tipo: TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
      campo: 'bootId'
    });
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const existente = await this.repositorioIdentidad
        .obtenerIdentidadInstalacion({ conexion, bloquear: true });
      const installationId = existente?.installationId ??
        this.generadorIdentidades.generar(
          TIPOS_IDENTIDAD_FEDERADA.INSTALACION
        );
      const registro = await this.repositorioIdentidad
        .registrarArranqueEnTransaccion({
          installationId,
          bootId: arranque,
          conexion
        });
      return Object.freeze({
        installationId: registro.installationId,
        bootId: registro.bootId,
        identidadCreada: existente === null,
        iniciadoEnUtc: registro.iniciadoEnUtc,
        registradoEnUtc: registro.registradoEnUtc
      });
    });
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
