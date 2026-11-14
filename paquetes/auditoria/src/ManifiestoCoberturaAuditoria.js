const RUTA_PORTAL = 'apps/sentinelia-web/src/rutas/crearRutasPortal.js';
const RUTA_API_AGENTES = 'apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js';

const ruta = (metodo, path, clasificacion, eventos = [], detalle = '') =>
  Object.freeze({
    id: `${metodo} ${path}`,
    metodo,
    path,
    archivo: path.startsWith('/api/agentes/') ? RUTA_API_AGENTES : RUTA_PORTAL,
    clasificacion,
    eventos: Object.freeze(eventos),
    detalle
  });

export const CLASIFICACIONES_COBERTURA_AUDITORIA = Object.freeze([
  'auditable',
  'cubierta',
  'excluida',
  'diferida'
]);

export const MANIFIESTO_RUTAS_AUDITORIA = Object.freeze([
  ruta('POST', '/pow/desafio', 'excluida', [], 'Protección efímera antiabuso.'),
  ruta('POST', '/recuperar-password/pow/desafio', 'excluida', [],
    'Protección efímera antiabuso de la recuperación pública.'),
  ruta('POST', '/recuperar-password', 'auditable',
    ['recuperacion_password.solicitud_emitida'],
    'Solo una emisión real para un buzón elegible consolida evento.'),
  ruta('POST', '/recuperacion-password/continuar', 'cubierta', [],
    'Resuelve y reserva autoridad efímera sin modificar todavía la credencial.'),
  ruta('POST', '/recuperacion-password/password', 'auditable',
    ['usuario.password_recuperado', 'usuario.sesion_invalidada']),
  ruta('POST', '/login', 'auditable', ['usuario.sesion_iniciada'], 'Solo el login correcto consolida evento.'),
  ruta('POST', '/cambio-password-obligatorio', 'auditable', ['usuario.password_cambiado', 'usuario.sesion_iniciada']),
  ruta('POST', '/salir', 'auditable', ['usuario.sesion_cerrada']),
  ruta('POST', '/panel/api/alertas-activas/:monitorId/descartar', 'auditable', ['alerta.descarte_aplicado']),
  ruta('POST', '/panel/api/alertas-activas/:monitorId/revertir-descarte', 'auditable', ['alerta.descarte_revertido']),
  ruta('POST', '/avisos-plataforma/api/:avisoId/reconocer', 'auditable', ['plataforma.aviso_reconocido']),
  ruta('POST', '/avisos-plataforma/api/:avisoId/ocultar', 'auditable', ['plataforma.aviso_ocultado']),
  ruta('POST', '/buzon/api/notificaciones/:notificacionId/leer', 'excluida', [], 'Acuse de lectura de una proyección ya durable.'),
  ruta('POST', '/panel/api/alertas-remotas/:proyeccionId/:alertaAuditoriaId/descartar', 'auditable', ['alerta.descarte_aplicado']),
  ruta('POST', '/panel/api/alertas-remotas/:proyeccionId/:alertaAuditoriaId/revertir', 'auditable', ['alerta.descarte_revertido']),
  ruta('POST', '/mi-perfil/desbloquear', 'excluida', [], 'Autorización efímera.'),
  ruta('POST', '/mi-perfil/cerrar-edicion', 'excluida', [], 'Autorización efímera.'),
  ruta('POST', '/mi-perfil/nombre-visible', 'auditable', ['usuario.perfil_cambiado']),
  ruta('POST', '/mi-perfil/nombre-completo', 'auditable', ['usuario.perfil_cambiado']),
  ruta('POST', '/mi-perfil/preferencia-alertas-remotas', 'auditable', ['usuario.perfil_cambiado']),
  ruta('POST', '/mi-perfil/password', 'auditable', ['usuario.password_cambiado', 'usuario.sesion_invalidada']),
  ruta('POST', '/mi-perfil/email', 'cubierta', [], 'Prepara el cambio; no lo consolida.'),
  ruta('POST', '/mi-perfil/email/validar', 'cubierta', [], 'Validación previa.'),
  ruta('POST', '/mi-perfil/email/reenviar', 'cubierta', [], 'Reenvío de la misma preparación.'),
  ruta('GET', '/mi-perfil/email/confirmar/:token', 'cubierta', [], 'Adopta temporalmente el token; no cambia el perfil.'),
  ruta('POST', '/mi-perfil/email/confirmar', 'auditable', ['usuario.perfil_cambiado', 'usuario.email_validado']),
  ruta('POST', '/organizacion/tenants/crear', 'auditable', ['organizacion.tenant_creado']),
  ruta('POST', '/organizacion/tenants/actualizar', 'auditable', ['organizacion.tenant_actualizado']),
  ruta('POST', '/organizacion/empresas/crear', 'auditable', ['organizacion.empresa_creada']),
  ruta('POST', '/organizacion/empresas/actualizar', 'auditable', ['organizacion.empresa_actualizada', 'scope.entidad_salida', 'scope.entidad_entrada', 'usuario.sesion_invalidada', 'agente.sesion_invalidada']),
  ruta('POST', '/organizacion/sitios/crear', 'auditable', ['organizacion.sitio_creado']),
  ruta('POST', '/organizacion/sitios/actualizar', 'auditable', ['organizacion.sitio_actualizado', 'scope.entidad_salida', 'scope.entidad_entrada', 'usuario.sesion_invalidada', 'agente.sesion_invalidada']),
  ruta('POST', '/api/organizacion/:tipo/:id/eliminacion', 'auditable', [
    'organizacion.tenant_eliminado',
    'organizacion.empresa_eliminada',
    'organizacion.sitio_eliminado'
  ], 'La aceptación encola la operación administrativa tipificada.'),
  ruta('POST', '/usuarios/api/crear', 'auditable', ['usuario.creado']),
  ruta('POST', '/usuarios/api/:id/actualizar', 'auditable', ['usuario.perfil_cambiado', 'usuario.permisos_cambiados', 'usuario.estado_cambiado', 'usuario.password_reiniciado', 'scope.entidad_salida', 'scope.entidad_entrada', 'usuario.sesion_invalidada']),
  ruta('POST', '/usuarios/api/:id/reiniciar-password', 'auditable',
    ['usuario.password_reiniciado', 'usuario.sesion_invalidada']),
  ruta('POST', '/usuarios/api/:id/eliminar', 'auditable', ['usuario.eliminado', 'usuario.sesion_invalidada']),
  ruta('POST', '/impersonacion/api/iniciar', 'auditable', ['usuario.impersonacion_iniciada']),
  ruta('POST', '/impersonacion/api/revertir', 'auditable', ['usuario.impersonacion_finalizada']),
  ruta('POST', '/agentes/:id/reglas/previsualizar', 'excluida', [], 'Cálculo sin persistencia.'),
  ruta('POST', '/agentes/:id/reglas/crear', 'auditable', ['regla_telemetria.creada']),
  ruta('POST', '/agentes/:id/reglas/:reglaId/revisiones', 'auditable', ['regla_telemetria.revision_creada']),
  ruta('POST', '/agentes/:id/reglas/:reglaId/activar', 'auditable', ['regla_telemetria.estado_cambiado']),
  ruta('POST', '/agentes/:id/reglas/:reglaId/desactivar', 'auditable', ['regla_telemetria.estado_cambiado']),
  ruta('POST', '/agentes/crear', 'auditable', ['agente.provisionado']),
  ruta('POST', '/agentes/:id/actualizar', 'auditable', ['agente.metadatos_cambiados', 'scope.entidad_salida', 'scope.entidad_entrada', 'agente.sesion_invalidada']),
  ruta('POST', '/agentes/:id/perfil-servidor/solicitar', 'auditable', ['agente.perfil_servidor_solicitado']),
  ruta('POST', '/agentes/:id/perfil-servidor/configuracion', 'auditable', ['agente.configuracion_servidor_cambiada']),
  ruta('POST', '/agentes/:id/perfil-servidor/retirar', 'auditable', ['agente.perfil_servidor_retirado']),
  ruta('POST', '/agentes/:id/rotar-secreto', 'auditable', ['agente.secreto_rotado', 'agente.sesion_invalidada']),
  ruta('POST', '/agentes/:id/deshabilitar', 'auditable', ['agente.estado_administrativo_cambiado', 'agente.sesion_invalidada']),
  ruta('POST', '/agentes/:id/habilitar', 'auditable', ['agente.estado_administrativo_cambiado']),
  ruta('POST', '/agentes/:id/eliminar', 'auditable', ['agente.eliminado'], 'La aceptación encola la operación; el runtime registra el efecto durable.'),
  ruta('POST', '/monitores/triggers/crear', 'auditable', ['trigger.creado']),
  ruta('POST', '/monitores/triggers/:id/actualizar', 'auditable', ['trigger.actualizado', 'scope.entidad_salida', 'scope.entidad_entrada']),
  ruta('POST', '/monitores/triggers/eliminar', 'auditable', ['trigger.eliminado']),
  ruta('POST', '/monitores/triggers/vinculos/crear', 'auditable', ['trigger.binding_creado']),
  ruta('POST', '/monitores/triggers/vinculos/:id/actualizar', 'auditable', ['trigger.binding_actualizado']),
  ruta('POST', '/monitores/triggers/vinculos/eliminar', 'auditable', ['trigger.binding_eliminado']),
  ruta('POST', '/monitores/triggers/:id/correo/audiencia', 'auditable', [
    'trigger.audiencia_destinatario_agregado',
    'trigger.audiencia_destinatario_retirado',
    'trigger.audiencia_destinatario_reincorporado',
    'trigger.audiencia_vacia_desactivado'
  ]),
  ruta('POST', '/monitores/triggers/:id/correo/previsualizar', 'excluida', [],
    'Renderiza una previsualización sin persistencia.'),
  ruta('POST', '/monitores/triggers/:id/correo/probar', 'cubierta', [],
    'La solicitud queda trazada por la cola durable de correo de prueba.'),
  ruta('POST', '/monitores/crear', 'auditable', ['monitor.creado']),
  ruta('POST', '/monitores/:id/actualizar', 'auditable', ['monitor.actualizado', 'scope.entidad_salida', 'scope.entidad_entrada']),
  ruta('POST', '/monitores/eliminar', 'auditable', ['monitor.eliminado']),
  ruta('POST', '/dns/crear', 'auditable', ['dns.zona_creada']),
  ruta('POST', '/dns/:id/registros/crear', 'auditable', ['dns.registro_creado']),
  ruta('POST', '/dns/:id/registros/:registroId/actualizar', 'auditable', ['dns.registro_actualizado']),
  ruta('POST', '/dns/:id/registros/eliminar', 'auditable', ['dns.registro_eliminado']),
  ruta('POST', '/dns/:id/actualizar', 'auditable', ['dns.zona_actualizada', 'scope.entidad_salida', 'scope.entidad_entrada']),
  ruta('POST', '/dns/eliminar', 'auditable', ['dns.zona_eliminada']),
  ruta('POST', '/configuracion/actualizar', 'auditable', ['configuracion.portal_actualizada']),
  ruta('POST', '/configuracion/restablecer', 'auditable', ['configuracion.portal_restablecida']),
  ruta('POST', '/configuracion/sincronizar', 'auditable', ['configuracion.portal_sincronizada']),
  ruta('POST', '/configuracion/correo/iniciar-verificacion', 'cubierta', [], 'Prepara y envía la verificación.'),
  ruta('GET', '/configuracion/correo/verificar/:token', 'auditable', ['configuracion.correo_operativo_verificado']),
  ruta('POST', '/configuracion/correo/verificar/:token', 'auditable', ['configuracion.correo_operativo_verificado']),
  ruta('POST', '/correo/desuscripcion/:token', 'auditable', [
    'trigger.audiencia_destinatario_desuscrito',
    'trigger.audiencia_vacia_desactivado'
  ], 'La capacidad pública retira relaciones y puede desactivar el trigger.'),
  ruta('POST', '/federacion/relaciones/recepcion', 'auditable', ['federacion.relacion_estado_cambiado']),
  ruta('POST', '/federacion/importaciones/invitacion', 'auditable', ['federacion.vinculacion_solicitada', 'federacion.vinculacion_confirmada']),
  ruta('POST', '/federacion/importaciones/recuperacion', 'auditable', ['federacion.credencial_recuperada']),
  ruta('POST', '/federacion/relaciones/:relacionId/invitaciones', 'auditable', ['federacion.vinculacion_solicitada']),
  ruta('POST', '/federacion/relaciones/:relacionId/invitaciones/revocar', 'auditable', ['federacion.invitacion_revocada']),
  ruta('POST', '/federacion/relaciones/:relacionId/confirmar-identidad', 'auditable', ['federacion.vinculacion_confirmada']),
  ruta('POST', '/federacion/relaciones/:relacionId/recuperaciones', 'auditable', ['federacion.recuperacion_solicitada']),
  ruta('POST', '/federacion/relaciones/:relacionId/aprobar-localizacion', 'auditable', ['federacion.localizacion_cambiada']),
  ruta('POST', '/federacion/relaciones/:relacionId/transferir-responsabilidad', 'auditable', ['federacion.responsabilidad_transferida']),
  ruta('POST', '/federacion/relaciones/:relacionId/deshabilitar', 'auditable', ['federacion.relacion_estado_cambiado']),
  ruta('POST', '/federacion/relaciones/:relacionId/eliminar', 'auditable', ['federacion.relacion_estado_cambiado']),
  ruta('POST', '/federacion/relaciones/:relacionId/concesion/previsualizar', 'cubierta', [], 'Simulación efímera sin mutación de dominio.'),
  ruta('POST', '/federacion/relaciones/:relacionId/concesion/confirmar', 'auditable', ['federacion.concesion_revisada']),
  ruta('POST', '/federacion/relaciones/:relacionId/concesion/sincronizar', 'cubierta', [], 'Publica una revisión ya auditada; los intercambios y confirmaciones quedan durables en el protocolo federado.'),
  ruta('POST', '/federacion/conflictos/:incidenteId/resolver', 'auditable', ['federacion.conflicto_identidad_resuelto']),
  ruta('POST', '/federacion/datos-remotos/borradores/monitor', 'excluida', [], 'Prepara en la sesión un formulario local no persistido; el guardado posterior del monitor sí es auditable.'),
  ruta('POST', '/federacion/datos-remotos/borradores/trigger', 'excluida', [], 'Prepara en la sesión un formulario local no persistido; el guardado posterior del trigger sí es auditable.'),
  ruta('POST', '/federacion/reconstrucciones/:flujoId/decidir', 'auditable', ['federacion.reconstruccion_decidida']),
  ruta('POST', '/federacion/reconstrucciones/:flujoId/candidatas/:generacionId/cancelar', 'auditable', ['federacion.reconstruccion_decidida']),
  ruta('POST', '/federacion/reconstrucciones/:flujoId/candidatas/:generacionId/promover', 'auditable', ['federacion.reconstruccion_decidida']),
  ruta('POST', '/federacion/reconstrucciones/:flujoId/candidatas/:generacionId/revalidar', 'auditable', ['federacion.reconstruccion_decidida']),
  ruta('POST', '/auditoria/api/incidentes/:episodioId/reconocer', 'auditable', ['auditoria.incidencia_integridad_reconocida']),
  ruta('POST', '/api/agentes/v1/login', 'auditable', ['agente.sesion_iniciada', 'agente.sesion_reemplazada', 'agente.cuarentena_activada', 'agente.cuarentena_desactivada']),
  ruta('POST', '/api/agentes/v1/session/refresh', 'cubierta', [], 'Mantiene la misma sesión auditable.'),
  ruta('POST', '/api/agentes/v1/heartbeat', 'excluida', [], 'Alta frecuencia con POL propio.'),
  ruta('POST', '/api/agentes/v1/telemetria', 'excluida', [], 'Evidencia especializada de alta frecuencia.'),
  ruta('POST', '/api/agentes/v1/ddns/:concesionId/intenciones', 'auditable',
    ['ddns.intencion_aceptada', 'ddns.contenido_deseado_persistido'])
]);

