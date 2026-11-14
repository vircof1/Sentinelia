import {
  CAUSAS_OMISION_CAMPO_FEDERADO,
  FAMILIAS_FEDERACION,
  OPERACIONES_OCURRENCIA_FEDERACION,
  SENSIBILIDADES_CAMPO_FEDERADO,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from './CatalogosFederacion.js';
import {
  PERFIL_CANONICO_FEDERACION,
  canonicalizarJsonFederacion,
  codificarUtf8CanonicoFederacion,
  normalizarJsonFederacion
} from './CanonicalizadorFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  exigirIdentidadFederada
} from './IdentidadFederada.js';
import {
  crearScopeFederacion,
  esScopeFederacion
} from './ScopeFederacion.js';

export const PERFIL_OCURRENCIA_ORIGEN_FEDERACION =
  'sentinelia-federacion-ocurrencia-origen-v1';
export const PERFIL_VISTA_AUTORIZADA_FEDERACION =
  'sentinelia-federacion-vista-autorizada-v1';
export const PERFIL_ENVOLVENTE_FEDERACION =
  'sentinelia-federacion-envolvente-v1';

const PATRON_ENTERO_DECIMAL = /^(0|[1-9][0-9]*)$/;
const PATRON_FECHA_UTC_MILISEGUNDOS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OCURRENCIAS_ORIGEN_FEDERADAS = new WeakSet();
const VISTAS_AUTORIZADAS_FEDERACION = new WeakSet();
const ENVOLVENTES_FEDERACION = new WeakSet();

export class ErrorEnvolventeFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorEnvolventeFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

class RegistroCanonicoFederacion {
  #datos;
  #canonico;

  constructor(datos) {
    this.#datos = normalizarJsonFederacion(datos);
    this.#canonico = canonicalizarJsonFederacion(this.#datos);
  }

  canonicalizar() {
    return this.#canonico;
  }

