import {
  FAMILIAS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from '../src/CatalogosFederacion.js';
import {
  crearCampoPresenteFederado,
  crearEnvolventeFederacion,
  crearOcurrenciaOrigenFederada,
  crearVistaAutorizadaFederacion
} from '../src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import {
  crearDeclaracionCapacidadReceptoraFederacion,
  normalizarConfiguracionFederacion
} from '../src/ConfiguracionFederacion.js';

export function crearFixtureConfiguracionFederacion(sobrescritura = {}) {
  return normalizarConfiguracionFederacion({
    activacionFederacion: true,
    origenPublico: 'https://sentinelia-a.example',
    proxiesConfiables: ['10.0.0.10/32', 'nginx-federacion'],
    toleranciaTemporalMs: 5000,
    loteMaximoOcurrencias: 500,
    loteMaximoBytes: 8 * 1024 * 1024,
    ocurrenciaMaximaBytes: 1024 * 1024,
    capacidadReceptoraOcurrencias: 2000,
    ttlEstadoOperativoMs: 900000,
    consolidacionReinicioMs: 60000,
    retencionMaximaDias: 90,
    keyringReferenciaDespliegue: 'sentinelia/federacion/v1',
    ...sobrescritura
  });
}

export function crearFixtureCapacidadReceptoraFederacion(sobrescritura = {}) {
  return crearDeclaracionCapacidadReceptoraFederacion({
    configuracion: crearFixtureConfiguracionFederacion(),
    familiasSoportadas: FAMILIAS_FEDERACION.valores,
    versionesFamilia: VERSIONES_FAMILIA_FEDERACION,
    protocoloVersion: VERSION_PROTOCOLO_FEDERACION,
    ...sobrescritura
  });
}

export function crearFixtureEnvolventeFederacion({
  instalacionesEnRecorrido = 3,
  campoGrande = ''
} = {}) {
  if (!Number.isSafeInteger(instalacionesEnRecorrido) || instalacionesEnRecorrido < 1) {
    throw new TypeError('El recorrido fixture debe tener al menos una instalacion.');
  }
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaDeterminista()
  });
  const instalaciones = Array.from({ length: instalacionesEnRecorrido }, () =>
    generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION));
  const bootEmisor = generador.generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE);
  const ocurrencia = crearOcurrenciaOrigenFederada({
    familia: 'monitores',
    familiaVersion: VERSIONES_FAMILIA_FEDERACION.monitores,
    installationOrigenId: instalaciones[0],
    elementoOrigenId: generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaOrigenId: generador.generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    secuenciaElemento: '1',
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2026-08-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'empresa',
      tenantId: 'tenant-a',
      empresaId: 'empresa-a',
      sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estadoOperativo: crearCampoPresenteFederado({
        valor: {
          estado: 'correcto',
          detalle: campoGrande || 'fixture operativo federado'
        }
      })
    }
  });
  const vista = crearVistaAutorizadaFederacion({
    ocurrenciaOrigen: ocurrencia,
    entregaId: generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    revisionConcesionId: generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION
    ),
    campos: ocurrencia.toJSON().campos,
    evidenciaDisponible: []
  });
  return crearEnvolventeFederacion({
    vistaAutorizada: vista,
    installationEmisoraId: instalaciones.at(-1),
    bootEmisorId: bootEmisor,
    recorridoInstalaciones: instalaciones,
    tiemposSaltosDisponibles: [
      {
        installationId: instalaciones.at(-1),
        bootId: bootEmisor,
        recibidoUtc: '2026-08-01T00:00:01.000Z',
        emitidoUtc: '2026-08-01T00:00:02.000Z'
      }
    ]
  });
}

class FuenteEntropiaDeterminista {
  entropiaBitsPorIdentidad = 128;
  #contador = 1;

  generarBytes({ cantidadBytes }) {
    const bytes = new Uint8Array(cantidadBytes);
    let contador = BigInt(this.#contador);
    this.#contador += 1;
    for (
      let indice = cantidadBytes - 1;
      indice >= 0 && contador > 0n;
      indice -= 1
    ) {
      bytes[indice] = Number(contador & 255n);
      contador >>= 8n;
    }
    return bytes;
  }
}
