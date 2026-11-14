import { FronteraTransaccionalFederacion } from './FronteraTransaccionalFederacion.js';

export class ErrorReconciliacionFlujosFederacion extends Error {
  constructor(codigo, mensaje, { statusCode = 409 } = {}) {
    super(mensaje);
    this.name = 'ErrorReconciliacionFlujosFederacion';
    this.codigo = codigo;
    this.statusCode = statusCode;
  }
}

export class RepositorioReconciliacionFlujosFederacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La reconciliación de flujos requiere SQL operativo.');
    }
    this.frontera = new FronteraTransaccionalFederacion(clienteSql);
  }

  async cargarConcesionActual(relacionId, revisionEfectivaId) {
    return this.frontera.ejecutar(async (conexion) => {
      const [filas] = await conexion.execute(
        `SELECT r.relacion_id,r.direccion,r.installation_remota_id,
                r.estado_ciclo,r.estado_autoridad,r.estado_identidad,
                r.estado_compatibilidad,r.responsable_usuario_id,
                r.scope_tenant_id,r.scope_empresa_id,r.scope_sitio_id,
                u.activo AS responsable_activo,
                u.tenant_id AS responsable_tenant_id,
                u.empresa_id AS responsable_empresa_id,
                u.sitio_id AS responsable_sitio_id,
                u.permiso_configurar_emisiones_federacion,
                u.permiso_configurar_recepciones_federacion,
                e.revision_efectiva_actual_id,c.revision_oferta_id,
                c.revision_aceptacion_id,c.seleccion,c.estado
           FROM relaciones_federacion r
           LEFT JOIN usuarios u ON u.id=r.responsable_usuario_id
           JOIN estado_concesion_relaciones_federacion e
             ON e.relacion_id=r.relacion_id
           JOIN revisiones_concesion_federacion c
             ON c.revision_id=e.revision_efectiva_actual_id
          WHERE r.relacion_id=? FOR UPDATE`,
        [relacionId]
      );
      const fila = filas[0];
      if (!fila || (revisionEfectivaId != null &&
          fila.revision_efectiva_actual_id !== revisionEfectivaId)) {
        fallar('CONCESION_EFECTIVA_SUPERADA',
          'La concesión ya no es la efectiva actual de la relación.');
      }
      exigirAutoridadActual(fila);
      if (!['vigente', 'vacia'].includes(fila.estado)) {
        fallar('CONCESION_EFECTIVA_NO_VIGENTE',
          'La concesión efectiva ya no admite reconciliar altas.');
      }
      return hidratarConcesion(fila);
    });
  }

  async registrarPlan(plan) {
    return this.frontera.ejecutar(async (conexion) => {
      const ahora = await ahoraSql(conexion);
      const [estados] = await conexion.execute(
        `SELECT e.revision_efectiva_actual_id,r.direccion,r.estado_ciclo,
                r.estado_autoridad,r.estado_identidad,r.estado_compatibilidad,
                r.scope_tenant_id,r.scope_empresa_id,r.scope_sitio_id,
                u.activo AS responsable_activo,
                u.tenant_id AS responsable_tenant_id,
                u.empresa_id AS responsable_empresa_id,
                u.sitio_id AS responsable_sitio_id,
                u.permiso_configurar_emisiones_federacion,
                u.permiso_configurar_recepciones_federacion
           FROM estado_concesion_relaciones_federacion e
           JOIN relaciones_federacion r ON r.relacion_id=e.relacion_id
           LEFT JOIN usuarios u ON u.id=r.responsable_usuario_id
          WHERE e.relacion_id=? FOR UPDATE`, [plan.relacionId]
      );
      if (estados[0]?.revision_efectiva_actual_id !== plan.revisionEfectivaId) {
        fallar('CONCESION_EFECTIVA_SUPERADA',
          'La concesión cambió antes de registrar el plan de flujo.');
      }
      exigirAutoridadActual(estados[0]);
      if (estados[0].direccion !== plan.direccion) {
        fallar('DIRECCION_PLAN_FLUJO_DIVERGENTE',
          'La dirección del plan no coincide con la relación actual.');
      }
      const estado = plan.direccion === 'emision'
        ? 'preparandoFotografia' : 'pendienteManifiesto';
      const anterior = await obtenerPlanBloqueado(conexion, plan.flujoId);
      if (anterior && anterior.revision_efectiva_id !== plan.revisionEfectivaId) {
        await asegurarVersionPlan(conexion, anterior);
        await conexion.execute(
          `INSERT INTO historico_reconciliaciones_flujos_concesion_federacion (
             flujo_id,revision_efectiva_id,generacion_id,revision_oferta_id,
             revision_aceptacion_id,estado,frontera_inicial,finalizada_en_utc
           ) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (
             SELECT 1 FROM historico_reconciliaciones_flujos_concesion_federacion
             WHERE flujo_id=? AND revision_efectiva_id=?
           )`,
          [anterior.flujo_id, anterior.revision_efectiva_id,
            anterior.generacion_id, anterior.revision_oferta_id,
            anterior.revision_aceptacion_id, anterior.estado,
            anterior.frontera_inicial, ahora,
            anterior.flujo_id, anterior.revision_efectiva_id]
        );
        await conexion.execute(
          `UPDATE reconciliaciones_flujos_concesion_federacion SET
             generacion_id=?,revision_efectiva_id=?,revision_oferta_id=?,
             revision_aceptacion_id=?,estado=?,frontera_inicial=NULL,
             version_reconciliacion=version_reconciliacion+1,
             actualizada_en_utc=? WHERE flujo_id=?`,
          [plan.generacionId, plan.revisionEfectivaId, plan.ofertaId,
            plan.aceptacionId, estado, ahora, plan.flujoId]
        );
      } else {
        await conexion.execute(
          `INSERT INTO reconciliaciones_flujos_concesion_federacion (
           flujo_id,generacion_id,relacion_id,familia,revision_efectiva_id,
           revision_oferta_id,revision_aceptacion_id,direccion,estado,
           scope_origen_nivel,scope_origen_tenant_id,
           scope_origen_empresa_id,scope_origen_sitio_id,
           frontera_inicial,version_reconciliacion,creada_en_utc,actualizada_en_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,1,?,?)
         ON DUPLICATE KEY UPDATE
           version_reconciliacion=version_reconciliacion+
             IF(revision_efectiva_id=VALUES(revision_efectiva_id),0,1),
           revision_efectiva_id=VALUES(revision_efectiva_id),
           revision_oferta_id=VALUES(revision_oferta_id),
           revision_aceptacion_id=VALUES(revision_aceptacion_id),
           scope_origen_nivel=COALESCE(
             scope_origen_nivel,VALUES(scope_origen_nivel)),
           scope_origen_tenant_id=COALESCE(
             scope_origen_tenant_id,VALUES(scope_origen_tenant_id)),
           scope_origen_empresa_id=COALESCE(
             scope_origen_empresa_id,VALUES(scope_origen_empresa_id)),
           scope_origen_sitio_id=COALESCE(
             scope_origen_sitio_id,VALUES(scope_origen_sitio_id)),
           actualizada_en_utc=VALUES(actualizada_en_utc)`,
          [plan.flujoId, plan.generacionId, plan.relacionId, plan.familia,
            plan.revisionEfectivaId, plan.ofertaId, plan.aceptacionId,
            plan.direccion, estado, plan.scopeOrigenDeclarado?.nivel ?? null,
            plan.scopeOrigenDeclarado?.tenantId ?? null,
            plan.scopeOrigenDeclarado?.empresaId ?? null,
            plan.scopeOrigenDeclarado?.sitioId ?? null, ahora, ahora]
        );
      }
      const fila = await obtenerPlanBloqueado(conexion, plan.flujoId);
      if (!coincidePlan(fila, plan)) {
        fallar('PLAN_FLUJO_CONCESION_DIVERGENTE',
          'La familia ya está vinculada a otro flujo o a otras fuentes bilaterales.');
      }
      await asegurarVersionPlan(conexion, fila);
      return hidratarPlan(fila);
    });
  }

  async marcarLista({ flujoId, fronteraInicial }) {
    return this.frontera.ejecutar(async (conexion) => {
      const fila = await obtenerPlanBloqueado(conexion, flujoId);
      if (!fila) fallar('PLAN_FLUJO_INEXISTENTE', 'El plan de flujo no existe.');
      if (fila.estado === 'lista') {
        if (String(fila.frontera_inicial) !== String(fronteraInicial)) {
          fallar('FRONTERA_INICIAL_DIVERGENTE',
            'El flujo ya fijó otra frontera inicial.');
        }
        return hidratarPlan(fila);
      }
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `UPDATE reconciliaciones_flujos_concesion_federacion
            SET estado='lista',frontera_inicial=?,
                version_reconciliacion=version_reconciliacion+1,
                actualizada_en_utc=? WHERE flujo_id=?`,
        [String(fronteraInicial), ahora, flujoId]
      );
      return hidratarPlan(await obtenerPlanBloqueado(conexion, flujoId));
    });
  }

  async obtenerPlan(flujoId) {
    return this.frontera.ejecutar(async (conexion) => {
      const fila = await obtenerPlanBloqueado(conexion, flujoId);
      return fila ? hidratarPlan(fila) : null;
    });
  }

  async listarManifiestosListos(relacionId) {
    return this.frontera.ejecutar(async (conexion) => {
      const [filas] = await conexion.execute(
        `SELECT p.*,f.version_familia,
                g.installation_propietaria_id,g.boot_propietario_id
           FROM reconciliaciones_flujos_concesion_federacion p
           JOIN flujos_federacion f ON f.flujo_id=p.flujo_id
           JOIN generaciones_flujos_federacion g
             ON g.generacion_id=p.generacion_id AND g.flujo_id=p.flujo_id
           JOIN estado_concesion_relaciones_federacion e
             ON e.relacion_id=p.relacion_id
              AND e.revision_efectiva_actual_id=p.revision_efectiva_id
          WHERE p.relacion_id=? AND p.direccion='emision' AND p.estado='lista'
            AND g.estado='preparada'
          ORDER BY p.familia,p.flujo_id`, [relacionId]
      );
      return Object.freeze(filas.map((fila) => Object.freeze({
        ...hidratarPlan(fila),
        versionFamilia: Number(fila.version_familia),
        scopeOrigenDeclarado: scopeOrigen(fila),
        installationEmisoraId: fila.installation_propietaria_id,
        bootEmisorId: fila.boot_propietario_id
      })));
    });
  }
}

