import path from 'node:path';

export const PERFIL_SELECTOR_BIND_V1 = 'sentinelia-bind-selector-v1';
export const NOMBRE_NAMED_CONF_GENERACION = 'sentinelia-named.conf';

export class SelectorActivoBindDns {
  constructor({ raizArtefactos }) {
    this.raizArtefactos = validarRutaPosixAbsolutaBind(raizArtefactos, 'raizArtefactos');
  }

  construir({ generacionDns, hashProyeccion }) {
    const generacion = decimalCanonico(generacionDns, 'generacionDns');
    const hash = hashCanonico(hashProyeccion);
    const rutaNamedConf = this.rutaNamedConf(generacion);
    return Buffer.from(
      `# ${PERFIL_SELECTOR_BIND_V1}\n` +
      `# generacion=${generacion}\n` +
      `# hashProyeccion=${hash}\n` +
      `include "${rutaNamedConf}";\n`,
      'ascii'
    );
  }

  interpretar(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.includes(0x0d) || !bytes.equals(Buffer.from(bytes.toString('ascii'), 'ascii'))) {
      throw new Error('El selector BIND debe ser ASCII estricto con saltos LF.');
    }
    const texto = bytes.toString('ascii');
    const lineas = texto.split('\n');
    if (lineas.length !== 5 || lineas[4] !== '' || lineas[0] !== `# ${PERFIL_SELECTOR_BIND_V1}`) {
      throw new Error('El selector BIND v1 debe contener exactamente cuatro líneas y LF final.');
    }
    const generacion = extraerExacto(lineas[1], '# generacion=', decimalCanonico);
    const hashProyeccion = extraerExacto(lineas[2], '# hashProyeccion=', hashCanonico);
    const rutaEsperada = this.rutaNamedConf(generacion);
    if (lineas[3] !== `include "${rutaEsperada}";`) {
      throw new Error('La ruta del selector BIND no es la derivada para su generación.');
    }
    const reconstruido = this.construir({ generacionDns: generacion, hashProyeccion });
    if (!reconstruido.equals(bytes)) throw new Error('El selector BIND no es canónico.');
    return Object.freeze({ generacionDns: generacion, hashProyeccion, rutaNamedConf: rutaEsperada });
  }

  rutaDirectorio(generacionDns) {
    return path.posix.join(this.raizArtefactos, `generacion-${decimalCanonico(generacionDns)}`);
  }

  rutaNamedConf(generacionDns) {
    return path.posix.join(this.rutaDirectorio(generacionDns), NOMBRE_NAMED_CONF_GENERACION);
  }
}

export function validarRutaPosixAbsolutaBind(valor, nombre = 'ruta') {
  if (typeof valor !== 'string' || valor === '/' || !valor.startsWith('/') ||
      valor.endsWith('/') || valor.includes('//') || valor.includes('\\') || valor.includes('\0') ||
      path.posix.normalize(valor) !== valor) {
    throw new Error(`${nombre} debe ser una ruta POSIX absoluta canónica no raíz.`);
  }
  const componentes = valor.slice(1).split('/');
  if (componentes.some((componente) => componente === '.' || componente === '..' ||
      componente.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(componente))) {
    throw new Error(`${nombre} contiene componentes no permitidos.`);
  }
  return valor;
}

function extraerExacto(linea, prefijo, validar) {
  if (!linea.startsWith(prefijo)) throw new Error('El selector BIND no respeta el orden cerrado de campos.');
  return validar(linea.slice(prefijo.length));
}

function decimalCanonico(valor, nombre = 'generacionDns') {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto) || BigInt(texto) > 18_446_744_073_709_551_615n) {
    throw new Error(`${nombre} debe ser BIGINT UNSIGNED decimal canónico positivo.`);
  }
  return texto;
}

function hashCanonico(valor) {
  const texto = Buffer.isBuffer(valor) ? valor.toString('hex') : String(valor ?? '');
  if (!/^[0-9a-f]{64}$/.test(texto)) throw new Error('hashProyeccion debe ser SHA-256 hexadecimal canónico.');
  return texto;
}
