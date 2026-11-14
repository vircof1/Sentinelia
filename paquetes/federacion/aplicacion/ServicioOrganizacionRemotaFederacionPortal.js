import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

export class ServicioOrganizacionRemotaFederacionPortal {
  constructor({ repositorio, servicioAutorizacion } = {}) {
    if (typeof repositorio?.listar !== 'function') {
      throw new Error('La organización remota requiere su repositorio materializado.');
    }
    if (typeof servicioAutorizacion?.puedeExplorarDatosRemotosFederacion !== 'function') {
      throw new Error('La organización remota requiere autorización explícita.');
    }
    this.repositorio = repositorio;
    this.autorizacion = servicioAutorizacion;
  }

  async obtener(contextoUsuarioActual, { installationOrigenId } = {}) {
    if (
      !this.autorizacion.puedeExplorarDatosRemotosFederacion(contextoUsuarioActual) ||
      !this.autorizacion.puedeVer(contextoUsuarioActual)
    ) {
      throw errorHttp(403, 'organizacion_remota_no_autorizada',
        'La estructura organizativa remota no es visible.');
    }
    const procedencia = validarInstalacion(installationOrigenId);
    const nodos = await this.repositorio.listar({
      installationOrigenId: procedencia,
      scope: scopeEfectivo(contextoUsuarioActual)
    });
    const presentados = nodos.map(presentarNodo).sort(compararNodos);
    const actuales = presentados.filter((nodo) => nodo.estadoRegistro === 'presente');
    const retirados = presentados.filter((nodo) => nodo.estadoRegistro === 'retirado');
    return Object.freeze({
      installationOrigenId: procedencia,
      actuales: Object.freeze(actuales),
      retirados: Object.freeze(retirados),
      resumen: Object.freeze({
        total: actuales.length,
        tenants: contar(actuales, 'tenant'),
        empresas: contar(actuales, 'empresa'),
        sitios: contar(actuales, 'sitio'),
        retirados: retirados.length
      })
    });
  }
}

function presentarNodo(nodo) {
  const linaje = nodo.linaje.map((ancestro) => Object.freeze({
    tipo: ancestro.tipo,
    elementoOrigenId: ancestro.elementoOrigenId,
    nombre: ancestro.visibilidad === 'seleccionada'
      ? ancestro.nombre
      : 'Ámbito no visible',
    visibilidad: ancestro.visibilidad
  }));
  return Object.freeze({
    ...nodo,
    linaje: Object.freeze(linaje),
    profundidad: { tenant: 0, empresa: 1, sitio: 2 }[nodo.tipo],
    ruta: Object.freeze([
      ...linaje,
      Object.freeze({
        tipo: nodo.tipo,
        elementoOrigenId: nodo.elementoOrigenId,
        nombre: nodo.nombre,
        visibilidad: 'seleccionada'
      })
    ])
  });
}

function compararNodos(a, b) {
  const rutaA = a.ruta.map((tramo) => tramo.nombre).join('\u0000');
  const rutaB = b.ruta.map((tramo) => tramo.nombre).join('\u0000');
  return rutaA.localeCompare(rutaB, 'es', { sensitivity: 'base' });
}

function contar(nodos, tipo) {
  return nodos.filter((nodo) => nodo.tipo === tipo).length;
}

function scopeEfectivo(contexto) {
  return Object.freeze({
    nivel: contexto?.nivelScope,
    tenantId: contexto?.tenantId ?? null,
    empresaId: contexto?.empresaId ?? null,
    sitioId: contexto?.sitioId ?? null
  });
}

function validarInstalacion(valor) {
  try {
    return String(crearIdentidadFederada({
      valor: String(valor || ''),
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    }));
  } catch {
    throw errorHttp(400, 'installation_organizacion_remota_invalida',
      'Selecciona una instalación remota válida.');
  }
}

function errorHttp(statusCode, codigo, mensaje) {
  const error = new Error(mensaje);
  error.statusCode = statusCode;
  error.codigo = codigo;
  return error;
}
