import { createHash } from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';

export class ErrorRefederacionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorRefederacionFederacion';
    this.codigo = codigo;
  }
}

export class ServicioRefederacionFederacion {
  constructor({
    repositorioOcurrencias,
    repositorioOutbox,
    guardiaActivacion = null
  } = {}) {
    exigirMetodo(
      repositorioOcurrencias,
      'registrarOcurrenciaRefederadaEnTransaccion',
      'repositorioOcurrencias'
    );
    exigirMetodo(repositorioOutbox, 'encolarPosicionesEnTransaccion', 'repositorioOutbox');
    if (typeof repositorioOcurrencias?.clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La refederación reintentable requiere SQL operativo.');
    }
    this.repositorioOcurrencias = repositorioOcurrencias;
    this.repositorioOutbox = repositorioOutbox;
    this.clienteSql = repositorioOcurrencias.clienteSql;
    if (guardiaActivacion !== null &&
        (typeof guardiaActivacion?.exigirActiva !== 'function' ||
          typeof guardiaActivacion?.estaActiva !== 'function')) {
      throw new Error('guardiaActivacion debe implementar exigirActiva() y estaActiva().');
    }
    this.guardiaActivacion = guardiaActivacion;
  }

  async procesarPendientes({ limite = 100 } = {}) {
    if (this.guardiaActivacion && !await this.guardiaActivacion.estaActiva()) {
      return Object.freeze({ estado: 'omitidaFederacionDesactivada', encoladas: 0 });
    }
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await this.procesarPendientesEnTransaccion(
        { limite },
        { conexion }
      );
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }

  async registrarDesdeRecepcionEnTransaccion({
    lote,
    entrega,
    inboxId,
    proyeccionId,
    contribucionId
  } = {}, { conexion } = {}) {
    await this.guardiaActivacion?.exigirActiva('registrar_refederacion');
    exigirConexion(conexion);
    const ocurrencia = entrega?.ocurrencia;
    const procedencia = entrega?.procedencia;
    if (!ocurrencia || !procedencia || !proyeccionId || !contribucionId || !inboxId) {
      throw new ErrorRefederacionFederacion(
        'recepcion_refederable_incompleta',
        'La refederación exige ocurrencia, procedencia, proyección, contribución e inbox durables.'
      );
    }
    const recibidaEnUtc = await cargarInstanteRecepcion(conexion, inboxId);
    if (ocurrencia.operacion === 'actualizacion') {
      return this.#registrarActualizacion({
        lote,
        ocurrencia,
        procedencia,
        inboxId,
        proyeccionId,
        contribucionId,
        recibidaEnUtc
      }, conexion);
    }
    return this.#registrarTerminal({
      ocurrencia,
      procedencia,
      inboxId,
      proyeccionId,
      contribucionId,
      recibidaEnUtc
    }, conexion);
  }

  async #registrarActualizacion(entrada, conexion) {
    if (await existeBarreraTerminal(conexion, entrada)) {
      return resultado('bloqueadaPorRetirada');
    }
    const destinos = await listarDestinosNuevos(conexion, entrada);
    const visitadas = new Set(entrada.procedencia.recorridoInstalaciones);
    const permitidos = destinos.filter((destino) =>
      !visitadas.has(destino.installationDestinoId));
    if (permitidos.length === 0) return resultado('sinDestinos');
    const captura = await this.repositorioOcurrencias
      .registrarOcurrenciaRefederadaEnTransaccion({
        ocurrencia: entrada.ocurrencia,
        destinos: permitidos.map((destino) => destinoCaptura(destino, entrada.ocurrencia))
      }, { conexion });
    const ahora = await ahoraSql(conexion);
    const canonica = canonicalizarJsonFederacion(entrada.procedencia);
    const huella = sha256(canonica);
    const encolables = [];
    for (const posicion of captura.posiciones) {
      if (posicion.posicionFlujo === null) continue;
      const destino = permitidos.find((item) =>
        item.flujoId === posicion.flujoId &&
        item.generacionId === posicion.generacionId);
      await insertarDescendiente(conexion, {
        ...entrada,
        ...destino,
        ...posicion,
        procedenciaCanonica: canonica,
        procedenciaSha256: huella,
        recibidaEnUtc: entrada.recibidaEnUtc,
        ahora
      });
      encolables.push(posicion);
    }
    if (encolables.length > 0) {
      await this.repositorioOutbox.encolarPosicionesEnTransaccion(encolables, { conexion });
    }
    return Object.freeze({
      estado: captura.estado,
      totalDescendientes: encolables.length,
      totalCiclosEvitados: destinos.length - permitidos.length
    });
  }

  async #registrarTerminal(entrada, conexion) {
    const visitadas = new Set(entrada.procedencia.recorridoInstalaciones);
    const descendientes = (await listarDescendientesAfectados(conexion, entrada))
      .filter((descendiente) => !visitadas.has(descendiente.installationDestinoId));
    if (descendientes.length === 0) return resultado('sinDescendientes');
    const ahora = await ahoraSql(conexion);
    for (const descendiente of descendientes) {
      await insertarObligacion(conexion, { ...entrada, ...descendiente, ahora });
    }
    return this.procesarPendientesEnTransaccion({ limite: 1000 }, { conexion });
  }

  async procesarPendientesEnTransaccion({ limite = 100 } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const maximo = enteroAcotado(limite, 1, 1000);
    const pendientes = await cargarPendientes(conexion, maximo);
    let encoladas = 0;
    let absorbidas = 0;
    for (const pendiente of pendientes) {
      const destino = await resolverDestinoActual(conexion, pendiente.flujo_id);
      if (!destino) continue;
      const ocurrencia = parsearCanonicoTestimoniado({
        canonico: pendiente.ocurrencia_terminal_canonica,
        huella: pendiente.ocurrencia_terminal_sha256,
        codigo: 'terminal_refederado_no_recuperable'
      });
      const captura = await this.repositorioOcurrencias
        .registrarOcurrenciaRefederadaEnTransaccion({
          ocurrencia,
          destinos: [destinoCaptura(destino, ocurrencia)]
      }, { conexion });
      const posicion = captura.posiciones[0];
      if (posicion.posicionFlujo === null) {
        if (posicion.estado === 'pendienteCorte') continue;
        if (posicion.estado !== 'absorbidaCorte') {
          throw new ErrorRefederacionFederacion(
            'terminal_refederado_sin_posicion',
            'La deuda terminal no obtuvo posición ni una absorción demostrable por el corte.'
          );
        }
        const ahora = await ahoraSql(conexion);
        await cerrarObligacionAbsorbida(conexion, {
          pendiente,
          generacionId: destino.generacionId,
          ahora
        });
        absorbidas += 1;
        continue;
      }
      const procedencia = parsearCanonicoTestimoniado({
        canonico: pendiente.procedencia_base_canonica,
        huella: pendiente.procedencia_base_sha256,
        codigo: 'procedencia_terminal_no_recuperable'
      });
      const ahora = await ahoraSql(conexion);
      const procedenciaCanonica = canonicalizarJsonFederacion(procedencia);
      await insertarDescendiente(conexion, {
        proyeccionId: pendiente.proyeccion_origen_id,
        contribucionId: pendiente.contribucion_origen_id,
        inboxId: pendiente.inbox_terminal_id,
        ocurrencia,
        procedencia,
        procedenciaCanonica,
        procedenciaSha256: sha256(procedenciaCanonica),
        recibidaEnUtc: pendiente.recibida_origen_en_utc,
        relacionDestinoId: destino.relacionDestinoId,
        installationDestinoId: destino.installationDestinoId,
        ...posicion,
        ahora
      });
      await this.repositorioOutbox.encolarPosicionesEnTransaccion([posicion], { conexion });
      const [actualizacion] = await conexion.execute(
        `UPDATE obligaciones_retirada_refederacion_federacion
            SET estado='encolada',generacion_destino_id=?,posicion_flujo=?,
                encolada_en_utc=?
          WHERE id=? AND estado='pendiente'`,
        [destino.generacionId, posicion.posicionFlujo, ahora, pendiente.id]
      );
      if (actualizacion.affectedRows !== 1) {
        throw new ErrorRefederacionFederacion(
          'obligacion_retirada_concurrente',
          'La deuda de retirada cambió mientras se intentaba encolarla.'
        );
      }
      encoladas += 1;
    }
    return Object.freeze({
      estado: pendientes.length === 0 ? 'sinPendientes' : 'procesadas',
      totalPendientes: pendientes.length,
      totalEncoladas: encoladas,
      totalAbsorbidas: absorbidas
    });
  }
}

