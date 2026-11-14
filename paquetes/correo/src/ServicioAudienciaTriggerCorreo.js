import { normalizarNombrePresentacionCorreo, normalizarBuzonCorreo }
  from './NormalizadorBuzonCorreo.js';
import { ProyectorAudienciaEfectivaTriggerCorreo }
  from './ProyectorAudienciaEfectivaTriggerCorreo.js';
import {
  ErrorConflictoRevisionTrigger,
  MutadorRevisionDeclaracionTriggerSql
}
  from '../../triggers/src/MutadorRevisionDeclaracionTriggerSql.js';

export class ServicioAudienciaTriggerCorreo {
  constructor({
    repositorioAudiencia,
    fronteraTransaccional,
    mutadorRevision = new MutadorRevisionDeclaracionTriggerSql(),
    proyector = new ProyectorAudienciaEfectivaTriggerCorreo()
  }) {
    if (typeof repositorioAudiencia?.bloquearTriggerCorreoEnTransaccion !==
        'function' || typeof fronteraTransaccional?.ejecutar !== 'function') {
      throw new Error('La audiencia de correo requiere persistencia transaccional.');
    }
    this.repositorio = repositorioAudiencia;
    this.frontera = fronteraTransaccional;
    this.mutadorRevision = mutadorRevision;
    this.proyector = proyector;
  }

  agregarManual(entrada = {}, opciones = {}) {
    return this.mutar({
      triggerId: entrada.triggerId,
      revisionDeclaracion: entrada.revisionDeclaracion,
      altasManuales: [{
        email: entrada.email,
        nombre: entrada.nombre ?? null
      }]
    }, opciones);
  }

  agregarUsuario(entrada = {}, opciones = {}) {
    return this.mutar({
      triggerId: entrada.triggerId,
      revisionDeclaracion: entrada.revisionDeclaracion,
      altasUsuarios: [entrada.usuarioId]
    }, opciones);
  }

  retirar(entrada = {}, opciones = {}) {
    return this.mutar({
      triggerId: entrada.triggerId,
      revisionDeclaracion: entrada.revisionDeclaracion,
      retiradasIds: [entrada.relacionId]
    }, opciones);
  }

  reincorporar(entrada = {}, opciones = {}) {
    return this.mutar({
      triggerId: entrada.triggerId,
      revisionDeclaracion: entrada.revisionDeclaracion,
      reincorporacionesIds: [entrada.relacionId]
    }, opciones);
  }

