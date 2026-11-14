export const VERSION_DETALLE_CAMBIOS_AUDITORIA = 1;

export function proyectarDetalleCambiosAuditoria({
  evento,
  alcanceCompleto = false
} = {}) {
  if (!alcanceCompleto || Number(evento?.versionContrato) !== 1) return null;
  const payload = evento?.payload;
  if (!esObjetoPlano(payload)) return null;

  if (Array.isArray(payload.camposCambiados)) {
    return proyectarCambio(payload);
  }
  if (
    typeof payload.estadoAntes === 'string' &&
    typeof payload.estadoDespues === 'string'
  ) {
    return construirDetalle('estado', [{
      campo: 'estado',
      antes: payload.estadoAntes,
      despues: payload.estadoDespues
    }]);
  }
  if (payload.antes === null && esObjetoPlano(payload.despues)) {
    return proyectarFotografia('alta', null, payload.despues);
  }
  if (esObjetoPlano(payload.antes) && payload.despues === null) {
    return proyectarFotografia('eliminacion', payload.antes, null);
  }
  return null;
}

function proyectarCambio(payload) {
  if (!esObjetoPlano(payload.antes) || !esObjetoPlano(payload.despues)) return null;
  const cambios = [];
  for (const campo of payload.camposCambiados) {
    if (
      typeof campo !== 'string' ||
      !Object.hasOwn(payload.antes, campo) ||
      !Object.hasOwn(payload.despues, campo)
    ) continue;
    cambios.push({
      campo,
      antes: clonarJson(payload.antes[campo]),
      despues: clonarJson(payload.despues[campo])
    });
  }
  return construirDetalle('cambio', cambios);
}

function proyectarFotografia(clase, antes, despues) {
  const campos = [...new Set([
    ...Object.keys(antes || {}),
    ...Object.keys(despues || {})
  ])].sort(compararUtf8);
  return construirDetalle(clase, campos.map((campo) => ({
    campo,
    antes: antes === null ? null : clonarJson(antes[campo]),
    despues: despues === null ? null : clonarJson(despues[campo])
  })));
}

function construirDetalle(clase, cambios) {
  if (cambios.length === 0) return null;
  const detalle = {
    version: VERSION_DETALLE_CAMBIOS_AUDITORIA,
    clase,
    cambios
  };
  congelarProfundo(detalle);
  return detalle;
}

function clonarJson(valor) {
  if (valor === undefined) return null;
  if (valor === null || typeof valor !== 'object') return valor;
  return JSON.parse(JSON.stringify(valor));
}

function esObjetoPlano(valor) {
  return valor !== null &&
    typeof valor === 'object' &&
    !Array.isArray(valor) &&
    Object.getPrototypeOf(valor) === Object.prototype;
}

function compararUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function congelarProfundo(valor) {
  if (!valor || typeof valor !== 'object' || Object.isFrozen(valor)) return;
  for (const hijo of Object.values(valor)) congelarProfundo(hijo);
  Object.freeze(valor);
}