async function cerrarObligacionAbsorbida(conexion, { pendiente, generacionId, ahora }) {
  const [actualizacion] = await conexion.execute(
    `UPDATE obligaciones_retirada_refederacion_federacion
        SET estado='absorbida',generacion_destino_id=?,absorbida_en_utc=?
      WHERE id=? AND estado='pendiente'`,
    [generacionId, ahora, pendiente.id]
  );
  if (actualizacion.affectedRows !== 1) {
    throw new ErrorRefederacionFederacion(
      'obligacion_retirada_concurrente',
      'La deuda de retirada cambió mientras se declaraba absorbida por el corte.'
    );
  }
}

async function listarDestinosNuevos(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT f.flujo_id,f.generacion_activa_id,r.relacion_id,
            r.installation_remota_id,f.scope_nivel,f.scope_tenant_id,
            f.scope_empresa_id,f.scope_sitio_id
       FROM proyecciones_federacion p
       JOIN flujos_federacion f
         ON f.direccion='emision' AND f.familia=p.familia
        AND f.version_familia=? AND f.generacion_activa_id IS NOT NULL
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=f.generacion_activa_id
        AND g.estado NOT IN ('cancelada','sustituida')
       JOIN cortes_iniciales_generaciones_federacion ci
         ON ci.flujo_id=f.flujo_id AND ci.generacion_id=g.generacion_id
        AND ci.estado='cerrado'
       JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
       JOIN estado_concesion_relaciones_federacion e
         ON e.relacion_id=r.relacion_id
       JOIN revisiones_concesion_federacion v
         ON v.revision_id=e.revision_efectiva_actual_id
        AND v.relacion_id=r.relacion_id AND v.papel='efectiva'
        AND v.estado='vigente' AND v.finalizada_en_utc IS NULL
       JOIN selectores_revision_concesion_federacion s
         ON s.revision_id=v.revision_id AND s.familia=p.familia
        AND s.permite_refederacion=1
      WHERE p.proyeccion_id=?
        AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
        AND r.estado_identidad='valida'
        AND r.estado_compatibilidad IN ('compatible','compatibleParcial')
        AND JSON_CONTAINS(s.niveles_scope,JSON_QUOTE(p.scope_nivel))
        AND (f.scope_tenant_id IS NULL OR f.scope_tenant_id=p.scope_tenant_id)
        AND (f.scope_empresa_id IS NULL OR f.scope_empresa_id=p.scope_empresa_id)
        AND (f.scope_sitio_id IS NULL OR f.scope_sitio_id=p.scope_sitio_id)
        AND NOT EXISTS (
          SELECT 1 FROM descendientes_refederacion_federacion d
           WHERE d.inbox_ocurrencia_id=? AND d.flujo_destino_id=f.flujo_id
             AND d.generacion_destino_id=g.generacion_id
        )
      FOR UPDATE`,
    [entrada.ocurrencia.familiaVersion, entrada.proyeccionId, entrada.inboxId]
  );
  return filas.map((fila) => ({
    relacionDestinoId: fila.relacion_id,
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_activa_id,
    installationDestinoId: fila.installation_remota_id
  }));
}

async function listarDescendientesAfectados(conexion, entrada) {
  const filtro = entrada.ocurrencia.operacion === 'retirada'
    ? 'd.proyeccion_origen_id=?'
    : 'd.proyeccion_origen_id=? AND d.contribucion_origen_id=?';
  const parametros = entrada.ocurrencia.operacion === 'retirada'
    ? [entrada.proyeccionId]
    : [entrada.proyeccionId, entrada.contribucionId];
  const [filas] = await conexion.execute(
    `SELECT DISTINCT d.flujo_destino_id,d.installation_destino_id
       FROM descendientes_refederacion_federacion d
      WHERE ${filtro}
      FOR UPDATE`,
    parametros
  );
  return filas.map((fila) => ({
    flujoDestinoId: fila.flujo_destino_id,
    installationDestinoId: fila.installation_destino_id
  }));
}

async function existeBarreraTerminal(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT
       EXISTS(SELECT 1 FROM retiradas_origen_proyecciones_federacion
               WHERE proyeccion_id=?) AS retirada,
       EXISTS(SELECT 1 FROM salidas_contribuciones_federacion
               WHERE contribucion_id=?) AS salida`,
    [entrada.proyeccionId, entrada.contribucionId]
  );
  return Boolean(filas[0]?.retirada || filas[0]?.salida);
}