const productor = ({
  id,
  archivo,
  simbolo,
  clasificacion,
  eventos = [],
  detalle = ''
}) => Object.freeze({
  id,
  archivo,
  simbolo,
  clasificacion,
  eventos: Object.freeze(eventos),
  detalle
});

export const MANIFIESTO_PRODUCTORES_INTERNOS_AUDITORIA = Object.freeze([
  productor({
    id: 'runtime.organizacion.eliminacion_administrativa',
    archivo:
      'paquetes/jerarquia-organizativa/src/RegistradorAuditoriaEliminacionOrganizacion.js',
    simbolo: 'registrarEnTransaccion',
    clasificacion: 'auditable',
    eventos: [
      'organizacion.tenant_eliminado',
      'organizacion.empresa_eliminada',
      'organizacion.sitio_eliminado'
    ]
  }),
  productor({
    id: 'runtime.agentes.eliminacion_administrativa',
    archivo: 'paquetes/agentes/src/RegistradorAuditoriaEliminacionAgente.js',
    simbolo: 'registrarEnTransaccion',
    clasificacion: 'auditable',
    eventos: ['agente.eliminado']
  }),
  productor({
    id: 'bootstrap.usuario_inicial',
    archivo: 'paquetes/usuarios/src/ControladorBootstrapUsuarioInicial.js',
    simbolo: 'arrancarSiProcede',
    clasificacion: 'auditable',
    eventos: ['usuario.creado']
  }),
  productor({
    id: 'bootstrap.configuracion_portal',
    archivo: 'paquetes/configuracion/src/ServicioConfiguracionPortal.js',
    simbolo: 'bootstrapYcargar',
    clasificacion: 'auditable',
    eventos: ['configuracion.portal_sincronizada']
  }),
  productor({
    id: 'runtime.alertas.transiciones',
    archivo: 'apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js',
    simbolo: 'construirTransicionAlerta',
    clasificacion: 'auditable',
    eventos: ['alerta.abierta', 'alerta.cerrada', 'alerta.descarte_revertido']
  }),
  productor({
    id: 'monitores.alertas.inactivacion',
    archivo: 'paquetes/monitores/src/ServicioCierreAlertasMonitoresInactivos.js',
    simbolo: 'construirIntencionCierre',
    clasificacion: 'auditable',
    eventos: ['alerta.cerrada']
  }),
  productor({
    id: 'runtime.triggers.mutacion_dns',
    archivo: 'paquetes/triggers/src/EjecutorTriggerDns.js',
    simbolo: 'ejecutar',
    clasificacion: 'auditable',
    eventos: ['dns.registro_actualizado']
  }),
  productor({
    id: 'runtime.dns.publicacion_bind',
    archivo: 'apps/sentinelia-runtime/src/dns/CoordinadorDnsRuntime.js',
    simbolo: 'sincronizarSiHaCambiado',
    clasificacion: 'auditable',
    eventos: ['dns.publicacion_aplicada', 'dns.publicacion_fallida']
  }),
  productor({
    id: 'runtime.monitores.ejecucion',
    archivo: 'apps/sentinelia-runtime/src/RuntimeSentinelia.js',
    simbolo: 'procesarTickScheduler',
    clasificacion: 'excluida',
    detalle: 'Estado, eventos e histórico especializado de monitores.'
  }),
  productor({
    id: 'runtime.monitores.retencion_especializada',
    archivo: 'apps/sentinelia-runtime/src/retencion/GestorRetencionMonitores.js',
    simbolo: 'ejecutarSiProcede',
    clasificacion: 'excluida',
    detalle: 'Retención del histórico especializado, distinta de la retención auditable.'
  }),
  productor({
    id: 'runtime.triggers.ejecucion_ordinaria',
    archivo: 'apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js',
    simbolo: 'ejecutarDesdePersistenciaAlertas',
    clasificacion: 'excluida',
    detalle: 'La ejecución conserva histórico especializado propio.'
  }),
  productor({
    id: 'runtime.telemetria.derivada',
    archivo: 'apps/sentinelia-runtime/src/telemetria/DespachadorEvaluacionesTelemetriaRuntime.js',
    simbolo: 'procesarPendientes',
    clasificacion: 'excluida',
    detalle: 'Pipeline durable especializado de 5.20a.'
  }),
  productor({
    id: 'runtime.agentes.perfil_servidor',
    archivo: 'apps/sentinelia-runtime/src/agentes/ProcesadorSenalesServidorRuntime.js',
    simbolo: 'procesarPendientesInterno',
    clasificacion: 'auditable',
    eventos: ['agente.perfil_servidor_desactivado']
  })
]);

