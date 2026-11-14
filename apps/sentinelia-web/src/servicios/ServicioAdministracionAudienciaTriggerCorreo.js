import { generarUuidV7Auditoria }
  from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 }
  from '../../../../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 }
  from '../../../../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import { esBuzonCorreoValido }
  from '../../../../paquetes/correo/src/NormalizadorBuzonCorreo.js';

export class ServicioAdministracionAudienciaTriggerCorreo {
  constructor({
    servicioAudiencia,
    repositorioAudiencia,
    repositorioTriggers,
    repositorioUsuarios,
    fronteraTransaccional,
    servicioAutorizacion,
    servicioAuditoria,
    ahora = () => new Date()
  }) {
    if (typeof servicioAudiencia?.mutar !== 'function' ||
        typeof repositorioAudiencia?.listarResolucionEnTransaccion !== 'function' ||
        typeof repositorioTriggers?.buscarVisiblePorId !== 'function' ||
        typeof repositorioUsuarios?.listarParaAdministracion !== 'function' ||
        typeof fronteraTransaccional?.ejecutar !== 'function' ||
        typeof servicioAutorizacion?.puedeVerTriggers !== 'function' ||
        typeof servicioAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La administración de audiencia requiere todos sus puertos.');
    }
    this.servicioAudiencia = servicioAudiencia;
    this.repositorioAudiencia = repositorioAudiencia;
    this.repositorioTriggers = repositorioTriggers;
    this.repositorioUsuarios = repositorioUsuarios;
    this.frontera = fronteraTransaccional;
    this.autorizacion = servicioAutorizacion;
    this.auditoria = servicioAuditoria;
    this.ahora = ahora;
  }

  crearApiPrivadaVerificador() {
    return Object.freeze({
      leer: this.leer.bind(this),
      buscarUsuariosElegibles: this.buscarUsuariosElegibles.bind(this),
      mutar: this.mutar.bind(this)
    });
  }

  async leer(contextoUsuarioActual, triggerId) {
    exigirPermisos(this.autorizacion, contextoUsuarioActual);
    return this.frontera.ejecutar(async (conexion) => {
      const trigger = await this.repositorioAudiencia
        .bloquearTriggerCorreoEnTransaccion(triggerId, { conexion });
      exigirTriggerAlcanzable(contextoUsuarioActual, trigger);
      const filas = await this.repositorioAudiencia.listarResolucionEnTransaccion(
        triggerId,
        { conexion }
      );
      const relaciones = filas.map((fila) => redactarRelacion(
        contextoUsuarioActual,
        fila
      ));
      return congelar({
        trigger: {
          id: String(trigger.id),
          revisionDeclaracion: Number(trigger.revision_declaracion),
          activo: Boolean(trigger.activo)
        },
        relaciones,
        total: relaciones.length,
        restringidas: relaciones.filter((item) => item.restringida).length
      });
    });
  }

  async buscarUsuariosElegibles(
    contextoUsuarioActual,
    { triggerId, texto = '', limite = 25 } = {}
  ) {
    exigirPermisos(this.autorizacion, contextoUsuarioActual);
    if (triggerId != null) {
      const trigger = await this.repositorioTriggers.buscarVisiblePorId(
        contextoUsuarioActual,
        triggerId
      );
      if (!trigger || trigger.tipo !== 'correo') lanzarNoDisponible();
    }
    const patron = String(texto || '').trim().toLocaleLowerCase('es');
    const maximo = Math.min(Math.max(Number(limite) || 25, 1), 25);
    const usuarios = await this.repositorioUsuarios.listarParaAdministracion(
      contextoUsuarioActual
    );
    return congelar({
      resultados: usuarios
        .filter((usuario) => usuario.activo)
        .filter((usuario) => !patron || [
          usuario.usuario,
          usuario.nombreMostrar,
          usuario.nombreCompleto,
          usuario.email
        ].filter(Boolean).some((valor) =>
          String(valor).toLocaleLowerCase('es').includes(patron)))
        .slice(0, maximo)
        .map((usuario) => {
          const emailUtilizable = usuario.emailValidado &&
            esBuzonCorreoValido(usuario.email);
          return {
            id: String(usuario.id),
            nombre: usuario.obtenerNombreVisible(),
            email: usuario.email,
            scope: scopeDto(usuario),
            entregableAhora: emailUtilizable,
            diagnosticoEntrega: emailUtilizable
              ? 'entregable'
              : usuario.emailValidado
                ? 'email_invalido'
                : 'email_no_validado'
          };
        })
    });
  }

