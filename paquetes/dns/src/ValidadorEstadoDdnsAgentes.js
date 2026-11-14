import { isIP } from 'node:net';

const TIPOS = new Set(['A', 'AAAA', 'CNAME', 'MX']);
const MODOS = new Set(['observada', 'declarada']);
const PATRON_ETIQUETA = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class ErrorValorDdnsNoInterpretable extends Error {
  constructor(mensaje, campo) {
    super(mensaje);
    this.name = 'ErrorValorDdnsNoInterpretable';
    this.codigo = 'valor_no_interpretable';
    this.campo = campo;
  }
}

export function canonicalizarEstadoDeseadoDdnsAgentes(
  { tipo, modo, valor },
  { admitirContenidoObservado = false } = {}
) {
  exigir(TIPOS.has(tipo), 'El tipo DDNS no pertenece al contrato.', 'tipo');
  exigir(MODOS.has(modo), 'El modo DDNS no pertenece al contrato.', 'modo');
  if (modo === 'observada') {
    exigir(['A', 'AAAA'].includes(tipo),
      'El modo observado solo admite registros A o AAAA.', 'tipo');
    if (valor === null) return congelar({ tipo, modo, valor: null });
    exigir(admitirContenidoObservado,
      'El modo observado no admite un valor declarado por el agente.', 'valor');
    exigirObjetoPlano(valor, 'valor');
    if (tipo === 'A') {
      exigirClaves(valor, ['direccionIpv4'], 'valor');
      return congelar({
        tipo,
        modo,
        valor: { direccionIpv4: canonicalizarIpv4Ddns(valor.direccionIpv4) }
      });
    }
    exigirClaves(valor, ['direccionIpv6'], 'valor');
    return congelar({
      tipo,
      modo,
      valor: { direccionIpv6: canonicalizarIpv6Ddns(valor.direccionIpv6) }
    });
  }

  exigirObjetoPlano(valor, 'valor');
  if (tipo === 'A') {
    exigirClaves(valor, ['direccionIpv4'], 'valor');
    return congelar({
      tipo,
      modo,
      valor: { direccionIpv4: canonicalizarIpv4Ddns(valor.direccionIpv4) }
    });
  }
  if (tipo === 'AAAA') {
    exigirClaves(valor, ['direccionIpv6'], 'valor');
    return congelar({
      tipo,
      modo,
      valor: { direccionIpv6: canonicalizarIpv6Ddns(valor.direccionIpv6) }
    });
  }
  if (tipo === 'CNAME') {
    exigirClaves(valor, ['destino'], 'valor');
    return congelar({
      tipo,
      modo,
      valor: {
        destino: canonicalizarNombreAbsolutoDdns(valor.destino, {
          admitirRaiz: false,
          campo: 'valor.destino'
        })
      }
    });
  }

  exigirClaves(valor, ['prioridad', 'destino'], 'valor');
  exigir(
    Number.isInteger(valor.prioridad) &&
      valor.prioridad >= 0 && valor.prioridad <= 65_535,
    'La prioridad MX debe ser un entero entre 0 y 65535.',
    'valor.prioridad'
  );
  const destino = canonicalizarNombreAbsolutoDdns(valor.destino, {
    admitirRaiz: true,
    campo: 'valor.destino'
  });
  exigir(
    destino !== '.' || valor.prioridad === 0,
    'Null MX se representa exclusivamente mediante prioridad 0 y destino raíz.',
    'valor'
  );
  return congelar({
    tipo,
    modo,
    valor: { prioridad: valor.prioridad, destino }
  });
}

export function canonicalizarIpv4Ddns(valor) {
  exigirTextoSinEspacios(valor, 'valor.direccionIpv4');
  if (isIP(valor) === 4) return valor;
  if (isIP(valor) === 6) {
    const canonica = canonicalizarIpv6Base(valor);
    const mapeada = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(canonica);
    if (mapeada) {
      const alta = Number.parseInt(mapeada[1], 16);
      const baja = Number.parseInt(mapeada[2], 16);
      return [alta >>> 8, alta & 255, baja >>> 8, baja & 255].join('.');
    }
  }
  fallar('El valor A no representa una dirección IPv4.', 'valor.direccionIpv4');
}