async function insertarDescendiente(conexion, entrada) {
  try {
    await conexion.execute(
      `INSERT INTO descendientes_refederacion_federacion (
         proyeccion_origen_id,contribucion_origen_id,inbox_ocurrencia_id,
         recibida_origen_en_utc,
         relacion_destino_id,flujo_destino_id,generacion_destino_id,
         posicion_flujo,installation_destino_id,operacion,
         procedencia_base_canonica,procedencia_base_sha256,
         longitud_recorrido_base,registrada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        entrada.proyeccionId, entrada.contribucionId, entrada.inboxId,
        entrada.recibidaEnUtc,
        entrada.relacionDestinoId, entrada.flujoId, entrada.generacionId,
        entrada.posicionFlujo, entrada.installationDestinoId,
        entrada.ocurrencia.operacion, entrada.procedenciaCanonica,
        entrada.procedenciaSha256,
        entrada.procedencia.recorridoInstalaciones.length, entrada.ahora
      ]
    );
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const [filas] = await conexion.execute(
      `SELECT proyeccion_origen_id,contribucion_origen_id,inbox_ocurrencia_id,
              installation_destino_id,operacion,procedencia_base_sha256
         FROM descendientes_refederacion_federacion
        WHERE flujo_destino_id=? AND generacion_destino_id=?
          AND posicion_flujo=? FOR UPDATE`,
      [entrada.flujoId, entrada.generacionId, entrada.posicionFlujo]
    );
    const existente = filas[0];
    if (!existente ||
        existente.proyeccion_origen_id !== entrada.proyeccionId ||
        existente.contribucion_origen_id !== entrada.contribucionId ||
        String(existente.inbox_ocurrencia_id) !== String(entrada.inboxId) ||
        existente.installation_destino_id !== entrada.installationDestinoId ||
        existente.operacion !== entrada.ocurrencia.operacion ||
        !Buffer.from(existente.procedencia_base_sha256)
          .equals(Buffer.from(entrada.procedenciaSha256))) {
      throw new ErrorRefederacionFederacion(
        'descendiente_refederado_divergente',
        'La posición descendiente ya testimonia otra procedencia inmutable.'
      );
    }
  }
}

async function insertarObligacion(conexion, entrada) {
  const ocurrenciaCanonica = canonicalizarJsonFederacion(entrada.ocurrencia);
  const procedenciaCanonica = canonicalizarJsonFederacion(entrada.procedencia);
  try {
    await conexion.execute(
      `INSERT INTO obligaciones_retirada_refederacion_federacion (
         proyeccion_origen_id,contribucion_origen_id,inbox_terminal_id,
         ocurrencia_terminal_canonica,ocurrencia_terminal_sha256,
         procedencia_base_canonica,procedencia_base_sha256,
         recibida_origen_en_utc,flujo_destino_id,operacion,estado,creada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,'pendiente',?)`,
      [
        entrada.proyeccionId, entrada.contribucionId, entrada.inboxId,
        ocurrenciaCanonica, sha256(ocurrenciaCanonica),
        procedenciaCanonica, sha256(procedenciaCanonica), entrada.recibidaEnUtc,
        entrada.flujoDestinoId, entrada.ocurrencia.operacion, entrada.ahora
      ]
    );
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const [filas] = await conexion.execute(
      `SELECT proyeccion_origen_id,operacion,ocurrencia_terminal_sha256,
              procedencia_base_sha256
         FROM obligaciones_retirada_refederacion_federacion
        WHERE inbox_terminal_id=? AND flujo_destino_id=?
          AND contribucion_origen_id=? FOR UPDATE`,
      [entrada.inboxId, entrada.flujoDestinoId, entrada.contribucionId]
    );
    const existente = filas[0];
    if (!existente || existente.proyeccion_origen_id !== entrada.proyeccionId ||
        existente.operacion !== entrada.ocurrencia.operacion ||
        !Buffer.from(existente.ocurrencia_terminal_sha256)
          .equals(sha256(ocurrenciaCanonica)) ||
        !Buffer.from(existente.procedencia_base_sha256)
          .equals(sha256(procedenciaCanonica))) {
      throw new ErrorRefederacionFederacion(
        'obligacion_retirada_divergente',
        'La deuda terminal conocida no puede reinterpretar ocurrencia ni procedencia.'
      );
    }
  }
}

async function cargarPendientes(conexion, limite) {
  const [filas] = await conexion.execute(
    `SELECT id,proyeccion_origen_id,contribucion_origen_id,
            inbox_terminal_id,flujo_destino_id,ocurrencia_terminal_canonica,
            ocurrencia_terminal_sha256,procedencia_base_canonica,
            procedencia_base_sha256,recibida_origen_en_utc
       FROM obligaciones_retirada_refederacion_federacion
      WHERE estado='pendiente'
      ORDER BY creada_en_utc,id
      LIMIT ? FOR UPDATE SKIP LOCKED`,
    [limite]
  );
  return filas;
}

async function resolverDestinoActual(conexion, flujoId) {
  const [filas] = await conexion.execute(
    `SELECT f.flujo_id,f.generacion_activa_id,r.relacion_id,
            r.installation_remota_id
       FROM flujos_federacion f
       JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=f.generacion_activa_id
        AND g.estado NOT IN ('cancelada','sustituida')
       JOIN cortes_iniciales_generaciones_federacion ci
         ON ci.flujo_id=f.flujo_id AND ci.generacion_id=g.generacion_id
        AND ci.estado='cerrado'
      WHERE f.flujo_id=? AND f.direccion='emision'
        AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
        AND r.estado_identidad='valida'
        AND r.estado_compatibilidad IN ('compatible','compatibleParcial')
      FOR UPDATE`,
    [flujoId]
  );
  if (!filas[0]) return null;
  return {
    relacionDestinoId: filas[0].relacion_id,
    flujoId: filas[0].flujo_id,
    generacionId: filas[0].generacion_activa_id,
    installationDestinoId: filas[0].installation_remota_id
  };
}

async function cargarInstanteRecepcion(conexion, inboxId) {
  const [filas] = await conexion.execute(
    `SELECT recibida_en_utc FROM inbox_ocurrencias_federacion WHERE id=?`,
    [inboxId]
  );
  if (!filas[0]) {
    throw new ErrorRefederacionFederacion(
      'inbox_refederacion_inexistente',
      'La refederación solo puede nacer de una inbox durable.'
    );
  }
  return filas[0].recibida_en_utc;
}

function parsearCanonicoTestimoniado({ canonico, huella, codigo }) {
  const valor = typeof canonico === 'string' ? JSON.parse(canonico) : canonico;
  const normalizado = canonicalizarJsonFederacion(valor);
  if (!Buffer.from(huella).equals(sha256(normalizado))) {
    throw new ErrorRefederacionFederacion(
      codigo,
      'El testimonio durable de refederación no coincide con su huella.'
    );
  }
  return valor;
}

function destinoCaptura(destino, ocurrencia) {
  return {
    flujoId: destino.flujoId,
    generacionId: destino.generacionId,
    prioridad: ocurrencia.operacion !== 'actualizacion' ||
      ocurrencia.vigenciaRestanteMs !== null
      ? 'operativaActual'
      : 'reconstruccion',
    clasePosicion: 'cambioPosterior'
  };
}

function resultado(estado) {
  return Object.freeze({ estado, totalDescendientes: 0 });
}

function sha256(valor) {
  return createHash('sha256').update(valor, 'utf8').digest();
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre} debe implementar ${metodo}().`);
  }
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new ErrorRefederacionFederacion(
      'transaccion_refederacion_ausente',
      'La refederación debe compartir la transacción durable de recepción.'
    );
  }
}

function enteroAcotado(valor, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new ErrorRefederacionFederacion(
      'limite_refederacion_invalido',
      `El límite debe estar entre ${minimo} y ${maximo}.`
    );
  }
  return numero;
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}
