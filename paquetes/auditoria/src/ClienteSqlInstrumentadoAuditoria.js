export class ClienteSqlInstrumentadoAuditoria {
  constructor({ clienteSql } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('ClienteSqlInstrumentadoAuditoria requiere un cliente SQL compatible.');
    }
    this.clienteSql = clienteSql;
    this.trazas = [];
    this.secuencia = 0;
  }

  async obtenerConexion() {
    const conexion = await this.clienteSql.obtenerConexion();
    return new Proxy(conexion, {
      get: (objetivo, propiedad) => {
        if (propiedad === 'execute' || propiedad === 'query') {
          return (sql, parametros = []) => this.#registrar({
            operacion: propiedad,
            sql,
            parametros,
            ejecutar: () => objetivo[propiedad].call(objetivo, sql, parametros)
          });
        }
        const valor = Reflect.get(objetivo, propiedad, objetivo);
        return typeof valor === 'function' ? valor.bind(objetivo) : valor;
      },
      set: (objetivo, propiedad, valor) => Reflect.set(objetivo, propiedad, valor, objetivo)
    });
  }

  async ejecutar(sql, parametros = []) {
    const conexion = await this.obtenerConexion();
    try {
      return await conexion.execute(sql, parametros);
    } finally {
      conexion.release();
    }
  }

  async consultar(sql, parametros = []) {
    const [filas] = await this.ejecutar(sql, parametros);
    return filas;
  }

  obtenerTrazas() {
    return Object.freeze(this.trazas.map((traza) => congelar(clonarTraza(traza))));
  }

  obtenerResumen() {
    const porTipoSql = {};
    for (const traza of this.trazas) {
      porTipoSql[traza.tipoSql] = (porTipoSql[traza.tipoSql] || 0) + 1;
    }
    return congelar({
      total: this.trazas.length,
      correctas: this.trazas.filter((traza) => traza.ok).length,
      fallidas: this.trazas.filter((traza) => !traza.ok).length,
      porTipoSql
    });
  }

  reiniciar() {
    this.trazas.length = 0;
    this.secuencia = 0;
  }

  async cerrar() {
    if (typeof this.clienteSql.cerrar === 'function') {
      await this.clienteSql.cerrar();
    }
  }

  async #registrar({ operacion, sql, parametros, ejecutar }) {
    const iniciadaNs = process.hrtime.bigint();
    const base = {
      id: ++this.secuencia,
      operacion,
      tipoSql: tipoSentencia(sql),
      sql: String(sql),
      sqlNormalizado: String(sql).replace(/\s+/g, ' ').trim(),
      parametros: clonarParametros(parametros)
    };
    try {
      const resultado = await ejecutar();
      this.trazas.push({
        ...base,
        ok: true,
        duracionMs: duracionMs(iniciadaNs),
        filas: estimarFilas(resultado),
        codigoError: null
      });
      return resultado;
    } catch (error) {
      this.trazas.push({
        ...base,
        ok: false,
        duracionMs: duracionMs(iniciadaNs),
        filas: null,
        codigoError: error?.code == null ? null : String(error.code)
      });
      throw error;
    }
  }
}

function tipoSentencia(sql) {
  const normalizado = String(sql).trim().toUpperCase();
  if (normalizado.startsWith('WITH ')) return 'SELECT';
  return normalizado.match(/^[A-Z]+/)?.[0] || 'DESCONOCIDA';
}

function estimarFilas(resultado) {
  const principal = Array.isArray(resultado) ? resultado[0] : resultado;
  if (Array.isArray(principal)) return principal.length;
  if (principal && Number.isInteger(Number(principal.affectedRows))) {
    return Number(principal.affectedRows);
  }
  return null;
}

function duracionMs(iniciadaNs) {
  return Number(process.hrtime.bigint() - iniciadaNs) / 1_000_000;
}

function clonarParametros(parametros) {
  if (!Array.isArray(parametros)) return [];
  return parametros.map((valor) => {
    if (Buffer.isBuffer(valor)) return Buffer.from(valor);
    if (valor instanceof Date) return new Date(valor.getTime());
    if (valor && typeof valor === 'object') return structuredClone(valor);
    return valor;
  });
}

function clonarTraza(traza) {
  return {
    ...traza,
    parametros: clonarParametros(traza.parametros)
  };
}

function congelar(valor) {
  if (ArrayBuffer.isView(valor)) return valor;
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelar(hijo);
  }
  return valor;
}
