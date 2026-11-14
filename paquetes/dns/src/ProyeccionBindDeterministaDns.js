import { createHash } from 'node:crypto';
import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';

export const PERFIL_PROYECCION_BIND_DNS_V1 = 'sentinelia-bind-proyeccion-v1';

const PATRON_COMPONENTE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class ProyeccionBindDeterministaDns {
  constructor({ validarDestino } = {}) {
    if (typeof validarDestino !== 'function') {
      throw new Error('La proyección BIND requiere comprobar el destino bajo el bloqueo externo.');
    }
    this.validarDestino = validarDestino;
  }

  async materializar(artefactos = [], {
    contextoDestino = null,
    diagnostico = null
  } = {}) {
    if (!Array.isArray(artefactos)) {
      throw new Error('Los artefactos BIND deben ser una lista cerrada.');
    }

    const rutas = new Set();
    const validados = [];
    for (const artefacto of artefactos) {
      const ruta = validarRutaRelativaBind(artefacto?.ruta);
      if (rutas.has(ruta)) {
        throw new Error(`La ruta BIND ${ruta} está duplicada.`);
      }
      rutas.add(ruta);
      const destinoSeguro = await this.validarDestino({ ruta, contexto: contextoDestino });
      if (destinoSeguro !== true) {
        throw new Error(`El destino BIND ${ruta} no es seguro o contiene enlaces simbólicos.`);
      }
      if (!Buffer.isBuffer(artefacto?.contenido)) {
        throw new Error(`El contenido BIND de ${ruta} debe estar materializado como bytes.`);
      }
      validados.push({ ruta, contenido: Buffer.from(artefacto.contenido) });
    }

    validados.sort((a, b) => compararAsciiBinario(a.ruta, b.ruta));
    const manifiesto = {
      perfil: PERFIL_PROYECCION_BIND_DNS_V1,
      archivos: validados.map(({ ruta, contenido }) => ({
        ruta,
        sha256Contenido: sha256(contenido).toString('hex')
      })),
      ...(diagnostico ? { diagnostico: normalizarDiagnostico(diagnostico, rutas) } : {})
    };
    const manifiestoCanonico = canonicalizarRfc8785(manifiesto);

    return new FotografiaProyeccionBindDns({
      artefactos: validados,
      manifiesto,
      manifiestoCanonico,
      hashProyeccion: sha256(Buffer.from(manifiestoCanonico, 'utf8'))
    });
  }
}

export class FotografiaProyeccionBindDns {
  #artefactos;
  #hashProyeccion;

  constructor({ artefactos, manifiesto, manifiestoCanonico, hashProyeccion }) {
    this.#artefactos = artefactos.map(({ ruta, contenido }) => ({
      ruta,
      contenido: Buffer.from(contenido)
    }));
    this.perfilProyeccion = PERFIL_PROYECCION_BIND_DNS_V1;
    this.manifiesto = Object.freeze({
      perfil: manifiesto.perfil,
      archivos: Object.freeze(manifiesto.archivos.map((archivo) => Object.freeze({ ...archivo }))),
      ...(manifiesto.diagnostico ? {
        diagnostico: Object.freeze({
          perfil: manifiesto.diagnostico.perfil,
          entradas: Object.freeze(
            manifiesto.diagnostico.entradas.map((entrada) => Object.freeze({ ...entrada }))
          )
        })
      } : {})
    });
    this.manifiestoCanonico = manifiestoCanonico;
    this.#hashProyeccion = Buffer.from(hashProyeccion);
    Object.freeze(this);
  }

  listarArtefactos() {
    return this.#artefactos.map(({ ruta, contenido }) => Object.freeze({
      ruta,
      contenido: Buffer.from(contenido)
    }));
  }

  get hashProyeccion() {
    return Buffer.from(this.#hashProyeccion);
  }
}

function normalizarDiagnostico(diagnostico, rutasArtefactos) {
  if (diagnostico?.perfil !== 'sentinelia-bind-diagnostico-v1' ||
      !Array.isArray(diagnostico?.entradas)) {
    throw new Error('El manifiesto diagnóstico BIND no es válido.');
  }
  const entradas = diagnostico.entradas.map((entrada) => {
    const rutaZona = validarRutaRelativaBind(entrada?.rutaZona);
    if (!rutasArtefactos.has(rutaZona)) {
      throw new Error('El diagnóstico BIND referencia un artefacto inexistente.');
    }
    return {
      zonaDnsId: decimalPositivo(entrada.zonaDnsId, 'zonaDnsId'),
      rutaZona,
      linea: enteroPositivo(entrada.linea, 'linea'),
      registroDnsId: decimalPositivo(entrada.registroDnsId, 'registroDnsId'),
      concesionId: entrada.concesionId === null ? null : uuidV7(entrada.concesionId),
      versionDdns: entrada.versionDdns === null
        ? null
        : decimalNoNegativo(entrada.versionDdns, 'versionDdns')
    };
  });
  entradas.sort((a, b) =>
    compararAsciiBinario(a.rutaZona, b.rutaZona) || a.linea - b.linea
  );
  const claves = new Set();
  for (const entrada of entradas) {
    const clave = `${entrada.rutaZona}:${entrada.linea}`;
    if (claves.has(clave)) throw new Error('El diagnóstico BIND duplica una línea.');
    claves.add(clave);
    if ((entrada.concesionId === null) !== (entrada.versionDdns === null)) {
      throw new Error('Concesión y versión DDNS deben aparecer conjuntamente.');
    }
  }
  return { perfil: diagnostico.perfil, entradas };
}

function decimalPositivo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error(`${nombre} no es decimal positivo.`);
  return texto;
}

function decimalNoNegativo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^(?:0|[1-9][0-9]*)$/u.test(texto)) {
    throw new Error(`${nombre} no es decimal no negativo.`);
  }
  return texto;
}

function enteroPositivo(valor, nombre) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error(`${nombre} no es entero positivo.`);
  }
  return numero;
}

function uuidV7(valor) {
  const texto = String(valor ?? '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(texto)) {
    throw new Error('concesionId no es UUIDv7.');
  }
  return texto;
}

export function validarRutaRelativaBind(valor) {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 1024) {
    throw new Error('La ruta BIND debe ser un texto relativo no vacío de hasta 1024 bytes ASCII.');
  }
  if (Buffer.byteLength(valor, 'ascii') !== valor.length || !/^[\x00-\x7F]+$/.test(valor)) {
    throw new Error('La ruta BIND solo admite ASCII.');
  }
  if (valor.startsWith('/') || valor.endsWith('/') || valor.includes('//') ||
      valor.includes('\\') || valor.includes('\0')) {
    throw new Error(`La ruta BIND ${valor} no es relativa canónica.`);
  }
  const componentes = valor.split('/');
  if (componentes.some((item) => item === '.' || item === '..' ||
      item.length > 255 || !PATRON_COMPONENTE.test(item))) {
    throw new Error(`La ruta BIND ${valor} contiene componentes no permitidos.`);
  }
  return valor;
}

export function compararAsciiBinario(a, b) {
  return Buffer.compare(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest();
}