  codificarUtf8() {
    return codificarUtf8CanonicoFederacion(this.#datos);
  }

  toJSON() {
    return this.#datos;
  }
}

class OcurrenciaOrigenFederada extends RegistroCanonicoFederacion {
  constructor(datos) {
    super(datos);
    OCURRENCIAS_ORIGEN_FEDERADAS.add(this);
    Object.freeze(this);
  }
}

class VistaAutorizadaFederacion extends RegistroCanonicoFederacion {
  constructor(datos) {
    super(datos);
    VISTAS_AUTORIZADAS_FEDERACION.add(this);
    Object.freeze(this);
  }
}

class EnvolventeFederacion extends RegistroCanonicoFederacion {
  constructor(datos) {
    super(datos);
    ENVOLVENTES_FEDERACION.add(this);
    Object.freeze(this);
  }
}

export function crearCampoPresenteFederado({
  valor,
  sensibilidad = 'ordinario'
} = {}) {
  return normalizarDeclaracionCampo({
    estado: 'presente',
    sensibilidad: SENSIBILIDADES_CAMPO_FEDERADO.exigir(sensibilidad),
    valor
  });
}

export function crearCampoOmitidoFederado({ causa } = {}) {
  return normalizarDeclaracionCampo({
    estado: 'omitido',
    causa: CAUSAS_OMISION_CAMPO_FEDERADO.exigir(causa)
  });
}

export function crearCampoRetiradoFederado() {
  return normalizarDeclaracionCampo({ estado: 'retirado' });
}

export function crearEvidenciaDisponibleFederacion({
  tipo,
  alcance,
  campos = [],
  contenido
} = {}) {
  return normalizarEvidenciaDisponible({ tipo, alcance, campos, contenido });
}

export function crearOcurrenciaOrigenFederada({
  protocoloVersion = VERSION_PROTOCOLO_FEDERACION,
  familia,
  familiaVersion,
  installationOrigenId,
  elementoOrigenId,
  ocurrenciaOrigenId,
  secuenciaElemento,
  operacion,
  tiempoOrigenUtc,
  scopeOrigenDeclarado,
  vigenciaRestanteMs = null,
  campos,
  evidenciaIntegridad = []
} = {}) {
  exigirVersionProtocolo(protocoloVersion);
  const familiaValidada = FAMILIAS_FEDERACION.exigir(familia);
  exigirVersionFamilia(familiaValidada, familiaVersion);
  const operacionValidada = OPERACIONES_OCURRENCIA_FEDERACION.exigir(operacion);
  validarOperacionPorFamilia(familiaValidada, operacionValidada);
  const vigenciaNormalizada = vigenciaRestanteMs === null
    ? null
    : exigirEnteroDecimal(vigenciaRestanteMs, 'vigenciaRestanteMs');
  validarVigenciaOcurrencia({
    familia: familiaValidada,
    operacion: operacionValidada,
    vigenciaRestanteMs: vigenciaNormalizada
  });
  const camposNormalizados = normalizarCampos(campos);
  validarCamposPorOperacion(operacionValidada, camposNormalizados);
  const scopeNormalizado = normalizarScopeOrigenDeclarado(
    scopeOrigenDeclarado
  );
  const evidenciaNormalizada = exigirArrayJson(
    evidenciaIntegridad,
    'evidenciaIntegridad'
  );

  return new OcurrenciaOrigenFederada({
    perfil: PERFIL_OCURRENCIA_ORIGEN_FEDERACION,
    perfilCanonico: PERFIL_CANONICO_FEDERACION,
    protocoloVersion,
    familia: familiaValidada,
    familiaVersion,
    installationOrigenId: serializarIdentidad(
      installationOrigenId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationOrigenId'
    ),
    elementoOrigenId: serializarIdentidad(
      elementoOrigenId,
      TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
      'elementoOrigenId'
    ),
    ocurrenciaOrigenId: serializarIdentidad(
      ocurrenciaOrigenId,
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
      'ocurrenciaOrigenId'
    ),
    secuenciaElemento: exigirEnteroDecimalPositivo(
      secuenciaElemento,
      'secuenciaElemento'
    ),
    operacion: operacionValidada,
    tiempoOrigenUtc: exigirFechaUtc(tiempoOrigenUtc, 'tiempoOrigenUtc'),
    scopeOrigenDeclarado: scopeNormalizado,
    vigenciaRestanteMs: vigenciaNormalizada,
    campos: camposNormalizados,
    evidenciaIntegridad: evidenciaNormalizada
  });
}

export function crearVistaAutorizadaFederacion({
  ocurrenciaOrigen,
  entregaId,
  revisionConcesionId,
  campos,
  evidenciaDisponible = []
} = {}) {
  exigirInstancia(
    ocurrenciaOrigen,
    OCURRENCIAS_ORIGEN_FEDERADAS,
    'ocurrencia_origen_invalida',
    'ocurrenciaOrigen'
  );
  const afirmacionOrigen = ocurrenciaOrigen.toJSON();
  const camposNormalizados = normalizarCampos(campos);
  validarVistaContraOrigen({
    camposOrigen: afirmacionOrigen.campos,
    camposVista: camposNormalizados,
    operacion: afirmacionOrigen.operacion
  });
  const evidenciaNormalizada = normalizarEvidenciasDisponibles(
    evidenciaDisponible,
    camposNormalizados
  );

  return new VistaAutorizadaFederacion({
    perfil: PERFIL_VISTA_AUTORIZADA_FEDERACION,
    perfilCanonico: PERFIL_CANONICO_FEDERACION,
    entregaId: serializarIdentidad(
      entregaId,
      TIPOS_IDENTIDAD_FEDERADA.ENTREGA,
      'entregaId'
    ),
    revisionConcesionId: serializarIdentidad(
      revisionConcesionId,
      TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION,
      'revisionConcesionId'
    ),
    ocurrencia: {
      protocoloVersion: afirmacionOrigen.protocoloVersion,
      familia: afirmacionOrigen.familia,
      familiaVersion: afirmacionOrigen.familiaVersion,
      installationOrigenId: afirmacionOrigen.installationOrigenId,
      elementoOrigenId: afirmacionOrigen.elementoOrigenId,
      ocurrenciaOrigenId: afirmacionOrigen.ocurrenciaOrigenId,
      secuenciaElemento: afirmacionOrigen.secuenciaElemento,
      operacion: afirmacionOrigen.operacion,
      tiempoOrigenUtc: afirmacionOrigen.tiempoOrigenUtc,
      scopeOrigenDeclarado: afirmacionOrigen.scopeOrigenDeclarado,
      vigenciaRestanteMs: afirmacionOrigen.vigenciaRestanteMs,
      campos: camposNormalizados
    },
    evidenciaDisponible: evidenciaNormalizada
  });
}

export function crearEnvolventeFederacion({
  vistaAutorizada,
  installationEmisoraId,
  bootEmisorId,
  recorridoInstalaciones,
  tiemposSaltosDisponibles = []
} = {}) {
  exigirInstancia(
    vistaAutorizada,
    VISTAS_AUTORIZADAS_FEDERACION,
    'vista_autorizada_invalida',
    'vistaAutorizada'
  );
  const installationEmisoraSerializada = serializarIdentidad(
    installationEmisoraId,
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
    'installationEmisoraId'
  );
  const bootEmisorSerializado = serializarIdentidad(
    bootEmisorId,
    TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
    'bootEmisorId'
  );
  const recorrido = normalizarRecorrido(recorridoInstalaciones);
  const ocurrencia = vistaAutorizada.toJSON().ocurrencia;
  if (recorrido[0] !== ocurrencia.installationOrigenId) {
    fallar(
      'recorrido_sin_origen',
      'El recorrido debe comenzar en la instalación de origen.',
      'recorridoInstalaciones'
    );
  }
  if (recorrido.at(-1) !== installationEmisoraSerializada) {
    fallar(
      'recorrido_sin_emisor',
      'El recorrido debe terminar en el emisor inmediato.',
      'recorridoInstalaciones'
    );
  }
  const saltos = normalizarTiemposSaltos({
    tiemposSaltosDisponibles,
    recorrido,
    installationEmisoraSerializada,
    bootEmisorSerializado
  });

  return new EnvolventeFederacion({
    perfil: PERFIL_ENVOLVENTE_FEDERACION,
    perfilCanonico: PERFIL_CANONICO_FEDERACION,
    protocoloVersion: ocurrencia.protocoloVersion,
    familia: ocurrencia.familia,
    familiaVersion: ocurrencia.familiaVersion,
    emisorInmediato: {
      installationId: installationEmisoraSerializada,
      bootId: bootEmisorSerializado
    },
    recorridoInstalaciones: recorrido,
    tiemposSaltosDisponibles: saltos,
    vistaAutorizada: vistaAutorizada.toJSON()
  });
}

export function esOcurrenciaOrigenFederada(valor) {
  return OCURRENCIAS_ORIGEN_FEDERADAS.has(valor);
}

export function esVistaAutorizadaFederacion(valor) {
  return VISTAS_AUTORIZADAS_FEDERACION.has(valor);
}

export function esEnvolventeFederacion(valor) {
  return ENVOLVENTES_FEDERACION.has(valor);
}

export function exigirDestinoNoVisitadoFederacion({
  envolvente,
  installationDestinoId
} = {}) {
  exigirInstancia(
    envolvente,
    ENVOLVENTES_FEDERACION,
    'envolvente_invalida',
    'envolvente'
  );
  const destino = serializarIdentidad(
    installationDestinoId,
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
    'installationDestinoId'
  );
  if (envolvente.toJSON().recorridoInstalaciones.includes(destino)) {
    fallar(
      'recorrido_ciclico_destino',
      'La ocurrencia no puede emitirse hacia una instalacion ya visitada.',
      'installationDestinoId'
    );
  }
  return destino;
}

function normalizarDeclaracionCampo(declaracion) {
  const normalizada = normalizarJsonFederacion(declaracion);
  exigirObjetoPlanoNormalizado(normalizada, 'campo');
  if (normalizada.estado === 'presente') {
    exigirClavesExactas(normalizada, ['estado', 'sensibilidad', 'valor'], 'campo');
    SENSIBILIDADES_CAMPO_FEDERADO.exigir(normalizada.sensibilidad);
    return normalizada;
  }
  if (normalizada.estado === 'omitido') {
    exigirClavesExactas(normalizada, ['causa', 'estado'], 'campo');
    CAUSAS_OMISION_CAMPO_FEDERADO.exigir(normalizada.causa);
    return normalizada;
  }
  if (normalizada.estado === 'retirado') {
    exigirClavesExactas(normalizada, ['estado'], 'campo');
    return normalizada;
  }
  fallar(
    'estado_campo_invalido',
    'La declaración de campo no usa un estado contractual.',
    'campo.estado'
  );
}

function normalizarEvidenciaDisponible(evidencia) {
  const normalizada = exigirObjetoJson(evidencia, 'evidenciaDisponible[]');
  exigirClavesExactas(
    normalizada,
    ['alcance', 'campos', 'contenido', 'tipo'],
    'evidenciaDisponible[]'
  );
  if (typeof normalizada.tipo !== 'string' || normalizada.tipo.length === 0) {
    fallar(
      'tipo_evidencia_invalido',
      'La evidencia disponible necesita un tipo no vacío.',
      'evidenciaDisponible[].tipo'
    );
  }
  if (!['metadatos', 'camposAutorizados'].includes(normalizada.alcance)) {
    fallar(
      'alcance_evidencia_invalido',
      'La evidencia debe limitarse a metadatos o campos autorizados.',
      'evidenciaDisponible[].alcance'
    );
  }
  if (
    !Array.isArray(normalizada.campos) ||
    normalizada.campos.some((campo) => typeof campo !== 'string' || campo.length === 0) ||
    new Set(normalizada.campos).size !== normalizada.campos.length
  ) {
    fallar(
      'campos_evidencia_invalidos',
      'Los campos cubiertos por una evidencia deben ser textos únicos.',
      'evidenciaDisponible[].campos'
    );
  }
  const camposOrdenados = [...normalizada.campos].sort();
  if (
    (normalizada.alcance === 'metadatos' && camposOrdenados.length !== 0) ||
    (normalizada.alcance === 'camposAutorizados' && camposOrdenados.length === 0)
  ) {
    fallar(
      'cobertura_evidencia_incoherente',
      'La cobertura declarada de la evidencia no coincide con su alcance.',
      'evidenciaDisponible[].campos'
    );
  }
  return normalizarJsonFederacion({
    tipo: normalizada.tipo,
    alcance: normalizada.alcance,
    campos: camposOrdenados,
    contenido: normalizada.contenido
  });
}

function normalizarEvidenciasDisponibles(evidencias, camposVista) {
  const entradas = exigirArrayJson(evidencias, 'evidenciaDisponible');
  const normalizadas = entradas
    .map(normalizarEvidenciaDisponible)
    .sort((a, b) => {
      const canonicoA = canonicalizarJsonFederacion(a);
      const canonicoB = canonicalizarJsonFederacion(b);
      if (canonicoA < canonicoB) return -1;
      if (canonicoA > canonicoB) return 1;
      return 0;
    });
  for (let indice = 1; indice < normalizadas.length; indice += 1) {
    if (
      canonicalizarJsonFederacion(normalizadas[indice - 1]) ===
      canonicalizarJsonFederacion(normalizadas[indice])
    ) {
      fallar(
        'evidencia_disponible_duplicada',
        'La vista autorizada no debe repetir la misma evidencia.',
        `evidenciaDisponible[${indice}]`
      );
    }
  }
  for (const [indice, evidencia] of normalizadas.entries()) {
    for (const campo of evidencia.campos) {
      if (camposVista[campo]?.estado !== 'presente') {
        fallar(
          'evidencia_sobre_campo_no_expuesto',
          'Una evidencia de contenido solo puede cubrir campos presentes y autorizados.',
          `evidenciaDisponible[${indice}].campos`
        );
      }
    }
  }
  return normalizarJsonFederacion(normalizadas);
}

function normalizarCampos(campos) {
  const normalizados = exigirObjetoJson(campos, 'campos');
  const resultado = [];
  for (const [nombre, declaracion] of Object.entries(normalizados)) {
    if (nombre.length === 0) {
      fallar('nombre_campo_invalido', 'El nombre de campo no puede estar vacío.', 'campos');
    }
    resultado.push([nombre, normalizarDeclaracionCampo(declaracion)]);
  }
  return normalizarJsonFederacion(Object.fromEntries(resultado));
}

function validarCamposPorOperacion(operacion, campos) {
  const cantidad = Object.keys(campos).length;
  if (operacion === 'actualizacion' && cantidad === 0) {
    fallar(
      'actualizacion_sin_campos',
      'Una actualización debe afirmar al menos un campo.',
      'campos'
    );
  }
  if (operacion !== 'actualizacion' && cantidad !== 0) {
    fallar(
      'operacion_terminal_con_campos',
      'Una retirada o salida de proyección no transporta una actualización de campos.',
      'campos'
    );
  }
}

function validarOperacionPorFamilia(familia, operacion) {
  if (familia === 'auditoria' && operacion === 'retirada') {
    fallar(
      'operacion_familia_incompatible',
      'El emisor no puede ordenar la retirada de un evento de auditoria federado.',
      'operacion'
    );
  }
}

function validarVigenciaOcurrencia({ familia, operacion, vigenciaRestanteMs }) {
  if (operacion !== 'actualizacion' && vigenciaRestanteMs !== null) {
    fallar(
      'operacion_terminal_con_vigencia',
      'Una retirada o salida de proyeccion no conserva vigencia operativa.',
      'vigenciaRestanteMs'
    );
  }
  if (familia === 'auditoria' && vigenciaRestanteMs !== null) {
    fallar(
      'vigencia_familia_incompatible',
      'Los eventos de auditoria se conservan por retencion, no por vigencia operativa.',
      'vigenciaRestanteMs'
    );
  }
}

function validarVistaContraOrigen({ camposOrigen, camposVista, operacion }) {
  if (operacion !== 'actualizacion' && Object.keys(camposVista).length !== 0) {
    fallar(
      'operacion_terminal_con_campos',
      'Una retirada o salida de proyección no transporta campos en su vista.',
      'campos'
    );
  }
  for (const [nombre, declaracionVista] of Object.entries(camposVista)) {
    const declaracionOrigen = camposOrigen[nombre];
    if (!declaracionOrigen) {
      fallar(
        'campo_inventado_en_vista',
        `La vista no puede inventar el campo ${nombre}.`,
        `campos.${nombre}`
      );
    }
    if (declaracionVista.estado === 'omitido') {
      if (
        declaracionOrigen.estado === 'omitido' &&
        declaracionVista.causa !== declaracionOrigen.causa
      ) {
        fallar(
          'causa_omision_reinterpretada',
          `La vista no puede cambiar la causa de omision afirmada para ${nombre}.`,
          `campos.${nombre}.causa`
        );
      }
      if (
        declaracionOrigen.estado !== 'omitido' &&
        declaracionVista.causa === 'ausenteEnOrigen'
      ) {
        fallar(
          'ausencia_origen_inventada',
          `La vista no puede declarar ausente en origen el campo ${nombre}.`,
          `campos.${nombre}.causa`
        );
      }
      continue;
    }
    if (
      canonicalizarJsonFederacion(declaracionVista) !==
      canonicalizarJsonFederacion(declaracionOrigen)
    ) {
      fallar(
        'campo_reinterpretado_en_vista',
        `La vista no puede modificar el campo ${nombre} afirmado por el origen.`,
        `campos.${nombre}`
      );
    }
  }
  for (const [nombre, declaracionOrigen] of Object.entries(camposOrigen)) {
    if (
      declaracionOrigen.estado === 'retirado' &&
      camposVista[nombre]?.estado !== 'retirado'
    ) {
      fallar(
        'retirada_campo_ocultada',
        `La vista no puede ocultar la retirada afirmada para ${nombre}.`,
        `campos.${nombre}`
      );
    }
    if (
      declaracionOrigen.estado === 'presente' &&
      declaracionOrigen.valor === null &&
      (
        !camposVista[nombre] ||
        canonicalizarJsonFederacion(camposVista[nombre]) !==
          canonicalizarJsonFederacion(declaracionOrigen)
      )
    ) {
      fallar(
        'vaciado_campo_ocultado',
        `La vista no puede ocultar el vaciado afirmado para ${nombre}.`,
        `campos.${nombre}`
      );
    }
  }
}

function normalizarRecorrido(recorridoInstalaciones) {
  exigirListaDensaDatos(
    recorridoInstalaciones,
    'recorrido_invalido',
    'El recorrido debe contener identidades como una lista densa.',
    'recorridoInstalaciones'
  );
  if (recorridoInstalaciones.length === 0) {
    fallar(
      'recorrido_invalido',
      'El recorrido debe contener al menos la instalación de origen.',
      'recorridoInstalaciones'
    );
  }
  const recorrido = recorridoInstalaciones.map((identidad, indice) =>
    serializarIdentidad(
      identidad,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      `recorridoInstalaciones[${indice}]`
    ));
  if (new Set(recorrido).size !== recorrido.length) {
    fallar(
      'recorrido_con_instalacion_repetida',
      'El recorrido no puede contener una instalacion visitada mas de una vez.',
      'recorridoInstalaciones'
    );
  }
  return Object.freeze(recorrido);
}

function normalizarScopeOrigenDeclarado(scope) {
  try {
    return esScopeFederacion(scope)
      ? scope.toJSON()
      : crearScopeFederacion(scope).toJSON();
  } catch {
    fallar(
      'scope_origen_invalido',
      'scopeOrigenDeclarado debe usar la jerarquia organizativa contractual.',
      'scopeOrigenDeclarado'
    );
  }
}

function normalizarTiemposSaltos({
  tiemposSaltosDisponibles,
  recorrido,
  installationEmisoraSerializada,
  bootEmisorSerializado
}) {
  exigirListaDensaDatos(
    tiemposSaltosDisponibles,
    'tiempos_saltos_invalidos',
    'Los tiempos disponibles de saltos deben formar una lista densa.',
    'tiemposSaltosDisponibles'
  );
  const posicionRecorrido = new Map(
    recorrido.map((installationId, indice) => [installationId, indice])
  );
  const instalacionesConTiempo = new Set();
  const saltos = tiemposSaltosDisponibles.map((salto, indice) => {
    const campo = `tiemposSaltosDisponibles[${indice}]`;
    if (!salto || typeof salto !== 'object' || Array.isArray(salto)) {
      fallar('salto_invalido', `${campo} debe ser un objeto.`, campo);
    }
    exigirClavesExactas(
      salto,
      ['bootId', 'emitidoUtc', 'installationId', 'recibidoUtc'],
      campo
    );
    const installationId = serializarIdentidad(
      salto.installationId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      `${campo}.installationId`
    );
    if (!recorrido.includes(installationId)) {
      fallar(
        'salto_fuera_recorrido',
        `${campo} no pertenece al recorrido conocido.`,
        campo
      );
    }
    if (instalacionesConTiempo.has(installationId)) {
      fallar('salto_duplicado', `${campo} duplica una instalación.`, campo);
    }
    instalacionesConTiempo.add(installationId);
    const bootId = salto.bootId === null
      ? null
      : serializarIdentidad(
        salto.bootId,
        TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
        `${campo}.bootId`
      );
    if (
      installationId === installationEmisoraSerializada &&
      bootId !== bootEmisorSerializado
    ) {
      fallar(
        'boot_emisor_incoherente',
        'El boot conocido del emisor inmediato no coincide con la envolvente.',
        `${campo}.bootId`
      );
    }
    const recibidoUtc = salto.recibidoUtc === null
      ? null
      : exigirFechaUtc(salto.recibidoUtc, `${campo}.recibidoUtc`);
    const emitidoUtc = salto.emitidoUtc === null
      ? null
      : exigirFechaUtc(salto.emitidoUtc, `${campo}.emitidoUtc`);
    if (
      recibidoUtc !== null &&
      emitidoUtc !== null &&
      Date.parse(emitidoUtc) < Date.parse(recibidoUtc)
    ) {
      fallar(
        'cronologia_salto_invalida',
        'Un salto no puede emitirse antes de haberse recibido.',
        campo
      );
    }
    return {
      installationId,
      bootId,
      recibidoUtc,
      emitidoUtc
    };
  });
  saltos.sort((saltoA, saltoB) =>
    posicionRecorrido.get(saltoA.installationId) -
    posicionRecorrido.get(saltoB.installationId));
  return normalizarJsonFederacion(saltos);
}

function exigirVersionProtocolo(version) {
  if (version !== VERSION_PROTOCOLO_FEDERACION) {
    fallar(
      'version_protocolo_incompatible',
      'La primera beta exige coincidencia exacta de versión de protocolo.',
      'protocoloVersion'
    );
  }
}

function exigirVersionFamilia(familia, version) {
  if (version !== VERSIONES_FAMILIA_FEDERACION[familia]) {
    fallar(
      'version_familia_incompatible',
      `La familia ${familia} no admite esa versión contractual.`,
      'familiaVersion'
    );
  }
}

function serializarIdentidad(identidad, tipo, campo) {
  return exigirIdentidadFederada(identidad, { tipo, campo }).serializar();
}

function exigirFechaUtc(valor, campo) {
  if (
    typeof valor !== 'string' ||
    !PATRON_FECHA_UTC_MILISEGUNDOS.test(valor) ||
    !Number.isFinite(Date.parse(valor)) ||
    new Date(Date.parse(valor)).toISOString() !== valor
  ) {
    fallar(
      'fecha_utc_invalida',
      `${campo} debe usar UTC canónico con milisegundos.`,
      campo
    );
  }
  return valor;
}

function exigirEnteroDecimal(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_ENTERO_DECIMAL.test(valor)) {
    fallar(
      'entero_decimal_invalido',
      `${campo} debe ser un entero decimal canónico no negativo.`,
      campo
    );
  }
  return valor;
}