  async mutar({
    triggerId,
    revisionDeclaracion,
    altasManuales = [],
    altasUsuarios = [],
    retiradasIds = [],
    reincorporacionesIds = []
  } = {}, {
    conexion = null,
    autorizarTriggerEnTransaccion = null,
    autorizarEnTransaccion = null,
    despuesDeMutarEnTransaccion = null
  } = {}) {
    const idTrigger = enteroPositivo(triggerId, 'triggerId');
    const revision = exigirRevisionDeclaracion(revisionDeclaracion);
    const manuales = altasManuales.map(normalizarAltaManual);
    const usuariosAlta = idsUnicos(altasUsuarios, 'usuarioId');
    const retiradas = idsUnicos(retiradasIds, 'relacionId');
    const reincorporaciones = idsUnicos(reincorporacionesIds, 'relacionId');
    exigirLoteCoherente({ manuales, usuariosAlta, retiradas, reincorporaciones });

    const ejecutar = async (conexionTrabajo) => {
      const conexion = conexionTrabajo;
      const limite = await this.repositorio.leerLimiteEnTransaccion({ conexion });
      const relacionesPrevias = await this.repositorio.buscarRelacionesCrudasPorIds(
        [...retiradas, ...reincorporaciones],
        { conexion }
      );
      const usuariosObjetivo = idsUnicos([
        ...usuariosAlta,
        ...relacionesPrevias
          .filter((fila) => fila.usuario_id != null)
          .map((fila) => fila.usuario_id)
      ], 'usuarioId');
      const usuarios = await this.repositorio.buscarUsuariosEnTransaccion(
        usuariosObjetivo,
        { conexion }
      );
      const trigger = await this.repositorio.bloquearTriggerCorreoEnTransaccion(
        idTrigger,
        { conexion }
      );
      if (autorizarTriggerEnTransaccion) {
        await autorizarTriggerEnTransaccion({ conexion, trigger });
      }
      exigirTriggerCorreo(trigger, revision);
      const audienciaAntes = await this.repositorio.listarEnTransaccion(
        { triggerId: idTrigger, bloquear: true },
        { conexion }
      );
      if (autorizarEnTransaccion) {
        await autorizarEnTransaccion({
          conexion,
          trigger,
          audienciaAntes,
          usuariosBloqueados: usuarios,
          operacion: Object.freeze({
            altasManuales: manuales,
            altasUsuarios: usuariosAlta,
            retiradasIds: retiradas,
            reincorporacionesIds: reincorporaciones
          })
        });
      }
      validarRelacionesObjetivo({
        triggerId: idTrigger,
        audiencia: audienciaAntes,
        retiradas,
        reincorporaciones
      });
      validarUsuariosAlta(usuariosAlta, usuarios);
      validarAltasNoDuplicadas({ audienciaAntes, manuales, usuariosAlta, retiradas });

      const idsAntes = new Set(audienciaAntes.map((relacion) => Number(relacion.id)));
      const retiradasExistentes = retiradas.filter((id) => idsAntes.has(id));
      const totalFinal = audienciaAntes.length - retiradasExistentes.length +
        manuales.length + usuariosAlta.length;
      const hayReincorporacionReal = audienciaAntes.some((relacion) =>
        reincorporaciones.includes(Number(relacion.id)) &&
        relacion.estadoParticipacion === 'desuscrita');
      const ampliaAudiencia = manuales.length > 0 || usuariosAlta.length > 0 ||
        hayReincorporacionReal;
      if (ampliaAudiencia && totalFinal > limite) {
        throw errorDominio(
          'audiencia_trigger_correo_sobre_limite',
          `La audiencia resultante supera el límite durable de ${limite} relaciones.`,
          409
        );
      }

      for (const relacionId of retiradas) {
        await this.repositorio.retirarEnTransaccion(relacionId, { conexion });
      }
      const creadas = [];
      for (const manual of manuales) {
        creadas.push(await this.repositorio.insertarManualEnTransaccion({
          triggerId: idTrigger,
          emailPresentacion: manual.presentacion,
          emailCanonico: manual.canonico,
          nombreManual: manual.nombre,
          versionNormalizacion: manual.version
        }, { conexion }));
      }
      for (const usuarioId of usuariosAlta) {
        creadas.push(await this.repositorio.insertarUsuarioEnTransaccion({
          triggerId: idTrigger,
          usuarioId
        }, { conexion }));
      }
      let reincorporadas = 0;
      for (const relacionId of reincorporaciones) {
        if (await this.repositorio.reincorporarEnTransaccion(
          relacionId,
          { conexion }
        )) reincorporadas += 1;
      }

      const huboMutacion = retiradas.length > 0 || creadas.length > 0 ||
        reincorporadas > 0;
      if (!huboMutacion) {
        const resultado = resultadoMutacion({
          trigger,
          audiencia: audienciaAntes,
          creadas,
          retiradas: [],
          reincorporadas: [],
          desactivadoAutomaticamente: false
        });
        return resultado;
      }
      const audienciaDespues = await this.repositorio.listarEnTransaccion(
        { triggerId: idTrigger },
        { conexion }
      );
      const sinRelacionesActivas = audienciaDespues.every(
        (relacion) => relacion.estadoParticipacion !== 'activa'
      );
      const desactivadoAutomaticamente = Boolean(trigger.activo) &&
        sinRelacionesActivas;
      await this.mutadorRevision.actualizar({
        ejecutor: conexion,
        idTrigger,
        revisionEsperada: revision,
        cambios: desactivadoAutomaticamente ? { activo: 0 } : {}
      });
      const resultado = resultadoMutacion({
        trigger: {
          ...trigger,
          activo: desactivadoAutomaticamente ? 0 : trigger.activo,
          revision_declaracion: revision + 1
        },
        audiencia: audienciaDespues,
        creadas,
        retiradas: audienciaAntes.filter((relacion) =>
          retiradas.includes(Number(relacion.id))),
        reincorporadas: audienciaDespues.filter((relacion) =>
          reincorporaciones.includes(Number(relacion.id)) &&
          audienciaAntes.find((anterior) => anterior.id === relacion.id)
            ?.estadoParticipacion === 'desuscrita'),
        desactivadoAutomaticamente
      });
      if (despuesDeMutarEnTransaccion) {
        await despuesDeMutarEnTransaccion({
          conexion,
          triggerAntes: trigger,
          resultado
        });
      }
      return resultado;
    };
    return conexion ? ejecutar(conexion) : this.frontera.ejecutar(ejecutar);
  }

  async proyectarEfectiva({ triggerId } = {}) {
    const idTrigger = enteroPositivo(triggerId, 'triggerId');
    return this.frontera.ejecutar(async (conexion) => {
      const trigger = await this.repositorio.bloquearTriggerCorreoEnTransaccion(
        idTrigger,
        { conexion }
      );
      exigirTriggerCorreo(trigger);
      const filas = await this.repositorio.listarResolucionEnTransaccion(
        idTrigger,
        { conexion }
      );
      return this.proyector.proyectar(filas);
    });
  }
}

function normalizarAltaManual(entrada) {
  const buzon = normalizarBuzonCorreo(entrada?.email);
  const nombre = entrada?.nombre == null
    ? null
    : normalizarNombrePresentacionCorreo(String(entrada.nombre));
  return Object.freeze({ ...buzon, nombre: nombre || null });
}

