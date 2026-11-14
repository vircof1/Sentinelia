const ROLES_ACTOR = Object.freeze(['real', 'efectivo']);

export async function resolverCadenaFiltroAuditoriaSql({
  conexion,
  contextoUsuarioActual,
  filtros = {}
} = {}) {
  if (filtros.claveCadena == null) return filtros;
  if (!conexion?.execute) {
    throw new Error('La resolución de cadena requiere una conexión SQL explícita.');
  }
  const claveCadena = String(filtros.claveCadena);
  const scope = condicionScopeCadena(contextoUsuarioActual, 'c');
  const [filas] = await conexion.execute(
    `SELECT c.id
       FROM cadenas_auditoria c
      WHERE c.clave_cadena = ?
        AND ${scope.condicion}
      LIMIT 1`,
    [claveCadena, ...scope.parametros]
  );
  const { claveCadena: _omitida, ...resto } = filtros;
  return Object.freeze({
    ...resto,
    cadenaSolicitada: true,
    cadenaIdResuelta: filas[0]?.id ?? null
  });
}

export function construirCondicionesAvanzadasAuditoriaSql(filtros = {}) {
  const partes = [];
  const parametros = [];
  construirActor({ filtros, partes, parametros });

  if (filtros.modoActuacion != null) {
    partes.push('modo_actuacion = ?');
    parametros.push(filtros.modoActuacion);
  }
  if (filtros.origen != null) {
    partes.push('origen = ?');
    parametros.push(filtros.origen);
  }
  if (filtros.cadenaSolicitada === true) {
    if (filtros.cadenaIdResuelta == null) {
      partes.push('0 = 1');
    } else {
      validarIdCadena(filtros.cadenaIdResuelta);
      partes.push('cadena_id = ?');
      parametros.push(filtros.cadenaIdResuelta);
    }
  }

  const causalidadTipoPresente = filtros.causalidadTipo != null;
  const causalidadIdPresente = filtros.causalidadId != null;
  if (causalidadTipoPresente !== causalidadIdPresente) {
    throw new Error('Los filtros causalidadTipo y causalidadId deben aparecer juntos.');
  }
  if (causalidadTipoPresente) {
    partes.push('causalidad_tipo = ?');
    parametros.push(filtros.causalidadTipo);
    partes.push('causalidad_id = ?');
    parametros.push(filtros.causalidadId);
  }
  return Object.freeze({
    partes: Object.freeze(partes),
    parametros: Object.freeze(parametros)
  });
}

function construirActor({ filtros, partes, parametros }) {
  const campos = ['actorRol', 'actorTipo', 'actorId'];
  const presentes = campos.filter((campo) => filtros[campo] != null);
  if (presentes.length === 0) return;
  if (presentes.length !== campos.length) {
    throw new Error('Los filtros actorRol, actorTipo y actorId deben aparecer juntos.');
  }
  if (!ROLES_ACTOR.includes(filtros.actorRol)) {
    throw new Error('El filtro actorRol debe ser real o efectivo.');
  }
  if (filtros.actorRol === 'real') {
    partes.push('actor_real_tipo = ?');
    partes.push('actor_real_id = ?');
  } else {
    partes.push('actor_efectivo_tipo = ?');
    partes.push('actor_efectivo_id = ?');
  }
  parametros.push(filtros.actorTipo, filtros.actorId);
}

function condicionScopeCadena(contexto, alias) {
  const prefijo = alias ? `${alias}.` : '';
  if (contexto?.nivelScope === 'portal') {
    return { condicion: '1 = 1', parametros: [] };
  }
  if (
    ['tenant', 'empresa', 'sitio'].includes(contexto?.nivelScope) &&
    contexto?.tenantId != null
  ) {
    return {
      condicion: `${prefijo}tenant_id = ?`,
      parametros: [contexto.tenantId]
    };
  }
  return { condicion: '0 = 1', parametros: [] };
}

function validarIdCadena(valor) {
  const texto = String(valor);
  if (!/^[1-9][0-9]*$/.test(texto)) {
    throw new Error('La identidad interna de cadena no es válida.');
  }
}

export const __testablesFiltrosSqlConsultaAuditoria = Object.freeze({
  condicionScopeCadena
});
