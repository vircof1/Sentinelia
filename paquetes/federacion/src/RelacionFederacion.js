import {
  DIRECCIONES_FEDERACION,
  ESTADOS_AUTORIDAD_RELACION_FEDERACION,
  ESTADOS_CICLO_RELACION_FEDERACION,
  ESTADOS_COMPATIBILIDAD_RELACION_FEDERACION,
  ESTADOS_IDENTIDAD_RELACION_FEDERACION
} from './CatalogosFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from './IdentidadFederada.js';

export function crearRelacionFederacion(entrada = {}) {
  exigirObjetoPlano(entrada, 'relación');
  exigirClavesExactas(entrada, [
    'direccion',
    'estadoAutoridad',
    'estadoCiclo',
    'estadoCompatibilidad',
    'estadoIdentidad',
    'installationRemotaCandidataId',
    'installationRemotaId',
    'nombreRemotoDeclarado',
    'relacionId',
    'responsableUsuarioId',
    'scope',
    'versionAutoridad'
  ], 'relación');
  const relacionId = identidad(
    entrada.relacionId,
    TIPOS_IDENTIDAD_FEDERADA.RELACION,
    'relacionId'
  );
  const candidata = identidadOpcional(
    entrada.installationRemotaCandidataId,
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
    'installationRemotaCandidataId'
  );
  const confirmada = identidadOpcional(
    entrada.installationRemotaId,
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
    'installationRemotaId'
  );
  const direccion = DIRECCIONES_FEDERACION.exigir(entrada.direccion);
  const estadoCiclo = ESTADOS_CICLO_RELACION_FEDERACION.exigir(
    entrada.estadoCiclo
  );
  const estadoAutoridad = ESTADOS_AUTORIDAD_RELACION_FEDERACION.exigir(
    entrada.estadoAutoridad
  );
  const estadoIdentidad = ESTADOS_IDENTIDAD_RELACION_FEDERACION.exigir(
    entrada.estadoIdentidad
  );
  const estadoCompatibilidad = entrada.estadoCompatibilidad === null
    ? null
    : ESTADOS_COMPATIBILIDAD_RELACION_FEDERACION.exigir(
      entrada.estadoCompatibilidad
    );
  const responsableUsuarioId = decimalOpcional(
    entrada.responsableUsuarioId,
    'responsableUsuarioId'
  );
  const scope = validarScope(entrada.scope);
  exigir(
    Number.isSafeInteger(entrada.versionAutoridad) &&
      entrada.versionAutoridad >= 1,
    'versionAutoridad debe ser un entero seguro positivo.'
  );
  exigir(
    estadoAutoridad !== 'autorizada' || responsableUsuarioId !== null,
    'Una relación autorizada exige usuario responsable.'
  );
  exigir(
    estadoCiclo !== 'pendienteVinculacion' ||
      (candidata === null && confirmada === null),
    'Una vinculación no canjeada aún no puede fijar una identidad remota.'
  );
  exigir(
    estadoCiclo !== 'pendienteConfirmacionIdentidad' ||
      (candidata !== null && confirmada === null),
    'La confirmación pendiente exige únicamente una identidad candidata.'
  );
  exigir(
    estadoCiclo !== 'pendienteAutenticacion' ||
      (candidata !== null && confirmada !== null && candidata.esIgual(confirmada)),
    'La autenticación pendiente exige la identidad remota ya confirmada.'
  );
  exigir(
    !['vinculada', 'deshabilitada'].includes(estadoCiclo) ||
      (candidata !== null && confirmada !== null &&
        candidata.esIgual(confirmada) && estadoCompatibilidad !== null),
    'Una relación vinculada o deshabilitada exige identidad y compatibilidad conocidas.'
  );
  const nombreRemotoDeclarado = textoHumanoOpcional(
    entrada.nombreRemotoDeclarado,
    191,
    'nombreRemotoDeclarado'
  );
  return congelar({
    relacionId: relacionId.toString(),
    direccion,
    estadoCiclo,
    estadoAutoridad,
    estadoIdentidad,
    estadoCompatibilidad,
    installationRemotaCandidataId: candidata?.toString() || null,
    installationRemotaId: confirmada?.toString() || null,
    nombreRemotoDeclarado,
    responsableUsuarioId,
    scope,
    versionAutoridad: entrada.versionAutoridad
  });
}

export function normalizarEndpointFederacion(valor) {
  if (typeof valor !== 'string' || valor !== valor.trim() || valor.length > 2048) {
    throw new Error('El endpoint federado debe ser texto acotado sin espacios exteriores.');
  }
  let url;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('El endpoint federado no es una URL válida.');
  }
  exigir(url.protocol === 'https:', 'El endpoint federado debe usar HTTPS.');
  exigir(!url.username && !url.password, 'El endpoint no admite credenciales embebidas.');
  exigir(!url.search && !url.hash, 'El endpoint no admite query ni fragmento.');
  exigir(Boolean(url.hostname), 'El endpoint federado exige host.');
  const ruta = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  const canonico = `${url.origin}${ruta}`;
  exigir(canonico.length <= 2048, 'El endpoint canónico supera el límite.');
  return canonico;
}

function identidad(valor, tipo, campo) {
  return crearIdentidadFederada({ tipo, valor });
}

function identidadOpcional(valor, tipo, campo) {
  if (valor === null) return null;
  try {
    return identidad(valor, tipo, campo);
  } catch (error) {
    error.message = `${campo}: ${error.message}`;
    throw error;
  }
}

function validarScope(scope) {
  exigirObjetoPlano(scope, 'scope');
  exigirClavesExactas(scope, ['empresaId', 'sitioId', 'tenantId'], 'scope');
  const normalizado = {
    tenantId: decimalOpcional(scope.tenantId, 'scope.tenantId'),
    empresaId: decimalOpcional(scope.empresaId, 'scope.empresaId'),
    sitioId: decimalOpcional(scope.sitioId, 'scope.sitioId')
  };
  exigir(
    normalizado.tenantId !== null ||
      (normalizado.empresaId === null && normalizado.sitioId === null),
    'Un scope portal no admite empresa ni sitio.'
  );
  exigir(
    normalizado.empresaId !== null || normalizado.sitioId === null,
    'Un sitio exige empresa.'
  );
  return congelar(normalizado);
}

function decimalOpcional(valor, campo) {
  exigir(
    valor === null || (typeof valor === 'string' && /^[1-9][0-9]*$/.test(valor)),
    `${campo} debe ser null o un decimal canónico positivo.`
  );
  return valor;
}

function textoHumanoOpcional(valor, limite, campo) {
  if (valor === null) return null;
  exigir(typeof valor === 'string', `${campo} debe ser texto o null.`);
  const normalizado = valor.trim().normalize('NFC');
  exigir(normalizado.length > 0 && normalizado.length <= limite, `${campo} no es válido.`);
  exigir(!/[\u0000-\u001f\u007f]/u.test(normalizado), `${campo} contiene controles.`);
  return normalizado;
}

function exigirObjetoPlano(valor, nombre) {
  exigir(
    valor !== null && typeof valor === 'object' && !Array.isArray(valor) &&
      Object.getPrototypeOf(valor) === Object.prototype,
    `${nombre} debe ser un objeto plano.`
  );
}

function exigirClavesExactas(valor, claves, nombre) {
  const actuales = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  exigir(
    actuales.length === esperadas.length &&
      actuales.every((clave, indice) => clave === esperadas[indice]),
    `${nombre} contiene campos ausentes o desconocidos.`
  );
}

function congelar(valor) {
  Object.freeze(valor);
  return valor;
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