function exigirLoteCoherente({ manuales, usuariosAlta, retiradas, reincorporaciones }) {
  if (manuales.length + usuariosAlta.length + retiradas.length +
      reincorporaciones.length === 0) {
    throw errorDominio(
      'mutacion_audiencia_correo_vacia',
      'La mutación de audiencia no contiene ninguna operación.',
      400
    );
  }
  if (new Set(manuales.map((item) => item.canonico)).size !== manuales.length ||
      retiradas.some((id) => reincorporaciones.includes(id))) {
    throw errorDominio(
      'mutacion_audiencia_correo_ambigua',
      'La mutación de audiencia contiene identidades repetidas o contradictorias.',
      400
    );
  }
}

function exigirTriggerCorreo(trigger, revisionEsperada = null) {
  if (!trigger) {
    throw errorDominio('trigger_no_encontrado', 'El trigger no existe.', 404);
  }
  if (trigger.tipo !== 'correo') {
    throw errorDominio(
      'audiencia_tipo_trigger_incompatible',
      'Solo un trigger de correo puede declarar audiencia.',
      409
    );
  }
  if (revisionEsperada !== null &&
      Number(trigger.revision_declaracion) !== revisionEsperada) {
    throw new ErrorConflictoRevisionTrigger({
      idTrigger: Number(trigger.id),
      revisionEsperada,
      revisionActual: Number(trigger.revision_declaracion)
    });
  }
}

function validarRelacionesObjetivo({
  triggerId,
  audiencia,
  retiradas,
  reincorporaciones
}) {
  const porId = new Map(audiencia.map((relacion) => [Number(relacion.id), relacion]));
  for (const id of [...retiradas, ...reincorporaciones]) {
    if (!porId.has(id)) {
      throw errorDominio(
        'relacion_audiencia_correo_no_encontrada',
        `La relación destinataria ${id} no pertenece al trigger ${triggerId}.`,
        404
      );
    }
  }
}

function validarUsuariosAlta(ids, filas) {
  const porId = new Map(filas.map((fila) => [Number(fila.id), fila]));
  for (const id of ids) {
    const usuario = porId.get(id);
    if (!usuario) {
      throw errorDominio(
        'usuario_destinatario_no_encontrado',
        'El usuario destinatario no existe.',
        404
      );
    }
    if (!Boolean(usuario.activo)) {
      throw errorDominio(
        'usuario_destinatario_no_elegible',
        'El usuario destinatario debe estar activo.',
        409
      );
    }
  }
}

function validarAltasNoDuplicadas({
  audienciaAntes,
  manuales,
  usuariosAlta,
  retiradas
}) {
  const retiradasSet = new Set(retiradas);
  const existentes = audienciaAntes.filter(
    (relacion) => !retiradasSet.has(Number(relacion.id))
  );
  const manualesExistentes = new Set(existentes
    .filter((relacion) => relacion.tipo === 'manual')
    .map((relacion) => relacion.emailManualCanonico));
  const usuariosExistentes = new Set(existentes
    .filter((relacion) => relacion.tipo === 'usuario')
    .map((relacion) => Number(relacion.usuarioId)));
  if (manuales.some((item) => manualesExistentes.has(item.canonico)) ||
      usuariosAlta.some((id) => usuariosExistentes.has(id))) {
    throw errorDominio(
      'destinatario_trigger_correo_duplicado',
      'El destinatario ya pertenece a la audiencia del trigger.',
      409
    );
  }
}

function resultadoMutacion({
  trigger,
  audiencia,
  creadas,
  retiradas,
  reincorporadas,
  desactivadoAutomaticamente
}) {
  return Object.freeze({
    triggerId: String(trigger.id),
    revisionDeclaracion: Number(trigger.revision_declaracion),
    activo: Boolean(trigger.activo),
    audiencia: Object.freeze([...audiencia]),
    relacionesCreadas: Object.freeze([...creadas]),
    relacionesRetiradas: Object.freeze([...retiradas]),
    relacionesReincorporadas: Object.freeze([...reincorporadas]),
    reincorporadas: reincorporadas.length,
    desactivadoAutomaticamente
  });
}

function idsUnicos(valores, campo) {
  const ids = valores.map((valor) => enteroPositivo(valor, campo));
  if (new Set(ids).size !== ids.length) {
    throw errorDominio(
      'mutacion_audiencia_correo_ambigua',
      `${campo} aparece repetido en la mutación.`,
      400
    );
  }
  return [...ids].sort((a, b) => a - b);
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw errorDominio(
      'identidad_audiencia_correo_invalida',
      `${campo} debe ser un entero positivo seguro.`,
      400
    );
  }
  return numero;
}

function exigirRevisionDeclaracion(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw errorDominio(
      'trigger_revision_requerida',
      'La revisión declarativa es obligatoria para modificar la audiencia.',
      400
    );
  }
  return numero;
}

function errorDominio(codigo, mensaje, statusCode) {
  return Object.assign(new Error(mensaje), { codigo, statusCode });
}
