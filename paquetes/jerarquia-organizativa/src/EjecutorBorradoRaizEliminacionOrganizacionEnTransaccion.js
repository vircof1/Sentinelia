export class EjecutorBorradoRaizEliminacionOrganizacionEnTransaccion {
  constructor({
    repositorioEliminaciones,
    servicioReconciliacionBajaUsuarioTriggerCorreo = null
  } = {}) {
    exigirPuerto(repositorioEliminaciones, 'eliminarRaizEnTransaccion');
    exigirPuerto(
      repositorioEliminaciones,
      'verificarPostcondicionesEliminacionEnTransaccion'
    );
    if (servicioReconciliacionBajaUsuarioTriggerCorreo &&
        typeof servicioReconciliacionBajaUsuarioTriggerCorreo
          .reconciliarEnTransaccion !== 'function') {
      throw new Error('El borrado recibió un reconciliador de correo inválido.');
    }
    this.repositorioEliminaciones = repositorioEliminaciones;
    this.servicioReconciliacionBajaUsuarioTriggerCorreo =
      servicioReconciliacionBajaUsuarioTriggerCorreo;
  }

  async ejecutarEnTransaccion({ preparacion } = {}, { conexion } = {}) {
    if (!conexion || typeof conexion !== 'object') {
      throw new TypeError('El borrado organizativo exige conexión prestada.');
    }
    const entrada = normalizarPreparacion(preparacion);
    const eliminacionRaiz = await this.repositorioEliminaciones
      .eliminarRaizEnTransaccion(
        { raiz: entrada.inventario.raiz },
        { conexion }
      );
    const reconciliacionCorreo =
      this.servicioReconciliacionBajaUsuarioTriggerCorreo &&
      entrada.inventario.preparacionAudienciaCorreo
        ? await this.servicioReconciliacionBajaUsuarioTriggerCorreo
          .reconciliarEnTransaccion(
            entrada.inventario.preparacionAudienciaCorreo,
            contextoActor(entrada.inventario.comando),
            { conexion }
          )
        : null;
    const postcondiciones = await this.repositorioEliminaciones
      .verificarPostcondicionesEliminacionEnTransaccion({
        raiz: entrada.inventario.raiz,
        agenteIds: entrada.inventario.agentes.map(({ id }) => id),
        usuarioIds: entrada.usuariosAfectados,
        operacionId: entrada.inventario.comando.identidades.operacionId,
        obligacionesEsperadas: conteo(
          entrada.impactoFinal,
          'obligaciones_postcommit'
        ),
        invalidacionesTecnicasEsperadas: String(
          entrada.preparacionesAgentes.filter(
            ({ neutralizacionSesion }) => neutralizacionSesion.operacion !== null
          ).length
        ),
        triggersCorreoReconciliados:
          reconciliacionCorreo?.triggersDesactivados || [],
        ejecucionesCorreoAceptadasPreservadas:
          entrada.ejecucionesTriggers?.idsCorreoAceptadoPreservadas || [],
        registrosDdnsEliminados:
          entrada.preparacionDdns?.registrosObjetivoIds || []
      }, { conexion });
    return congelar({
      estado: 'raiz_eliminada_en_transaccion',
      preparacion: entrada,
      eliminacionRaiz,
      reconciliacionCorreo,
      postcondiciones
    });
  }
}

function contextoActor(comando) {
  const autorizacion = comando.fotografiaAutorizacion;
  const idUsuarioReal = String(autorizacion.actorReal.usuarioId);
  const idUsuario = String(autorizacion.actorEfectivo.usuarioId);
  return Object.freeze({
    idUsuarioReal,
    idUsuario,
    impersonacionActiva: idUsuarioReal !== idUsuario
  });
}

function normalizarPreparacion(entrada) {
  if (!entrada?.inventario?.raiz || !entrada?.inventario?.comando ||
      !Array.isArray(entrada?.inventario?.agentes) ||
      !Array.isArray(entrada?.usuariosAfectados) ||
      !Array.isArray(entrada?.preparacionesAgentes) ||
      !entrada?.ejecucionesTriggers ||
      !Array.isArray(entrada?.obligacionesRaiz) || !entrada?.impactoFinal) {
    throw new TypeError('La preparación 8b no está completa.');
  }
  const agentesInventariados = entrada.inventario.agentes.map(({ id }) => String(id));
  const agentesPreparados = entrada.preparacionesAgentes.map(({ agenteId }) =>
    String(agenteId)
  );
  if (agentesInventariados.length !== agentesPreparados.length ||
      agentesInventariados.some((id, indice) => id !== agentesPreparados[indice])) {
    throw new TypeError('No todos los agentes inventariados fueron preparados en orden.');
  }
  if (conteo(entrada.inventario.impactoFinal, 'raiz') !== '1' ||
      conteo(entrada.impactoFinal, 'raiz') !== '1') {
    throw new TypeError('El impacto final no conserva una única raíz eliminable.');
  }
  if (!entrada.obligacionesRaiz.some(
    ({ tipo }) => tipo === 'retirar_estructura_organizacion_redis'
  )) {
    throw new TypeError('La retirada postcommit de la raíz no fue preparada.');
  }
  for (const preparacion of entrada.preparacionesAgentes) {
    if (!preparacion?.neutralizacionSesion ||
        !preparacion?.postcondicionesEsperadas) {
      throw new TypeError('Una preparación de agente está incompleta.');
    }
  }
  const idsPreservadas = entrada.preparacionesAgentes.flatMap(
    ({ ejecucionesTriggers }) =>
      ejecucionesTriggers?.idsCorreoAceptadoPreservadas || []
  ).map(String);
  if (String(entrada.ejecucionesTriggers.eliminadas) !== sumarPreparaciones(
    entrada.preparacionesAgentes,
    'eliminadas'
  ) || String(entrada.ejecucionesTriggers.correoAceptadoPreservadas) !==
      sumarPreparaciones(
        entrada.preparacionesAgentes,
        'correoAceptadoPreservadas'
      ) || !Array.isArray(
        entrada.ejecucionesTriggers.idsCorreoAceptadoPreservadas
      ) || idsPreservadas.join(',') !==
      entrada.ejecucionesTriggers.idsCorreoAceptadoPreservadas.map(String).join(',')) {
    throw new TypeError('El agregado organizativo de ejecuciones no es íntegro.');
  }
  return entrada;
}

function sumarPreparaciones(preparaciones, campo) {
  return preparaciones.reduce((total, preparacion) =>
    total + BigInt(preparacion.ejecucionesTriggers?.[campo] ?? 0), 0n
  ).toString();
}

function conteo(impacto, categoria) {
  const encontrado = impacto?.conteos?.find(
    (actual) => actual.categoria === categoria
  );
  const cantidad = String(encontrado?.cantidad ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(cantidad)) {
    throw new TypeError(`El impacto no contiene el conteo ${categoria}.`);
  }
  return cantidad;
}

function exigirPuerto(puerto, metodo) {
  if (typeof puerto?.[metodo] !== 'function') {
    throw new Error(`El borrado organizativo exige ${metodo}().`);
  }
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
