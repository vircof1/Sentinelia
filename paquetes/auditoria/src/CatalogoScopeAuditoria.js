import {
  CATALOGO_TABLAS_SCOPE_ORGANIZATIVO,
  DENYLIST_TABLAS_SCOPE_ORGANIZATIVO,
  resolverClaseSemanticaScopeOrganizativo,
  resolverDisposicionFisicaScopeOrganizativo
} from '../../jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';

export const CATALOGO_SCOPE_FISICO_SEMANTICO = Object.freeze(
  CATALOGO_TABLAS_SCOPE_ORGANIZATIVO.map(({ tabla }) => {
    const fisica = resolverDisposicionFisicaScopeOrganizativo(tabla);
    return Object.freeze({
      tabla,
      claseSemantica: resolverClaseSemanticaScopeOrganizativo(tabla),
      categoria: fisica.clasificacion,
      disposicion: fisica.disposicion
    });
  })
);

export const TABLAS_PROTEGIDAS_SCOPE_AUDITORIA =
  DENYLIST_TABLAS_SCOPE_ORGANIZATIVO;

const POR_TABLA = new Map(
  CATALOGO_SCOPE_FISICO_SEMANTICO.map((definicion) => [
    definicion.tabla,
    definicion
  ])
);

export function resolverDisposicionTablaScope(tabla) {
  const nombre = String(tabla || '').trim();
  if (POR_TABLA.has(nombre)) {
    return POR_TABLA.get(nombre);
  }
  if (TABLAS_PROTEGIDAS_SCOPE_AUDITORIA.includes(nombre)) {
    return Object.freeze({
      tabla: nombre,
      claseSemantica: null,
      categoria: 'protegida',
      disposicion: 'persistencia_protegida'
    });
  }
  return null;
}

export function listarTablasScopeCatalogadas() {
  return [...POR_TABLA.keys()];
}

export function verificarCoberturaTablasScope(tablasConScope = []) {
  const sinDisposicion = [...new Set(tablasConScope)]
    .filter((tabla) => !resolverDisposicionTablaScope(tabla))
    .sort();
  if (sinDisposicion.length > 0) {
    throw new Error(
      `Tablas con scope sin disposición auditable: ${sinDisposicion.join(', ')}.`
    );
  }
  return Object.freeze({
    totalEsquema: new Set(tablasConScope).size,
    totalCatalogadas: CATALOGO_SCOPE_FISICO_SEMANTICO.length,
    sinDisposicion: Object.freeze([])
  });
}