  async mutar(contextoUsuarioActual, comando = {}, { conexion = null } = {}) {
    exigirPermisos(this.autorizacion, contextoUsuarioActual);
    return this.servicioAudiencia.mutar(comando, {
      conexion,
      autorizarTriggerEnTransaccion: ({ trigger }) =>
        exigirTriggerAlcanzable(contextoUsuarioActual, trigger),
      autorizarEnTransaccion: ({
        trigger,
        audienciaAntes,
        usuariosBloqueados,
        operacion
      }) => autorizarMutacion({
        contextoUsuarioActual,
        trigger,
        audienciaAntes,
        usuariosBloqueados,
        operacion
      }),
      despuesDeMutarEnTransaccion: ({ conexion, triggerAntes, resultado }) =>
        this.registrarAuditoria({
          conexion,
          contextoUsuarioActual,
          trigger: triggerAntes,
          resultado
        })
    });
  }

  async registrarAuditoria({
    conexion,
    contextoUsuarioActual,
    trigger,
    resultado
  }) {
    for (const relacion of resultado.relacionesCreadas) {
      await this.registrarEvento({
        conexion,
        contextoUsuarioActual,
        trigger,
        sujetoId: relacion.id,
        tipo: 'trigger.audiencia_destinatario_agregado',
        payload: {
          resultado: 'creado',
          antes: null,
          despues: fotografiaRelacion(relacion)
        }
      });
    }
    for (const relacion of resultado.relacionesRetiradas) {
      await this.registrarEvento({
        conexion,
        contextoUsuarioActual,
        trigger,
        sujetoId: relacion.id,
        tipo: 'trigger.audiencia_destinatario_retirado',
        payload: {
          resultado: 'eliminado',
          antes: fotografiaRelacion(relacion),
          despues: null,
          impactoResumen: null
        }
      });
    }
    for (const relacion of resultado.relacionesReincorporadas) {
      await this.registrarEvento({
        conexion,
        contextoUsuarioActual,
        trigger,
        sujetoId: relacion.id,
        tipo: 'trigger.audiencia_destinatario_reincorporado',
        payload: {
          resultado: 'actualizado',
          camposCambiados: ['estadoParticipacion'],
          antes: { estadoParticipacion: 'desuscrita' },
          despues: { estadoParticipacion: 'activa' }
        }
      });
    }
    if (resultado.desactivadoAutomaticamente) {
      await this.registrarEvento({
        conexion,
        contextoUsuarioActual,
        trigger,
        tipo: 'trigger.audiencia_vacia_desactivado',
        payload: {
          resultado: 'actualizado',
          camposCambiados: ['activo'],
          antes: { activo: true },
          despues: { activo: false }
        }
      });
    }
  }

  registrarEvento({
    conexion,
    contextoUsuarioActual,
    trigger,
    sujetoId = null,
    tipo,
    payload
  }) {
    const eventoId = generarUuidV7Auditoria();
    const scope = scopeDto(trigger);
    return this.auditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'automatizacion',
        claveCadena: scope.tenantId
          ? `automatizacion:tenant:${scope.tenantId}`
          : 'automatizacion:portal',
        actor: 'usuario',
        actorReal: actor(contextoUsuarioActual, 'idUsuarioReal'),
        actorEfectivo: actorEfectivo(contextoUsuarioActual),
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto: tipo.startsWith('trigger.audiencia_destinatario_')
          ? {
              tipo: 'destinatario_trigger_correo',
              id: String(sujetoId)
            }
          : { tipo: 'trigger', id: String(trigger.id) },
        origen: 'web',
        correlacionId: eventoId,
        causalidad: null,
        productor: 'portal_web',
        claveOperacion: eventoId,
        scope,
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload,
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }
}

function exigirPermisos(autorizacion, contexto) {
  if (!autorizacion.puedeVerTriggers(contexto) ||
      !autorizacion.puedeEditarTriggers(contexto)) {
    throw Object.assign(
      new Error('No tienes permiso para administrar la audiencia de triggers.'),
      { codigo: 'audiencia_trigger_correo_no_autorizada', statusCode: 403 }
    );
  }
}

function exigirTriggerAlcanzable(contexto, trigger) {
  if (!trigger || trigger.tipo !== 'correo' || !alcanza(contexto, trigger)) {
    lanzarNoDisponible();
  }
}