export function canonicalizarIpv6Ddns(valor) {
  exigirTextoSinEspacios(valor, 'valor.direccionIpv6');
  exigir(!valor.includes('%'),
    'El valor AAAA no admite un identificador de zona local.',
    'valor.direccionIpv6');
  exigir(isIP(valor) === 6,
    'El valor AAAA no representa una dirección IPv6.',
    'valor.direccionIpv6');
  const canonica = canonicalizarIpv6Base(valor);
  exigir(!/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/u.test(canonica),
    'Una IPv4 mapeada se clasifica como IPv4 y no pertenece a AAAA.',
    'valor.direccionIpv6');
  return canonica;
}

export function canonicalizarNombreAbsolutoDdns(
  valor,
  { admitirRaiz = false, campo = 'valor.destino' } = {}
) {
  exigirTextoSinEspacios(valor, campo);
  if (valor === '.') {
    exigir(admitirRaiz, 'La raíz DNS no es un destino admitido aquí.', campo);
    return '.';
  }
  exigir(valor === valor.trim() && !/\s/u.test(valor),
    'El destino DNS no admite espacios.', campo);
  exigir([...valor].every((caracter) => caracter.codePointAt(0) <= 0x7f),
    'El destino DNS debe llegar representado como ASCII o punycode.', campo);
  const sinPunto = valor.endsWith('.') ? valor.slice(0, -1) : valor;
  exigir(sinPunto.length > 0 && sinPunto.length <= 253,
    'El destino DNS supera la longitud admitida.', campo);
  exigir(!sinPunto.endsWith('.'),
    'El destino DNS contiene una etiqueta vacía.', campo);
  const etiquetas = sinPunto.toLowerCase().split('.');
  exigir(etiquetas.every((etiqueta) =>
    etiqueta.length >= 1 && etiqueta.length <= 63 && PATRON_ETIQUETA.test(etiqueta)
  ), 'El destino DNS contiene una etiqueta no interpretable.', campo);
  return `${etiquetas.join('.')}.`;
}

function canonicalizarIpv6Base(valor) {
  exigir(!valor.includes('%'),
    'Una dirección DDNS no admite un identificador de zona local.',
    'valor');
  const hostname = new URL(`http://[${valor}]/`).hostname;
  return hostname.slice(1, -1).toLowerCase();
}

function exigirTextoSinEspacios(valor, campo) {
  exigir(typeof valor === 'string' && valor.length > 0 && valor === valor.trim(),
    'El valor DDNS debe ser texto no vacío sin espacios exteriores.', campo);
}

function exigirObjetoPlano(valor, campo) {
  const prototipo = valor && typeof valor === 'object'
    ? Object.getPrototypeOf(valor)
    : null;
  exigir(
    valor !== null && !Array.isArray(valor) &&
      (prototipo === Object.prototype || prototipo === null),
    'El valor DDNS debe ser un objeto plano.',
    campo
  );
}

function exigirClaves(valor, esperadas, campo) {
  const actuales = Object.keys(valor).sort();
  const requeridas = [...esperadas].sort();
  exigir(JSON.stringify(actuales) === JSON.stringify(requeridas),
    `${campo} exige exactamente: ${esperadas.join(', ')}.`, campo);
}

function congelar(valor) {
  if (valor.valor && typeof valor.valor === 'object') Object.freeze(valor.valor);
  return Object.freeze(valor);
}

function exigir(condicion, mensaje, campo) {
  if (!condicion) fallar(mensaje, campo);
}

function fallar(mensaje, campo) {
  throw new ErrorValorDdnsNoInterpretable(mensaje, campo);
}
