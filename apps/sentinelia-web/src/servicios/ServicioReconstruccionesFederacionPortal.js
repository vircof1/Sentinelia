export class ServicioReconstruccionesFederacionPortal {
  constructor({ clienteSql, servicioReconstrucciones, servicioAutorizacion } = {}) {
    if (typeof clienteSql?.consultar !== 'function' ||
        typeof servicioReconstrucciones?.listar !== 'function' ||
        typeof servicioReconstrucciones?.decidir !== 'function' ||
        typeof servicioReconstrucciones?.cancelar !== 'function' ||
        typeof servicioReconstrucciones?.promover !== 'function' ||
        typeof servicioReconstrucciones?.revalidar !== 'function') {
      throw new Error('La administración visual de reconstrucciones necesita SQL y dominio cerrados.');
    }
    this.clienteSql = clienteSql;
    this.servicioReconstrucciones = servicioReconstrucciones;
    this.servicioAutorizacion = servicioAutorizacion;
  }

  async obtener(contextoUsuarioActual) {
    const flujos = await this.#listarFlujosVisibles(contextoUsuarioActual);
    const agregados = await Promise.all(flujos.map(async (resumen) => {
      const agregado = await this.servicioReconstrucciones.listar(resumen.flujoId);
      return Object.freeze({
        ...agregado,
        nombreInstalacionRemota: resumen.nombreInstalacionRemota,
        installationRemotaId: resumen.installationRemotaId,
        puedeDecidir: this.#puedeDecidir(contextoUsuarioActual, agregado.flujo.direccion)
      });
    }));
    return Object.freeze({
      flujos: Object.freeze(agregados),
      totalFlujos: agregados.length,
      totalCandidatas: agregados.reduce(
        (total, agregado) => total + agregado.candidatas.length,
        0
      )
    });
  }

  decidir(contextoUsuarioActual, entrada = {}) {
    return this.#ejecutarVisible(contextoUsuarioActual, entrada.flujoId, () =>
      this.servicioReconstrucciones.decidir({
        flujoId: entrada.flujoId,
        estrategia: entrada.estrategia,
        generacionObjetivoId: entrada.generacionObjetivoId || null,
        motivo: normalizarMotivo(entrada.motivo),
        contextoUsuarioActual
      })
    );
  }

  cancelar(contextoUsuarioActual, entrada = {}) {
    return this.#ejecutarVisible(contextoUsuarioActual, entrada.flujoId, () =>
      this.servicioReconstrucciones.cancelar({
        flujoId: entrada.flujoId,
        generacionId: entrada.generacionId,
        motivo: normalizarMotivo(entrada.motivo),
        contextoUsuarioActual
      })
    );
  }

  promover(contextoUsuarioActual, entrada = {}) {
    return this.#ejecutarVisible(contextoUsuarioActual, entrada.flujoId, () =>
      this.servicioReconstrucciones.promover({
        flujoId: entrada.flujoId,
        generacionId: entrada.generacionId,
        motivo: normalizarMotivo(entrada.motivo),
        contextoUsuarioActual
      })
    );
  }

  revalidar(contextoUsuarioActual, entrada = {}) {
    return this.#ejecutarVisible(contextoUsuarioActual, entrada.flujoId, () =>
      this.servicioReconstrucciones.revalidar({
        flujoId: entrada.flujoId,
        generacionId: entrada.generacionId,
        motivo: normalizarMotivo(entrada.motivo),
        contextoUsuarioActual
      })
    );
  }

  async #ejecutarVisible(contexto, flujoId, operacion) {
    const visibles = await this.#listarFlujosVisibles(contexto, flujoId);
    if (visibles.length !== 1 || !this.#puedeDecidir(contexto, visibles[0].direccion)) {
      const error = new Error('El flujo no es administrable con la autoridad actual.');
      error.statusCode = 403;
      throw error;
    }
    return operacion();
  }

  async #listarFlujosVisibles(contexto = {}, flujoId = null) {
    const puedeEmision = Boolean(
      this.servicioAutorizacion?.puedeConfigurarEmisionesFederacion?.(contexto)
    );
    const puedeRecepcion = Boolean(
      this.servicioAutorizacion?.puedeConfigurarRecepcionesFederacion?.(contexto)
    );
    if (!puedeEmision && !puedeRecepcion) return Object.freeze([]);
    const condiciones = [];
    const parametros = [];
    if (flujoId !== null) {
      condiciones.push('f.flujo_id=?');
      parametros.push(String(flujoId));
    }
    condiciones.push(`f.direccion IN (${[
      puedeEmision ? 'emision' : null,
      puedeRecepcion ? 'recepcion' : null
    ].filter(Boolean).map(() => '?').join(',')})`);
    if (puedeEmision) parametros.push('emision');
    if (puedeRecepcion) parametros.push('recepcion');
    aplicarScopeSql(condiciones, parametros, contexto);
    const filas = await this.clienteSql.consultar(
      `SELECT f.flujo_id,f.direccion,r.nombre_remoto_declarado,
              r.installation_remota_id
         FROM flujos_federacion f
         JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
         JOIN generaciones_flujos_federacion g
           ON g.flujo_id=f.flujo_id
          AND g.generacion_id=f.generacion_activa_id
         JOIN fronteras_generaciones_federacion b
           ON b.generacion_id=g.generacion_id
        WHERE ${condiciones.join(' AND ')}
          AND r.estado_ciclo='vinculada'
        ORDER BY f.direccion,f.familia,f.flujo_id`,
      parametros
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      flujoId: fila.flujo_id,
      direccion: fila.direccion,
      nombreInstalacionRemota: fila.nombre_remoto_declarado || null,
      installationRemotaId: fila.installation_remota_id || null
    })));
  }

  #puedeDecidir(contexto, direccion) {
    if (contexto?.impersonacionActiva) return false;
    return direccion === 'emision'
      ? Boolean(this.servicioAutorizacion?.puedeConfigurarEmisionesFederacion?.(contexto))
      : Boolean(this.servicioAutorizacion?.puedeConfigurarRecepcionesFederacion?.(contexto));
  }
}

function aplicarScopeSql(condiciones, parametros, contexto = {}) {
  const nivel = String(contexto.nivelScope || '');
  if (!['portal', 'tenant', 'empresa', 'sitio'].includes(nivel)) {
    throw errorScope('El nivel de scope actual no es válido para administrar reconstrucciones.');
  }
  if (nivel === 'portal') return;
  condiciones.push('f.scope_tenant_id=?');
  parametros.push(idScope(contexto.tenantId, 'tenantId'));
  if (nivel === 'tenant') return;
  condiciones.push('f.scope_empresa_id=?');
  parametros.push(idScope(contexto.empresaId, 'empresaId'));
  if (nivel === 'empresa') return;
  condiciones.push('f.scope_sitio_id=?');
  parametros.push(idScope(contexto.sitioId, 'sitioId'));
}

function idScope(valor, campo) {
  const id = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(id)) {
    throw errorScope(`El ${campo} actual no es válido para administrar reconstrucciones.`);
  }
  return id;
}

function errorScope(mensaje) {
  const error = new Error(mensaje);
  error.statusCode = 403;
  error.codigo = 'SCOPE_RECONSTRUCCION_INVALIDO';
  return error;
}

function normalizarMotivo(valor) {
  const motivo = String(valor || '').trim();
  if (!motivo || motivo.length > 500) {
    throw new Error('La decisión exige un motivo explícito de hasta 500 caracteres.');
  }
  return motivo;
}
