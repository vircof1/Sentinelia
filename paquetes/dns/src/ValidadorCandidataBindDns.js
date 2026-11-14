import path from 'node:path';
import { validarRutaRelativaBind } from './ProyeccionBindDeterministaDns.js';

export class ValidadorCandidataBindDns {
  constructor({ comandos } = {}) {
    if (!comandos?.validarConfiguracionCandidata || !comandos?.validarZona) {
      throw new Error('La validación candidata BIND requiere sus adaptadores de proceso.');
    }
    this.comandos = comandos;
  }

  async validar({
    directorioStaging,
    generacionDns = null,
    proyeccion,
    validarConfiguracion = true
  } = {}) {
    const artefactos = new Map(proyeccion.listarArtefactos().map((item) => [item.ruta, item.contenido]));
    const zonesConf = artefactos.get('zonas/sentinelia-zones.conf');
    if (!Buffer.isBuffer(zonesConf)) throw new Error('La candidata BIND no contiene sentinelia-zones.conf.');
    const zonas = extraerZonasGeneradas(zonesConf.toString('utf8'), {
      directorioStaging,
      generacionDns
    });
    const rutasEsperadas = new Set([
      'sentinelia-named.conf',
      'zonas/sentinelia-zones.conf',
      ...zonas.map(({ ruta }) => ruta)
    ]);
    if (rutasEsperadas.size !== artefactos.size ||
        [...artefactos.keys()].some((ruta) => !rutasEsperadas.has(ruta))) {
      throw new Error('La candidata BIND contiene artefactos no declarados por su perfil v1.');
    }
    for (const zona of zonas) {
      const rutaRelativa = validarRutaRelativaBind(zona.ruta);
      if (!artefactos.has(rutaRelativa)) throw new Error(`Falta el zonefile manifestado para ${zona.nombre}.`);
      const rutaAbsoluta = path.join(directorioStaging, rutaRelativa);
      try {
        await this.comandos.validarZona(zona.nombre, rutaAbsoluta);
      } catch (causa) {
        throw new RechazoZonaCandidataBindDns({
          nombreZona: zona.nombre,
          rutaZona: rutaRelativa,
          rutaAbsoluta,
          causa
        });
      }
    }
    if (validarConfiguracion) {
      await this.comandos.validarConfiguracionCandidata(
        path.join(directorioStaging, 'sentinelia-named.conf')
      );
    }
    return Object.freeze({
      zonasValidadas: zonas.length,
      configuracionValidada: Boolean(validarConfiguracion)
    });
  }
}

export class RechazoZonaCandidataBindDns extends Error {
  constructor({ nombreZona, rutaZona, rutaAbsoluta, causa } = {}) {
    super(causa?.message || 'La zona candidata fue rechazada por named-checkzone.', {
      cause: causa
    });
    this.name = 'RechazoZonaCandidataBindDns';
    this.codigo = causa?.codigo || 'bind_zona_rechazada';
    this.nombreZona = String(nombreZona || '');
    this.rutaZona = validarRutaRelativaBind(rutaZona);
    this.lineas = Object.freeze(extraerLineasDiagnostico(causa, rutaAbsoluta));
    this.resultadoIncierto = Boolean(causa?.incierto);
  }
}

export function extraerZonasGeneradas(
  texto,
  { directorioStaging = null, generacionDns = null } = {}
) {
  const contenido = String(texto);
  const patron = /zone\s+"([a-z0-9.-]+)"\s+IN\s*\{\s*type\s+(master|slave);\s*file\s+"([^"\r\n]+)";\s*\};/g;
  const zonas = [];
  let coincidencia;
  while ((coincidencia = patron.exec(contenido)) !== null) {
    zonas.push(Object.freeze({
      nombre: coincidencia[1],
      tipo: coincidencia[2],
      ruta: normalizarRutaZonefile(
        coincidencia[3], directorioStaging, generacionDns
      )
    }));
  }
  const declaraciones = contenido.match(/\bzone\s+"/g)?.length || 0;
  if (declaraciones !== zonas.length) throw new Error('sentinelia-zones.conf no usa el perfil generado esperado.');
  return Object.freeze(zonas);
}

function normalizarRutaZonefile(rutaManifestada, directorioStaging, generacionDns) {
  if (!path.isAbsolute(rutaManifestada)) {
    return validarRutaRelativaBind(rutaManifestada);
  }
  if (!directorioStaging) {
    throw new Error('Un zonefile absoluto exige el directorio staging esperado.');
  }
  const absoluta = path.resolve(rutaManifestada);
  const raices = [path.resolve(directorioStaging)];
  if (/^[1-9][0-9]*$/u.test(String(generacionDns ?? ''))) {
    raices.push(path.join(
      path.dirname(path.resolve(directorioStaging)),
      `generacion-${generacionDns}`
    ));
  }
  for (const raiz of new Set(raices)) {
    const relativa = path.relative(raiz, absoluta);
    try {
      const validada = validarRutaRelativaBind(relativa);
      if (path.resolve(raiz, validada) === absoluta) return validada;
    } catch {
      // Puede ser relativa a la otra raíz autorizada de la misma generación.
    }
  }
  throw new Error('El zonefile manifestado escapa de la generación BIND esperada.');
}

function extraerLineasDiagnostico(causa, rutaAbsoluta) {
  const salida = `${causa?.stderr || ''}\n${causa?.stdout || ''}`;
  const ruta = escaparExpresionRegular(String(rutaAbsoluta || ''));
  if (!ruta) return [];
  const patron = new RegExp(`(?:^|\\n)${ruta}:(\\d+)(?::|\\s)`, 'gu');
  const lineas = new Set();
  let coincidencia;
  while ((coincidencia = patron.exec(salida)) !== null) {
    const linea = Number(coincidencia[1]);
    if (Number.isSafeInteger(linea) && linea > 0) lineas.add(linea);
  }
  return [...lineas].sort((a, b) => a - b);
}

function escaparExpresionRegular(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