function autorizarMutacion({
  contextoUsuarioActual,
  trigger,
  audienciaAntes,
  usuariosBloqueados,
  operacion
}) {
  exigirTriggerAlcanzable(contextoUsuarioActual, trigger);
  const usuarios = new Map(usuariosBloqueados.map((usuario) => [
    Number(usuario.id),
    usuario
  ]));
  for (const usuarioId of operacion.altasUsuarios) {
    if (!alcanza(contextoUsuarioActual, usuarios.get(usuarioId))) {
      lanzarRelacionRestringida();
    }
  }
  const objetivos = new Set([
    ...operacion.retiradasIds,
    ...operacion.reincorporacionesIds
  ]);
  for (const relacion of audienciaAntes) {
    if (!objetivos.has(Number(relacion.id)) || relacion.tipo !== 'usuario') {
      continue;
    }
    if (!alcanza(contextoUsuarioActual, usuarios.get(Number(relacion.usuarioId)))) {
      lanzarRelacionRestringida();
    }
  }
}

function redactarRelacion(contexto, fila) {
  if (fila.tipo === 'manual') {
    return {
      relacionId: String(fila.id),
      tipo: 'manual',
      restringida: false,
      estadoParticipacion: fila.estado_participacion,
      email: fila.email_manual,
      nombre: fila.nombre_manual
    };
  }
  const usuario = {
    id: fila.usuario_id,
    usuario: fila.usuario_nombre_cuenta,
    nombre_mostrar: fila.usuario_nombre_mostrar,
    nombre_completo: fila.usuario_nombre_completo,
    tenant_id: fila.usuario_tenant_id,
    empresa_id: fila.usuario_empresa_id,
    sitio_id: fila.usuario_sitio_id
  };
  if (!alcanza(contexto, usuario)) {
    return {
      tipo: 'usuario',
      restringida: true,
      estadoParticipacion: fila.estado_participacion
    };
  }
  return {
    relacionId: String(fila.id),
    tipo: 'usuario',
    restringida: false,
    estadoParticipacion: fila.estado_participacion,
    usuario: {
      id: String(fila.usuario_id),
      nombre: fila.usuario_nombre_mostrar || fila.usuario_nombre_completo ||
        fila.usuario_nombre_cuenta,
      email: fila.usuario_email,
      activo: Boolean(fila.usuario_activo),
      emailValidado: Boolean(fila.usuario_email_validado),
      scope: scopeDto(usuario)
    }
  };
}

function fotografiaRelacion(relacion) {
  const base = {
    tipo: relacion.tipo,
    estadoParticipacion: relacion.estadoParticipacion
  };
  return relacion.tipo === 'manual'
    ? {
        ...base,
        buzonManual: relacion.emailManualCanonico,
        nombreManual: relacion.nombreManual
      }
    : base;
}

function alcanza(contexto, sujeto) {
  if (!sujeto) return false;
  const nivel = contexto?.nivelScope;
  const scope = scopeDto(sujeto);
  if (nivel === 'portal') return true;
  if (nivel === 'tenant') {
    return scope.tenantId !== null &&
      scope.tenantId === aId(contexto.tenantId);
  }
  if (nivel === 'empresa') {
    return scope.tenantId === aId(contexto.tenantId) &&
      scope.empresaId !== null && scope.empresaId === aId(contexto.empresaId);
  }
  if (nivel === 'sitio') {
    return scope.tenantId === aId(contexto.tenantId) &&
      scope.empresaId === aId(contexto.empresaId) &&
      scope.sitioId !== null && scope.sitioId === aId(contexto.sitioId);
  }
  return false;
}

function scopeDto(sujeto) {
  return {
    tenantId: aId(sujeto?.tenant_id ?? sujeto?.tenantId),
    empresaId: aId(sujeto?.empresa_id ?? sujeto?.empresaId),
    sitioId: aId(sujeto?.sitio_id ?? sujeto?.sitioId)
  };
}

function aId(valor) {
  return valor == null ? null : String(valor);
}

function actor(contexto, campo) {
  const id = contexto?.[campo] ?? contexto?.idUsuario;
  return { tipo: 'usuario', id: String(id) };
}

function actorEfectivo(contexto) {
  const idReal = contexto?.idUsuarioReal ?? contexto?.idUsuario;
  const idEfectivo = contexto?.idUsuario ?? idReal;
  return String(idReal) === String(idEfectivo)
    ? null
    : { tipo: 'usuario', id: String(idEfectivo) };
}

function lanzarNoDisponible() {
  throw Object.assign(
    new Error('El trigger no existe o queda fuera de tu alcance.'),
    { codigo: 'trigger_no_disponible', statusCode: 404 }
  );
}

function lanzarRelacionRestringida() {
  throw Object.assign(
    new Error('La relación destinataria ya no está dentro de tu alcance.'),
    { codigo: 'relacion_audiencia_correo_restringida', statusCode: 403 }
  );
}

function congelar(valor) {
  if (!valor || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  for (const hijo of Object.values(valor)) congelar(hijo);
  return Object.freeze(valor);
}