async function asegurarVersionPlan(conexion, fila) {
  const valores = [fila.flujo_id, fila.revision_efectiva_id, fila.generacion_id];
  await conexion.execute(
    `INSERT INTO versiones_planes_flujos_federacion (
       flujo_id,revision_efectiva_id,generacion_id
     ) SELECT ?,?,? WHERE NOT EXISTS (
       SELECT 1 FROM versiones_planes_flujos_federacion
       WHERE flujo_id=? AND revision_efectiva_id=?
     )`, [...valores, ...valores.slice(0, 2)]
  );
  const [versiones] = await conexion.execute(
    `SELECT generacion_id FROM versiones_planes_flujos_federacion
      WHERE flujo_id=? AND revision_efectiva_id=?`, valores.slice(0, 2)
  );
  if (versiones[0]?.generacion_id !== fila.generacion_id) {
    fallar('VERSION_PLAN_FLUJO_DIVERGENTE',
      'La revision del plan ya conserva otra identidad de generacion.');
  }
}

async function obtenerPlanBloqueado(conexion, flujoId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM reconciliaciones_flujos_concesion_federacion
      WHERE flujo_id=? FOR UPDATE`, [flujoId]
  );
  return filas[0] || null;
}

function coincidePlan(fila, plan) {
  return fila && fila.flujo_id === plan.flujoId &&
    fila.generacion_id === plan.generacionId && fila.relacion_id === plan.relacionId &&
    fila.familia === plan.familia && fila.direccion === plan.direccion &&
    fila.revision_efectiva_id === plan.revisionEfectivaId &&
    fila.revision_oferta_id === plan.ofertaId &&
    fila.revision_aceptacion_id === plan.aceptacionId &&
    (!plan.scopeOrigenDeclarado ||
      mismoScopeOrigen(fila, plan.scopeOrigenDeclarado));
}

function hidratarConcesion(fila) {
  return Object.freeze({
    relacionId: fila.relacion_id,
    direccion: fila.direccion,
    scopeOrigenDeclarado: scopeOrigen(fila),
    installationRemotaId: fila.installation_remota_id,
    contexto: Object.freeze({
      nivel: fila.scope_sitio_id != null ? 'sitio'
        : fila.scope_empresa_id != null ? 'empresa'
          : fila.scope_tenant_id != null ? 'tenant' : 'portal',
      tenantId: decimal(fila.scope_tenant_id),
      empresaId: decimal(fila.scope_empresa_id),
      sitioId: decimal(fila.scope_sitio_id)
    }),
    revisionEfectivaId: fila.revision_efectiva_actual_id,
    ofertaId: fila.revision_oferta_id,
    aceptacionId: fila.revision_aceptacion_id,
    seleccion: Object.freeze(typeof fila.seleccion === 'string'
      ? JSON.parse(fila.seleccion) : fila.seleccion)
  });
}

function hidratarPlan(fila) {
  return Object.freeze({
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_id,
    relacionId: fila.relacion_id,
    familia: fila.familia,
    revisionEfectivaId: fila.revision_efectiva_id,
    ofertaId: fila.revision_oferta_id,
    aceptacionId: fila.revision_aceptacion_id,
    direccion: fila.direccion,
    estado: fila.estado,
    fronteraInicial: decimal(fila.frontera_inicial),
    version: String(fila.version_reconciliacion)
  });
}

function decimal(valor) { return valor == null ? null : String(valor); }

function scopeOrigen(fila) {
  if (fila.scope_origen_nivel == null) return null;
  return Object.freeze({
    nivel: fila.scope_origen_nivel,
    tenantId: decimal(fila.scope_origen_tenant_id),
    empresaId: decimal(fila.scope_origen_empresa_id),
    sitioId: decimal(fila.scope_origen_sitio_id)
  });
}

function mismoScopeOrigen(fila, scope) {
  return fila.scope_origen_nivel === scope.nivel &&
    decimal(fila.scope_origen_tenant_id) === scope.tenantId &&
    decimal(fila.scope_origen_empresa_id) === scope.empresaId &&
    decimal(fila.scope_origen_sitio_id) === scope.sitioId;
}

function exigirAutoridadActual(fila) {
  if (fila.estado_ciclo !== 'vinculada' || fila.estado_autoridad !== 'autorizada' ||
      fila.estado_identidad !== 'valida' || fila.estado_compatibilidad !== 'compatible' ||
      !fila.responsable_activo) {
    fallar('AUTORIDAD_FLUJO_CONCESION_NO_VIGENTE',
      'La relación o su responsabilidad local dejaron de ser operativas.');
  }
  const permiso = fila.direccion === 'emision'
    ? fila.permiso_configurar_emisiones_federacion
    : fila.permiso_configurar_recepciones_federacion;
  if (!permiso || !scopeCubre(fila)) {
    fallar('AUTORIDAD_FLUJO_CONCESION_NO_VIGENTE',
      'El responsable ya no conserva permiso y scope suficientes.');
  }
}

function scopeCubre(fila) {
  const usuario = [fila.responsable_tenant_id, fila.responsable_empresa_id,
    fila.responsable_sitio_id].map(decimal);
  const relacion = [fila.scope_tenant_id, fila.scope_empresa_id,
    fila.scope_sitio_id].map(decimal);
  for (let indice = 0; indice < usuario.length; indice += 1) {
    if (usuario[indice] !== null && usuario[indice] !== relacion[indice]) return false;
  }
  const profundidadUsuario = usuario.filter((valor) => valor !== null).length;
  const profundidadRelacion = relacion.filter((valor) => valor !== null).length;
  return profundidadUsuario <= profundidadRelacion;
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorReconciliacionFlujosFederacion(codigo, mensaje);
}