function exigirEnteroDecimalPositivo(valor, campo) {
  const normalizado = exigirEnteroDecimal(valor, campo);
  if (normalizado === '0') {
    fallar(
      'entero_decimal_positivo_requerido',
      `${campo} debe ser un entero decimal canónico positivo.`,
      campo
    );
  }
  return normalizado;
}

function exigirObjetoJson(valor, campo) {
  const normalizado = normalizarJsonFederacion(valor);
  exigirObjetoPlanoNormalizado(normalizado, campo);
  return normalizado;
}

function exigirArrayJson(valor, campo) {
  const normalizado = normalizarJsonFederacion(valor);
  if (!Array.isArray(normalizado)) {
    fallar('array_json_requerido', `${campo} debe ser una lista JSON.`, campo);
  }
  return normalizado;
}

function exigirListaDensaDatos(valor, codigo, mensaje, campo) {
  if (!Array.isArray(valor)) fallar(codigo, mensaje, campo);
  const claves = Reflect.ownKeys(valor);
  if (claves.some((clave) =>
    clave !== 'length' &&
    !(
      typeof clave === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(clave) &&
      Number(clave) < valor.length
    ))) {
    fallar(codigo, mensaje, campo);
  }
  for (let indice = 0; indice < valor.length; indice += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(valor, String(indice));
    if (!descriptor || descriptor.enumerable !== true || !('value' in descriptor)) {
      fallar(codigo, mensaje, campo);
    }
  }
}