export function extraerRutasMutadorasDesdeFuente(fuente) {
  const rutas = [];
  const patron = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  const coincidencias = [...fuente.matchAll(patron)];
  for (const [indice, coincidencia] of coincidencias.entries()) {
    const metodo = coincidencia[1].toUpperCase();
    const path = coincidencia[2];
    const inicio = coincidencia.index + coincidencia[0].length;
    const fin = coincidencias[indice + 1]?.index ?? fuente.length;
    const bloque = fuente.slice(inicio, fin);
    const controlador = bloque.match(/\.([A-Za-z][A-Za-z0-9_]*)\.bind\(/)?.[1] || '';
    const getMutador = metodo === 'GET' && /^(abrirConfirmacion|confirmar|verificar|crear|actualizar|eliminar|activar|desactivar|marcar)/.test(controlador);
    if (metodo !== 'GET' || getMutador) {
      rutas.push(Object.freeze({ id: `${metodo} ${path}`, metodo, path, controlador }));
    }
  }
  return rutas;
}

export function verificarCoberturaRutas(rutasDetectadas, manifiesto = MANIFIESTO_RUTAS_AUDITORIA) {
  const idsDetectados = new Set(rutasDetectadas.map((item) => item.id));
  const idsManifiesto = new Set(manifiesto.map((item) => item.id));
  const huerfanas = [...idsDetectados].filter((id) => !idsManifiesto.has(id)).sort();
  const obsoletas = [...idsManifiesto].filter((id) => !idsDetectados.has(id)).sort();
  if (huerfanas.length || obsoletas.length) {
    throw new Error(
      `Cobertura de rutas incoherente. Huérfanas: ${huerfanas.join(', ') || 'ninguna'}. Obsoletas: ${obsoletas.join(', ') || 'ninguna'}.`
    );
  }
  return Object.freeze({ total: idsDetectados.size, huerfanas: [], obsoletas: [] });
}

export function extraerProductoresInternosDesdeFuente(fuente, archivo) {
  const productores = [];
  const patron = /\/\/\s*auditoria-productor:\s*([a-z0-9_.-]+)/g;
  for (const coincidencia of fuente.matchAll(patron)) {
    productores.push(Object.freeze({ id: coincidencia[1], archivo }));
  }
  return productores;
}

export function verificarCoberturaProductores(
  productoresDetectados,
  manifiesto = MANIFIESTO_PRODUCTORES_INTERNOS_AUDITORIA
) {
  const idsDetectados = new Set(productoresDetectados.map((item) => item.id));
  const idsManifiesto = new Set(manifiesto.map((item) => item.id));
  const huerfanos = [...idsDetectados].filter((id) => !idsManifiesto.has(id)).sort();
  const obsoletos = [...idsManifiesto].filter((id) => !idsDetectados.has(id)).sort();
  if (huerfanos.length || obsoletos.length) {
    throw new Error(
      `Cobertura de productores incoherente. Huérfanos: ${huerfanos.join(', ') || 'ninguno'}. Obsoletos: ${obsoletos.join(', ') || 'ninguno'}.`
    );
  }
  return Object.freeze({ total: idsDetectados.size, huerfanos: [], obsoletos: [] });
}
