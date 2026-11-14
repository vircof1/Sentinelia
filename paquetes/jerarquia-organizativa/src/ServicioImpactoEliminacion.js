import {
  ETIQUETAS_TABLAS_SCOPE_ORGANIZATIVO,
  resolverMetadatosTablaScopeOrganizativo,
  tablaTieneEmpresaId,
  tablaTieneSitioId,
  tablaTieneTenantId
} from './CatalogoScopeOrganizativo.js';

const ETIQUETAS_TABLAS = {
  tenants: 'Tenants',
  ...ETIQUETAS_TABLAS_SCOPE_ORGANIZATIVO,
  estado_actual_monitores: 'Estado actual de monitores',
  asignaciones_triggers_monitores: 'Vinculos trigger-monitor',
};

export class ServicioImpactoEliminacion {
  constructor({ clienteSql }) {
    this.clienteSql = clienteSql;
    this.cacheMetadatos = null;
  }

  async evaluar({ tablaRaiz, idRaiz, origen = null }) {
    return this.#evaluar({ tablaRaiz, idRaiz, origen });
  }

  async evaluarEnTransaccion(
    { tablaRaiz, idRaiz, origen = null },
    { conexion } = {}
  ) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('El impacto transaccional exige una conexión prestada.');
    }
    return this.#evaluar({
      tablaRaiz, idRaiz, origen, conexion, bloquear: true
    });
  }

  async #evaluar({
    tablaRaiz,
    idRaiz,
    origen = null,
    conexion = null,
    bloquear = false
  }) {
    const metadatos = await this.cargarMetadatos();
    const filaRaiz = await this.buscarFilaPorId(tablaRaiz, idRaiz, {
      conexion,
      bloquear
    });

    if (!filaRaiz) {
      throw new Error(`No existe el registro raiz solicitado en ${tablaRaiz}.`);
    }

    const visitadosEliminacion = new Set();
    const eliminacionesEnCascada = new Map();
    const referenciasDesacopladas = new Map();
    const bloqueosPotenciales = new Map();

    await this.recorrerImpacto({
      tablaActual: tablaRaiz,
      filaActual: filaRaiz,
      metadatos,
      visitadosEliminacion,
      eliminacionesEnCascada,
      referenciasDesacopladas,
      bloqueosPotenciales,
      conexion,
      bloquear
    });

    const impactoPrimerNivel = await this.calcularImpactoPrimerNivel(
      tablaRaiz,
      filaRaiz,
      metadatos,
      { conexion, bloquear }
    );

    this.depurarBucketsContraEliminaciones(
      referenciasDesacopladas,
      eliminacionesEnCascada
    );
    this.depurarBucketsContraEliminaciones(
      bloqueosPotenciales,
      eliminacionesEnCascada
    );

    const filasEliminadas = this.serializarBuckets(eliminacionesEnCascada);
    const filasDesacopladas = this.serializarBuckets(referenciasDesacopladas);
    const filasBloqueadas = this.serializarBuckets(bloqueosPotenciales);

    const totalIncluyendoRaiz =
      filasEliminadas.reduce((total, item) => total + item.total, 0);
    const totalDependencias = Math.max(totalIncluyendoRaiz - 1, 0);

    return {
      origen: {
        tabla: tablaRaiz,
        id: Number(idRaiz),
        etiquetaTabla: this.resolverEtiquetaTabla(tablaRaiz),
        nombre: this.resolverNombreFila(filaRaiz),
        descripcion:
          origen?.descripcion ||
          `${this.resolverEtiquetaTabla(tablaRaiz)} ${this.resolverNombreFila(filaRaiz)}`
      },
      resumen: {
        totalDependencias,
        totalIncluyendoRaiz,
        totalEliminacionesEnCascada: totalDependencias,
        totalReferenciasDesacopladas:
          filasDesacopladas.reduce((total, item) => total + item.total, 0),
        totalBloqueosPotenciales:
          filasBloqueadas.reduce((total, item) => total + item.total, 0)
      },
      impactoPrimerNivel,
      eliminacionesEnCascada: filasEliminadas.filter(
        (item) => item.tabla !== tablaRaiz
      ),
      referenciasDesacopladas: filasDesacopladas,
      bloqueosPotenciales: filasBloqueadas
    };
  }

  async recorrerImpacto({
    tablaActual,
    filaActual,
    metadatos,
    visitadosEliminacion,
    eliminacionesEnCascada,
    referenciasDesacopladas,
    bloqueosPotenciales,
    conexion,
    bloquear
  }) {
    const identidadActual = this.construirIdentidadFila(
      tablaActual,
      filaActual,
      metadatos.primaryKeysByTable
    );

    if (visitadosEliminacion.has(identidadActual)) {
      return;
    }

    visitadosEliminacion.add(identidadActual);
    this.registrarFila(
      eliminacionesEnCascada,
      tablaActual,
      filaActual,
      identidadActual
    );

    const relaciones =
      metadatos.relacionesPorPadre.get(tablaActual) || [];

    for (const relacion of relaciones) {
      const filasRelacionadas = await this.buscarFilasRelacionadas(
        relacion,
        filaActual,
        { conexion, bloquear }
      );

      if (filasRelacionadas.length === 0) {
        continue;
      }

      if (relacion.deleteRule === 'CASCADE') {
        for (const filaHija of filasRelacionadas) {
          await this.recorrerImpacto({
            tablaActual: relacion.childTable,
            filaActual: filaHija,
            metadatos,
            visitadosEliminacion,
            eliminacionesEnCascada,
            referenciasDesacopladas,
            bloqueosPotenciales,
            conexion,
            bloquear
          });
        }

        continue;
      }

      const registroDestino =
        relacion.deleteRule === 'SET NULL'
          ? referenciasDesacopladas
          : bloqueosPotenciales;

      for (const filaHija of filasRelacionadas) {
        const identidadHija = this.construirIdentidadFila(
          relacion.childTable,
          filaHija,
          metadatos.primaryKeysByTable
        );

        this.registrarFila(
          registroDestino,
          relacion.childTable,
          filaHija,
          identidadHija,
          {
            deleteRule: relacion.deleteRule
          }
        );
      }
    }
  }

  async calcularImpactoPrimerNivel(
    tablaRaiz,
    filaRaiz,
    metadatos,
    { conexion = null, bloquear = false } = {}
  ) {
    const relaciones =
      metadatos.relacionesPorPadre.get(tablaRaiz) || [];
    const buckets = new Map();

    for (const relacion of relaciones) {
      const filasRelacionadas = await this.buscarFilasRelacionadas(
        relacion,
        filaRaiz,
        { conexion, bloquear }
      );

      for (const filaHija of filasRelacionadas) {
        const identidad = this.construirIdentidadFila(
          relacion.childTable,
          filaHija,
          metadatos.primaryKeysByTable
        );
        const clave = `${relacion.deleteRule}:${relacion.childTable}`;
        const actual = buckets.get(clave) || {
          tabla: relacion.childTable,
          etiquetaTabla: this.resolverEtiquetaTabla(relacion.childTable),
          ...this.construirMetaScopeTabla(relacion.childTable),
          regla: relacion.deleteRule,
          total: 0,
          identidades: new Set()
        };

        if (actual.identidades.has(identidad)) {
          continue;
        }

        actual.identidades.add(identidad);
        actual.total += 1;
        buckets.set(clave, actual);
      }
    }

    return Array.from(buckets.values())
      .map(({ identidades, ...resto }) => resto)
      .sort((a, b) => {
        if (a.regla !== b.regla) {
          return a.regla.localeCompare(b.regla, 'es');
        }

        return a.etiquetaTabla.localeCompare(b.etiquetaTabla, 'es');
      });
  }

  async cargarMetadatos() {
    if (this.cacheMetadatos) {
      return this.cacheMetadatos;
    }

    const [primaryKeys, relaciones] = await Promise.all([
      this.clienteSql.consultar(`
        SELECT
          TABLE_NAME AS table_name,
          COLUMN_NAME AS column_name,
          ORDINAL_POSITION AS ordinal_position
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC
      `),
      this.clienteSql.consultar(`
        SELECT
          kcu.CONSTRAINT_NAME AS constraint_name,
          kcu.TABLE_NAME AS child_table,
          kcu.COLUMN_NAME AS child_column,
          kcu.REFERENCED_TABLE_NAME AS parent_table,
          kcu.REFERENCED_COLUMN_NAME AS parent_column,
          COALESCE(
            kcu.POSITION_IN_UNIQUE_CONSTRAINT,
            kcu.ORDINAL_POSITION
          ) AS position_in_fk,
          rc.DELETE_RULE AS delete_rule
        FROM information_schema.KEY_COLUMN_USAGE kcu
        INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
         AND rc.TABLE_NAME = kcu.TABLE_NAME
         AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY
          kcu.REFERENCED_TABLE_NAME ASC,
          kcu.TABLE_NAME ASC,
          kcu.CONSTRAINT_NAME ASC,
          position_in_fk ASC
      `)
    ]);

    const primaryKeysByTable = new Map();
    for (const fila of primaryKeys) {
      const tabla = fila.table_name;
      const columnas = primaryKeysByTable.get(tabla) || [];
      columnas.push(fila.column_name);
      primaryKeysByTable.set(tabla, columnas);
    }

    const relacionesPorPadre = new Map();
    const gruposRelaciones = new Map();

    for (const fila of relaciones) {
      const clave = [
        fila.parent_table,
        fila.child_table,
        fila.constraint_name
      ].join(':');
      const actual = gruposRelaciones.get(clave) || {
        constraintName: fila.constraint_name,
        parentTable: fila.parent_table,
        childTable: fila.child_table,
        deleteRule: String(fila.delete_rule || 'RESTRICT').toUpperCase(),
        mappings: []
      };

      actual.mappings.push({
        childColumn: fila.child_column,
        parentColumn: fila.parent_column,
        position: Number(fila.position_in_fk || 0)
      });
      gruposRelaciones.set(clave, actual);
    }

    for (const relacion of gruposRelaciones.values()) {
      relacion.mappings.sort((a, b) => a.position - b.position);
      const lista = relacionesPorPadre.get(relacion.parentTable) || [];
      lista.push(relacion);
      relacionesPorPadre.set(relacion.parentTable, lista);
    }

    this.cacheMetadatos = {
      primaryKeysByTable,
      relacionesPorPadre
    };

    return this.cacheMetadatos;
  }

  async buscarFilaPorId(
    tabla,
    id,
    { conexion = null, bloquear = false } = {}
  ) {
    const nombreTabla = this.clienteSql.escaparIdentificador(tabla);
    const filas = await this.consultar(
      `
        SELECT *
        FROM ${nombreTabla}
        WHERE id = ?
        LIMIT 1
        ${bloquear ? 'FOR UPDATE' : ''}
      `,
      [id],
      conexion
    );

    return filas[0] || null;
  }

  async buscarFilasRelacionadas(
    relacion,
    filaPadre,
    { conexion = null, bloquear = false } = {}
  ) {
    const filtros = relacion.mappings.map((mapping) => ({
      childColumn: mapping.childColumn,
      valor: filaPadre[mapping.parentColumn]
    }));

    if (filtros.some((filtro) => typeof filtro.valor === 'undefined')) {
      return [];
    }

    const nombreTabla = this.clienteSql.escaparIdentificador(
      relacion.childTable
    );
    const clausulas = [];
    const parametros = [];

    for (const filtro of filtros) {
      const columna = this.clienteSql.escaparIdentificador(
        filtro.childColumn
      );

      if (filtro.valor === null) {
        clausulas.push(`${columna} IS NULL`);
        continue;
      }

      clausulas.push(`${columna} = ?`);
      parametros.push(filtro.valor);
    }

    return this.consultar(
      `
        SELECT *
        FROM ${nombreTabla}
        WHERE ${clausulas.join(' AND ')}
        ${bloquear ? 'FOR UPDATE' : ''}
      `,
      parametros,
      conexion
    );
  }

  async consultar(sql, parametros, conexion) {
    if (!conexion) return this.clienteSql.consultar(sql, parametros);
    const [filas] = await conexion.execute(sql, parametros);
    return filas;
  }

  construirIdentidadFila(tabla, fila, primaryKeysByTable) {
    const columnasPk = primaryKeysByTable.get(tabla) || [];

    if (columnasPk.length === 0) {
      return `${tabla}:${JSON.stringify(fila)}`;
    }

    const valores = columnasPk.map((columna) => String(fila[columna]));
    return `${tabla}:${valores.join('|')}`;
  }

  registrarFila(buckets, tabla, fila, identidad, extras = {}) {
    const actual = buckets.get(tabla) || {
      tabla,
      etiquetaTabla: this.resolverEtiquetaTabla(tabla),
      ...this.construirMetaScopeTabla(tabla),
      total: 0,
      identidades: new Set(),
      ...extras
    };

    if (actual.identidades.has(identidad)) {
      return;
    }

    actual.identidades.add(identidad);
    actual.total += 1;
    buckets.set(tabla, actual);
  }

  serializarBuckets(buckets) {
    return Array.from(buckets.values())
      .map(({ identidades, ...resto }) => resto)
      .sort((a, b) => {
        if (b.total !== a.total) {
          return b.total - a.total;
        }

        return a.etiquetaTabla.localeCompare(b.etiquetaTabla, 'es');
      });
  }

  depurarBucketsContraEliminaciones(bucketsSecundarios, bucketsEliminacion) {
    for (const [tabla, bucketSecundario] of bucketsSecundarios.entries()) {
      const bucketEliminacion = bucketsEliminacion.get(tabla);

      if (!bucketEliminacion) {
        continue;
      }

      for (const identidad of bucketEliminacion.identidades) {
        if (!bucketSecundario.identidades.has(identidad)) {
          continue;
        }

        bucketSecundario.identidades.delete(identidad);
        bucketSecundario.total = Math.max(bucketSecundario.total - 1, 0);
      }

      if (bucketSecundario.total === 0) {
        bucketsSecundarios.delete(tabla);
      }
    }
  }

  resolverEtiquetaTabla(tabla) {
    return ETIQUETAS_TABLAS[tabla] || tabla.replaceAll('_', ' ');
  }

  construirMetaScopeTabla(tabla) {
    const metadatos = resolverMetadatosTablaScopeOrganizativo(tabla);

    return {
      categoriaDatos: metadatos?.categoriaDatos || null,
      columnasScope: Array.isArray(metadatos?.columnasScope)
        ? [...metadatos.columnasScope]
        : [],
      actualizableEnCambioTenantEmpresa:
        metadatos?.actualizableEnCambioTenantEmpresa ?? null,
      tieneTenantId: tablaTieneTenantId(tabla),
      tieneEmpresaId: tablaTieneEmpresaId(tabla),
      tieneSitioId: tablaTieneSitioId(tabla)
    };
  }

  resolverNombreFila(fila) {
    if (!fila || typeof fila !== 'object') {
      return 'registro';
    }

    if (fila.nombre) {
      return String(fila.nombre);
    }

    if (fila.usuario) {
      return String(fila.usuario);
    }

    if (fila.alias) {
      return String(fila.alias);
    }

    if (fila.id) {
      return `#${fila.id}`;
    }

    return 'registro';
  }
}