function exigirObjetoPlanoNormalizado(valor, campo) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    fallar('objeto_json_requerido', `${campo} debe ser un objeto JSON.`, campo);
  }
}

function exigirClavesExactas(valor, esperadas, campo) {
  const clavesPropias = Reflect.ownKeys(valor);
  if (clavesPropias.some((clave) => typeof clave !== 'string')) {
    fallar(
      'forma_contractual_invalida',
      `${campo} contiene claves no representables en su contrato.`,
      campo
    );
  }
  for (const clave of clavesPropias) {
    const descriptor = Object.getOwnPropertyDescriptor(valor, clave);
    if (!descriptor || descriptor.enumerable !== true || !('value' in descriptor)) {
      fallar(
        'forma_contractual_invalida',
        `${campo} debe contener únicamente propiedades enumerables de datos.`,
        campo
      );
    }
  }
  const observadas = clavesPropias.sort();
  const requeridas = [...esperadas].sort();
  if (
    observadas.length !== requeridas.length ||
    observadas.some((clave, indice) => clave !== requeridas[indice])
  ) {
    fallar(
      'forma_contractual_invalida',
      `${campo} no coincide con su forma contractual cerrada.`,
      campo
    );
  }
}

function exigirInstancia(valor, marca, codigo, campo) {
  if (!marca.has(valor)) {
    fallar(codigo, `${campo} no es un value object federado válido.`, campo);
  }
}

function fallar(codigo, mensaje, campo) {
  throw new ErrorEnvolventeFederacion(codigo, mensaje, { campo });
}
