const congelar = (valor) => {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelar(hijo);
  }
  return valor;
};

export const VERSION_CATALOGO_AVISOS_PLATAFORMA = 1;
export const VERSION_CAUSA_INCOMPATIBILIDAD_FEDERACION = 2;
export const VERSION_CAUSA_ESTADO_REMOTO_VENCIDO = 3;

export const ESTADOS_CICLO_AVISO_PLATAFORMA = congelar([
  'pendiente',
  'resuelto',
  'obsoleto'
]);

export const GRAVEDADES_AVISO_PLATAFORMA = congelar([
  'informativa',
  'advertencia',
  'critica'
]);

export const TRANSICIONES_AVISO_PLATAFORMA = congelar([
  'apertura',
  'confirmacion_tecnica',
  'actualizacion',
  'escalado',
  'desescalado',
  'resolucion',
  'obsolescencia',
  'reapertura'
]);

export const CAUSAS_AVISO_PLATAFORMA = congelar([
  causa('comunicacion', 'relacion_silenciosa', 'advertencia', false),
  causa('tiempo', 'desfase_temporal_fuera_tolerancia', 'advertencia', false),
  causa('identidad', 'sospecha_identidad_instalacion', 'advertencia', false),
  causa('identidad', 'conflicto_identidad_instalacion', 'critica', false),
  causa('consistencia', 'divergencia_ocurrencia', 'critica', false),
  causa('consistencia', 'recuperacion_password_convergencia_redis',
    'advertencia', false),
  causa('dependencia', 'dependencia_local_retirada', 'advertencia', false),
  causa('dependencia', 'dependencia_local_incompleta', 'advertencia', false),
  causa('generacion', 'generacion_degradada', 'advertencia', false),
  causa('generacion', 'hueco_irrecuperable', 'critica', false),
  causa('capacidad', 'saturacion_prolongada', 'advertencia', false),
  causa('autoridad', 'perdida_autoridad_responsable', 'critica', true),
  causa('compatibilidad', 'version_federada_incompatible', 'advertencia', false,
    VERSION_CAUSA_INCOMPATIBILIDAD_FEDERACION),
  causa('tiempo', 'estado_remoto_vencido', 'advertencia', false,
    VERSION_CAUSA_ESTADO_REMOTO_VENCIDO)
]);

const CAUSAS_POR_CLAVE = new Map(
  CAUSAS_AVISO_PLATAFORMA.map((definicion) => [
    claveCausa(
      definicion.versionCatalogo,
      definicion.tipoCodigo,
      definicion.causaCodigo
    ),
    definicion
  ])
);

export function obtenerCausaAvisoPlataforma({
  tipoCodigo,
  causaCodigo,
  versionCatalogo = VERSION_CATALOGO_AVISOS_PLATAFORMA
} = {}) {
  return CAUSAS_POR_CLAVE.get(
    claveCausa(versionCatalogo, tipoCodigo, causaCodigo)
  ) || null;
}

function causa(
  tipoCodigo,
  causaCodigo,
  gravedadInicial,
  admiteResolucionAdministrativa,
  versionCatalogo = VERSION_CATALOGO_AVISOS_PLATAFORMA
) {
  return {
    versionCatalogo,
    tipoCodigo,
    causaCodigo,
    gravedadInicial,
    admiteResolucionAdministrativa
  };
}

function claveCausa(versionCatalogo, tipoCodigo, causaCodigo) {
  return `${String(versionCatalogo || '')}\u0000${String(tipoCodigo || '')}\u0000${String(causaCodigo || '')}`;
}
