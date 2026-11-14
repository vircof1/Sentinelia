import { createHash } from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  PERFIL_REFERENCIA_CONTENIDO_SENSIBLE_FEDERACION
} from '../src/SeparacionContenidoSensibleFederacion.js';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;

export class ErrorSoporteCamposFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorSoporteCamposFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioSoporteCamposFederacionSql {
  constructor(clienteSql, { protectorContenidoSensible = null } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('El soporte por campo requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.protectorContenidoSensible = protectorContenidoSensible;
  }

  async sanearLote(lote) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const saneado = await this.sanearLoteEnTransaccion(lote, { conexion });
      await conexion.commit();
      return saneado;
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async sanearLoteEnTransaccion(lote, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    if (!lote || !Array.isArray(lote.entregas)) {
      fallar('lote_saneado_invalido', 'El saneado exige un lote federado interpretable.');
    }
    const [filas] = await conexion.execute(
      `SELECT s.campos,s.niveles_scope,s.permite_contenido_sensible,f.familia
         FROM revisiones_concesion_federacion v
         JOIN estado_concesion_relaciones_federacion e
           ON e.relacion_id=v.relacion_id
          AND e.revision_efectiva_actual_id=v.revision_id
         JOIN relaciones_federacion r
           ON r.relacion_id=v.relacion_id
         JOIN flujos_federacion f
           ON f.relacion_id=v.relacion_id AND f.flujo_id=?
         JOIN selectores_revision_concesion_federacion s
           ON s.revision_id=v.revision_id AND s.familia=f.familia
        WHERE v.revision_id=? AND v.relacion_id=? AND v.papel='efectiva'
          AND v.estado='vigente' AND v.finalizada_en_utc IS NULL
          AND r.direccion='recepcion' AND r.estado_ciclo='vinculada'
          AND r.estado_autoridad='autorizada' AND r.estado_identidad='valida'
          AND r.estado_compatibilidad IN ('compatible','compatibleParcial')
        LIMIT 1 FOR UPDATE`,
      [lote.flujoId, lote.revisionConcesionEfectiva, lote.relacionId]
    );
    if (!filas[0]) {
      fallar(
        'selector_revision_efectiva_desconocido',
        'El lote no posee un selector efectivo aplicable antes de persistirse.'
      );
    }
    const permitidos = new Set(parsearLista(filas[0].campos));
    const nivelesScope = new Set(parsearLista(filas[0].niveles_scope));
    const permiteSensible = Boolean(filas[0].permite_contenido_sensible);
    if (lote.entregas.some((entrega) =>
      entrega?.ocurrencia?.familia !== filas[0].familia ||
      !nivelesScope.has(entrega?.ocurrencia?.scopeOrigenDeclarado?.nivel))) {
      fallar(
        'ocurrencia_fuera_selector_efectivo',
        'El lote contiene una familia o profundidad de scope ajena a la concesión actual.'
      );
    }
    return {
      ...lote,
      entregas: lote.entregas.map((entrega) => ({
        ...entrega,
        ocurrencia: {
          ...entrega.ocurrencia,
          campos: Object.fromEntries(Object.entries(entrega.ocurrencia?.campos || {})
            .map(([nombre, declaracion]) => [
              nombre,
              campoAutorizadoRecepcion({
                nombre,
                declaracion,
                ocurrencia: entrega.ocurrencia,
                permitidos,
                permiteSensible
              })
                ? declaracion
                : { estado: 'omitido', causa: 'noAutorizado' }
            ]))
        }
      }))
    };
  }

  async aplicarEnTransaccion({
    contribucionId,
    proyeccionId,
    generacionId,
    revisionConcesionId,
    inboxId,
    ocurrencia
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const entrada = normalizarEntrada({
      contribucionId,
      proyeccionId,
      generacionId,
      revisionConcesionId,
      inboxId,
      ocurrencia
    });
    const control = await obtenerControl(conexion, entrada);
    if (!control || control.estado_soporte !== 'activa') {
      fallar(
        'contribucion_sin_soporte_activo',
        'La contribución no puede aportar campos después de su retirada.'
      );
    }
    const permitidos = new Set(parsearLista(control.campos));
    const permiteSensible = Boolean(control.permite_contenido_sensible);
    const ahora = await ahoraSql(conexion);
    const afectados = new Map();
    const resumen = {
      aportados: 0,
      actualizados: 0,
      retirados: 0,
      omitidos: 0,
      noAutorizados: 0,
      sinCambio: 0
    };
    for (const [nombre, declaracion] of Object.entries(entrada.campos)) {
      if (!permitidos.has(nombre) ||
          (declaracion.estado === 'presente' &&
            declaracion.sensibilidad === 'sensible' && !permiteSensible)) {
        resumen.noAutorizados += 1;
        continue;
      }
      if (declaracion.estado === 'omitido') {
        resumen.omitidos += 1;
        continue;
      }
      const nombreSha256 = sha256(nombre);
      const declaracionPersistida = await resolverDeclaracionGlobal(conexion, {
        inboxId: entrada.inboxId,
        nombre,
        nombreSha256,
        declaracion,
        protector: this.protectorContenidoSensible,
        ahora
      });
      const cambio = await aplicarSoporte(conexion, {
        ...entrada,
        nombre,
        nombreSha256,
        declaracion,
        declaracionCampoId: declaracionPersistida.id,
        ahora
      });
      resumen[cambio] += 1;
      if (cambio !== 'sinCambio') afectados.set(nombre, nombreSha256);
    }
    let camposFuncionalesAgregados = 0;
    let camposFuncionalesRetirados = 0;
    for (const [nombre, nombreSha256] of afectados) {
      const resultado = await consolidarCampo(conexion, {
        proyeccionId: entrada.proyeccionId,
        nombre,
        nombreSha256,
        ahora
      });
      camposFuncionalesAgregados += resultado.agregado ? 1 : 0;
      camposFuncionalesRetirados += resultado.retirado ? 1 : 0;
    }
    return Object.freeze({
      ...resumen,
      camposFuncionalesAgregados,
      camposFuncionalesRetirados,
      contribucionAmpliada: camposFuncionalesAgregados > 0
    });
  }

  async retirarContribucion({ contribucionId, causa } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await this.retirarContribucionEnTransaccion(
        { contribucionId, causa },
        { conexion }
      );
      await conexion.commit();
      return resultado;
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async retirarContribucionEnTransaccion({ contribucionId, causa } = {}, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const contribucion = textoIdentidad(contribucionId, 'contribucionId');
    const causaNormalizada = textoCausa(causa);
    const [filas] = await conexion.execute(
      `SELECT proyeccion_id,estado_soporte
         FROM contribuciones_proyecciones_federacion
        WHERE contribucion_id=? FOR UPDATE`,
      [contribucion]
    );
    if (!filas[0]) {
      fallar('contribucion_inexistente', 'No existe la contribución que se quiere retirar.');
    }
    if (filas[0].estado_soporte === 'retirada') {
      return Object.freeze({ yaRetirada: true, camposFuncionalesRetirados: 0 });
    }
    const ahora = await ahoraSql(conexion);
    const [soportes] = await conexion.execute(
      `SELECT generacion_id,nombre_sha256,nombre_campo,declaracion_campo_id,
              inbox_ocurrencia_id,secuencia_elemento
         FROM soportes_campos_contribuciones_federacion
        WHERE contribucion_id=? AND estado='activo' FOR UPDATE`,
      [contribucion]
    );
    await conexion.execute(
      `UPDATE contribuciones_proyecciones_federacion
          SET estado_soporte='retirada',causa_retirada_soporte=?,
              retirada_soporte_en_utc=?,actualizada_en_utc=GREATEST(
                actualizada_en_utc,?
              )
        WHERE contribucion_id=?`,
      [causaNormalizada, ahora, ahora, contribucion]
    );
    await conexion.execute(
      `UPDATE soportes_campos_contribuciones_federacion
          SET estado='retirado',ultima_actualizacion_utc=GREATEST(
                ultima_actualizacion_utc,?
              )
        WHERE contribucion_id=? AND estado='activo'`,
      [ahora, contribucion]
    );
    let retirados = 0;
    for (const soporte of soportes) {
      await conexion.execute(
        `INSERT INTO eventos_soporte_campos_federacion (
           proyeccion_id,contribucion_id,generacion_id,
           nombre_sha256,nombre_campo,tipo,
           declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
           causa,ocurrido_en_utc
         ) VALUES (?,?,?,?,?,'retiradoContribucion',?,?,?,?,?)`,
        [
          filas[0].proyeccion_id,
          contribucion,
          soporte.generacion_id,
          soporte.nombre_sha256,
          soporte.nombre_campo,
          soporte.declaracion_campo_id,
          soporte.inbox_ocurrencia_id,
          soporte.secuencia_elemento,
          causaNormalizada,
          ahora
        ]
      );
      const resultado = await consolidarCampo(conexion, {
        proyeccionId: filas[0].proyeccion_id,
        nombre: soporte.nombre_campo,
        nombreSha256: soporte.nombre_sha256,
        ahora
      });
      retirados += resultado.retirado ? 1 : 0;
    }
    return Object.freeze({
      yaRetirada: false,
      camposRecalculados: soportes.length,
      camposFuncionalesRetirados: retirados
    });
  }

  async retirarCamposContribucionEnTransaccion({
    contribucionId,
    campos,
    causa = 'reduccionConcesion'
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const contribucion = textoIdentidad(contribucionId, 'contribucionId');
    const nombres = [...new Set((Array.isArray(campos) ? campos : [])
      .map((campo) => String(campo || '').trim()).filter(Boolean))].sort();
    if (nombres.length === 0) {
      return Object.freeze({ camposRecalculados: 0, camposFuncionalesRetirados: 0 });
    }
    const causaNormalizada = textoCausa(causa);
    const [contribuciones] = await conexion.execute(
      `SELECT proyeccion_id,estado_soporte
         FROM contribuciones_proyecciones_federacion
        WHERE contribucion_id=? FOR UPDATE`,
      [contribucion]
    );
    if (!contribuciones[0]) {
      fallar('contribucion_inexistente', 'No existe la contribución cuyos campos se retiran.');
    }
    const marcas = nombres.map(() => '?').join(',');
    const [soportes] = await conexion.execute(
      `SELECT generacion_id,nombre_sha256,nombre_campo,declaracion_campo_id,
              inbox_ocurrencia_id,secuencia_elemento
         FROM soportes_campos_contribuciones_federacion
        WHERE contribucion_id=? AND estado='activo'
          AND nombre_campo IN (${marcas})
        ORDER BY nombre_campo FOR UPDATE`,
      [contribucion, ...nombres]
    );
    const ahora = await ahoraSql(conexion);
    let retirados = 0;
    for (const soporte of soportes) {
      await conexion.execute(
        `UPDATE soportes_campos_contribuciones_federacion
            SET estado='retirado',ultima_actualizacion_utc=GREATEST(
                  ultima_actualizacion_utc,?
                )
          WHERE contribucion_id=? AND generacion_id=? AND nombre_sha256=?
            AND estado='activo'`,
        [ahora, contribucion, soporte.generacion_id, soporte.nombre_sha256]
      );
      await conexion.execute(
        `INSERT INTO eventos_soporte_campos_federacion (
           proyeccion_id,contribucion_id,generacion_id,nombre_sha256,
           nombre_campo,tipo,declaracion_campo_id,inbox_ocurrencia_id,
           secuencia_elemento,causa,ocurrido_en_utc
         ) VALUES (?,?,?,?,?,'retiradoCampo',?,?,?,?,?)`,
        [contribuciones[0].proyeccion_id, contribucion, soporte.generacion_id,
          soporte.nombre_sha256, soporte.nombre_campo,
          soporte.declaracion_campo_id, soporte.inbox_ocurrencia_id,
          soporte.secuencia_elemento, causaNormalizada, ahora]
      );
      const resultado = await consolidarCampo(conexion, {
        proyeccionId: contribuciones[0].proyeccion_id,
        nombre: soporte.nombre_campo,
        nombreSha256: soporte.nombre_sha256,
        ahora
      });
      retirados += resultado.retirado ? 1 : 0;
    }
    return Object.freeze({
      camposRecalculados: soportes.length,
      camposFuncionalesRetirados: retirados
    });
  }
}

function campoAutorizadoRecepcion({
  nombre, declaracion, ocurrencia, permitidos, permiteSensible
}) {
  if (!permitidos.has(nombre)) return false;
  if (declaracion?.estado !== 'presente' || declaracion.sensibilidad !== 'sensible') {
    return true;
  }
  return permiteSensible && sensiblesPresentes(ocurrencia.familia, declaracion.valor)
    .every((campo) => permitidos.has(campo));
}

function sensiblesPresentes(familia, payload) {
  const tipo = payload?.tipoRegistro;
  if (familia === 'monitores') {
    return payload?.credencialPropia?.estado === 'presente' ? ['credencialPropia'] : [];
  }
  if (familia === 'triggersInformativos') {
    if (tipo === 'definicion') {
      return payload?.contenidoSensible?.estado === 'presente'
        ? ['contenidoSensibleDefinicion'] : [];
    }
    if (tipo === 'asignacionMonitor') {
      return payload?.contenidoSensible?.estado === 'presente'
        ? ['contenidoSensibleAsignacion'] : [];
    }
    return ['payloadSolicitud', 'payloadRespuesta', 'payloadError']
      .filter((campo) => payload?.[campo]?.estado === 'presente');
  }
  if (familia === 'auditoria') return ['payloadCompleto'];
  if (familia === 'avisosFederados') {
    return [payload?.actor, payload?.actorUltimaTransicion]
      .some((actor) => actor?.estado === 'visible') ? ['actorVisible'] : [];
  }
  return [];
}

function normalizarEntrada({
  contribucionId,
  proyeccionId,
  generacionId,
  revisionConcesionId,
  inboxId,
  ocurrencia
}) {
  if (!ocurrencia || typeof ocurrencia !== 'object' ||
      ocurrencia.operacion !== 'actualizacion' ||
      !ocurrencia.campos || typeof ocurrencia.campos !== 'object' ||
      Array.isArray(ocurrencia.campos)) {
    fallar(
      'ocurrencia_soporte_invalida',
      'Solo una actualización federada válida puede aportar campos.'
    );
  }
  return Object.freeze({
    contribucionId: textoIdentidad(contribucionId, 'contribucionId'),
    proyeccionId: textoIdentidad(proyeccionId, 'proyeccionId'),
    generacionId: textoIdentidad(generacionId, 'generacionId'),
    revisionConcesionId: textoIdentidad(
      revisionConcesionId,
      'revisionConcesionId'
    ),
    inboxId: decimalPositivo(inboxId, 'inboxId'),
    familia: String(ocurrencia.familia || ''),
    secuenciaElemento: decimalPositivo(
      ocurrencia.secuenciaElemento,
      'secuenciaElemento'
    ),
    campos: ocurrencia.campos
  });
}

async function obtenerControl(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT c.estado_soporte,s.campos,s.permite_contenido_sensible
       FROM contribuciones_proyecciones_federacion c
       JOIN aportes_ocurrencias_contribuciones_federacion a
         ON a.contribucion_id=c.contribucion_id
        AND a.inbox_ocurrencia_id=?
        AND a.generacion_id=?
       JOIN selectores_revision_concesion_federacion s
         ON s.revision_id=c.revision_concesion_id AND s.familia=?
      WHERE c.contribucion_id=? AND c.proyeccion_id=?
        AND c.revision_concesion_id=? FOR UPDATE`,
    [
      entrada.inboxId,
      entrada.generacionId,
      entrada.familia,
      entrada.contribucionId,
      entrada.proyeccionId,
      entrada.revisionConcesionId
    ]
  );
  return filas[0] || null;
}

async function resolverDeclaracionGlobal(conexion, {
  inboxId,
  nombre,
  nombreSha256,
  declaracion,
  protector,
  ahora
}) {
  const [filas] = await conexion.execute(
    `SELECT * FROM declaraciones_campos_inbox_federacion
      WHERE inbox_ocurrencia_id=? AND nombre_sha256=? FOR UPDATE`,
    [inboxId, nombreSha256]
  );
  if (filas[0]) {
    await exigirMismaDeclaracion(filas[0], { nombre, declaracion, protector, inboxId });
    return filas[0];
  }
  const persistible = prepararDeclaracion({
    nombre,
    declaracion,
    protector,
    inboxId
  });
  try {
    const [insercion] = await conexion.execute(
      `INSERT INTO declaraciones_campos_inbox_federacion (
         inbox_ocurrencia_id,nombre_sha256,nombre_campo,estado,sensibilidad,
         declaracion_publica_canonica,perfil_custodia,keyring_referencia,
         key_id,nonce,ciphertext,auth_tag,creada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        inboxId,
        nombreSha256,
        nombre,
        declaracion.estado,
        declaracion.estado === 'presente' ? declaracion.sensibilidad : null,
        persistible.publicaCanonica,
        persistible.sobre?.perfil ?? null,
        persistible.sobre?.keyringReferencia ?? null,
        persistible.sobre?.keyId ?? null,
        persistible.sobre?.nonce ?? null,
        persistible.sobre?.ciphertext ?? null,
        persistible.sobre?.authTag ?? null,
        ahora
      ]
    );
    return { id: String(insercion.insertId) };
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const [repetidas] = await conexion.execute(
      `SELECT * FROM declaraciones_campos_inbox_federacion
        WHERE inbox_ocurrencia_id=? AND nombre_sha256=? FOR UPDATE`,
      [inboxId, nombreSha256]
    );
    if (!repetidas[0]) throw error;
    await exigirMismaDeclaracion(repetidas[0], {
      nombre, declaracion, protector, inboxId
    });
    return repetidas[0];
  }
}

function prepararDeclaracion({ nombre, declaracion, protector, inboxId }) {
  if (declaracion.estado !== 'presente' || declaracion.sensibilidad !== 'sensible') {
    return {
      publicaCanonica: canonicalizarJsonFederacion(declaracion),
      sobre: null
    };
  }
  if (typeof protector?.cifrar !== 'function') {
    fallar(
      'custodia_sensible_soporte_ausente',
      'El campo sensible no puede consolidarse sin custodia cifrada.'
    );
  }
  const publica = {
    ...declaracion,
    valor: {
      perfil: PERFIL_REFERENCIA_CONTENIDO_SENSIBLE_FEDERACION,
      campo: nombre
    }
  };
  return {
    publicaCanonica: canonicalizarJsonFederacion(publica),
    sobre: protector.cifrar({
      contenido: declaracion,
      aad: aadCampo({ inboxId, nombre })
    })
  };
}

async function exigirMismaDeclaracion(fila, {
  nombre,
  declaracion,
  protector,
  inboxId
}) {
  if (fila.nombre_campo !== nombre || fila.estado !== declaracion.estado) {
    fallar(
      'declaracion_campo_divergente',
      'La misma ocurrencia contiene declaraciones incompatibles para un campo.'
    );
  }
  let existente;
  if (fila.sensibilidad === 'sensible') {
    if (fila.purgada_en_utc !== null || fila.ciphertext === null) {
      fallar(
        'contenido_sensible_purgado',
        'La declaración conserva identidad saneada, pero su valor sensible fue retirado.'
      );
    }
    if (typeof protector?.descifrar !== 'function') {
      fallar(
        'custodia_sensible_soporte_ausente',
        'No puede compararse el campo sensible sin su custodia.'
      );
    }
    existente = protector.descifrar({
      sobre: {
        perfil: fila.perfil_custodia,
        keyringReferencia: fila.keyring_referencia,
        keyId: fila.key_id,
        nonce: fila.nonce,
        ciphertext: fila.ciphertext,
        authTag: fila.auth_tag
      },
      aad: aadCampo({ inboxId, nombre })
    });
  } else {
    existente = JSON.parse(String(fila.declaracion_publica_canonica));
  }
  if (canonicalizarJsonFederacion(existente) !==
      canonicalizarJsonFederacion(declaracion)) {
    fallar(
      'declaracion_campo_divergente',
      'La misma ocurrencia contiene valores incompatibles para un campo.'
    );
  }
}

async function aplicarSoporte(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT * FROM soportes_campos_contribuciones_federacion
      WHERE contribucion_id=? AND generacion_id=? AND nombre_sha256=? FOR UPDATE`,
    [entrada.contribucionId, entrada.generacionId, entrada.nombreSha256]
  );
  const anterior = filas[0] || null;
  if (anterior && anterior.nombre_campo !== entrada.nombre) {
    fallar('colision_nombre_campo', 'Dos nombres de campo comparten una huella inesperada.');
  }
  if (anterior && BigInt(anterior.secuencia_elemento) >
      BigInt(entrada.secuenciaElemento)) {
    return 'sinCambio';
  }
  if (anterior && String(anterior.secuencia_elemento) === entrada.secuenciaElemento &&
      String(anterior.declaracion_campo_id) === String(entrada.declaracionCampoId) &&
      anterior.estado === (entrada.declaracion.estado === 'retirado'
        ? 'retirado'
        : 'activo')) {
    return 'sinCambio';
  }
  if (anterior && String(anterior.secuencia_elemento) === entrada.secuenciaElemento) {
    fallar(
      'soporte_campo_divergente',
      'Una contribución intenta reinterpretar la misma secuencia de campo.'
    );
  }
  const estado = entrada.declaracion.estado === 'retirado' ? 'retirado' : 'activo';
  const tipo = estado === 'retirado'
    ? 'retiradoCampo'
    : anterior ? 'actualizado' : 'aportado';
  if (anterior) {
    await conexion.execute(
        `UPDATE soportes_campos_contribuciones_federacion
          SET estado=?,declaracion_campo_id=?,inbox_ocurrencia_id=?,
              secuencia_elemento=?,ultima_actualizacion_utc=?
        WHERE contribucion_id=? AND generacion_id=? AND nombre_sha256=?`,
      [
        estado,
        entrada.declaracionCampoId,
        entrada.inboxId,
        entrada.secuenciaElemento,
        entrada.ahora,
        entrada.contribucionId,
        entrada.generacionId,
        entrada.nombreSha256
      ]
    );
  } else {
    await conexion.execute(
      `INSERT INTO soportes_campos_contribuciones_federacion (
         contribucion_id,generacion_id,nombre_sha256,nombre_campo,estado,
         declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
         primera_aportacion_utc,ultima_actualizacion_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        entrada.contribucionId,
        entrada.generacionId,
        entrada.nombreSha256,
        entrada.nombre,
        estado,
        entrada.declaracionCampoId,
        entrada.inboxId,
        entrada.secuenciaElemento,
        entrada.ahora,
        entrada.ahora
      ]
    );
  }
  await conexion.execute(
    `INSERT INTO eventos_soporte_campos_federacion (
       proyeccion_id,contribucion_id,generacion_id,
       nombre_sha256,nombre_campo,tipo,
       declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
       causa,ocurrido_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,NULL,?)`,
    [
      entrada.proyeccionId,
      entrada.contribucionId,
      entrada.generacionId,
      entrada.nombreSha256,
      entrada.nombre,
      tipo,
      entrada.declaracionCampoId,
      entrada.inboxId,
      entrada.secuenciaElemento,
      entrada.ahora
    ]
  );
  return estado === 'retirado' ? 'retirados' : anterior ? 'actualizados' : 'aportados';
}

async function consolidarCampo(conexion, {
  proyeccionId,
  nombre,
  nombreSha256,
  ahora
}) {
  const [versiones] = await conexion.execute(
    `SELECT generacion_id FROM versiones_proyecciones_federacion
      WHERE proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  if (versiones.length > 0) {
    return { agregado: false, retirado: false, diferidoHastaPublicacion: true };
  }
  const [actuales] = await conexion.execute(
    `SELECT declaracion_campo_id FROM campos_consolidados_proyecciones_federacion
      WHERE proyeccion_id=? AND nombre_sha256=? FOR UPDATE`,
    [proyeccionId, nombreSha256]
  );
  const [soportes] = await conexion.execute(
    `WITH vigencias_activas AS (
       SELECT c.contribucion_id,a.vigencia_restante_recepcion_ms,
              a.primera_observacion_utc,
              ROW_NUMBER() OVER (
                PARTITION BY c.contribucion_id
                ORDER BY i.secuencia_elemento DESC,
                         a.primera_observacion_utc DESC,
                         a.inbox_ocurrencia_id DESC
              ) AS ordinal_vigencia
         FROM contribuciones_proyecciones_federacion c
         JOIN aportes_ocurrencias_contribuciones_federacion a
           ON a.contribucion_id=c.contribucion_id
         JOIN inbox_ocurrencias_federacion i
           ON i.id=a.inbox_ocurrencia_id
         JOIN flujos_federacion f
           ON f.flujo_id=a.flujo_id
          AND f.generacion_activa_id=a.generacion_id
        WHERE c.proyeccion_id=?
     )
     SELECT s.contribucion_id,s.nombre_campo,s.declaracion_campo_id,
            s.inbox_ocurrencia_id,s.secuencia_elemento
       FROM soportes_campos_contribuciones_federacion s
       JOIN contribuciones_proyecciones_federacion c
         ON c.contribucion_id=s.contribucion_id
       JOIN vigencias_activas x
         ON x.contribucion_id=c.contribucion_id
        AND x.ordinal_vigencia=1
        AND (
          x.vigencia_restante_recepcion_ms IS NULL
          OR x.vigencia_restante_recepcion_ms>
             FLOOR(GREATEST(
               TIMESTAMPDIFF(MICROSECOND,x.primera_observacion_utc,?),0
             )/1000)
        )
       JOIN relaciones_federacion r ON r.relacion_id=c.relacion_id
       JOIN revisiones_concesion_federacion v
         ON v.relacion_id=c.relacion_id
        AND v.revision_id=c.revision_concesion_id
       JOIN aportes_ocurrencias_contribuciones_federacion a
         ON a.contribucion_id=s.contribucion_id
        AND a.inbox_ocurrencia_id=s.inbox_ocurrencia_id
        AND a.generacion_id=s.generacion_id
       JOIN generaciones_flujos_federacion g
         ON g.generacion_id=s.generacion_id
       JOIN flujos_federacion f
         ON f.flujo_id=g.flujo_id
        AND f.generacion_activa_id=g.generacion_id
      WHERE c.proyeccion_id=? AND c.estado_soporte='activa'
        AND c.estado_autoridad='autorizada' AND c.estado_identidad='valida'
        AND c.estado_compatibilidad IN ('compatible','compatibleParcial')
        AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
        AND r.estado_identidad='valida' AND r.estado_compatibilidad<>'incompatible'
        AND v.estado='vigente' AND s.nombre_sha256=? AND s.estado='activo'
      ORDER BY s.secuencia_elemento DESC,s.contribucion_id`,
    [proyeccionId, ahora, proyeccionId, nombreSha256]
  );
  if (soportes.some((soporte) => soporte.nombre_campo !== nombre)) {
    fallar(
      'colision_nombre_campo',
      'Dos nombres completos de campo comparten una huella física inesperada.'
    );
  }
  if (soportes.length === 0) {
    if (actuales.length > 0) {
      await conexion.execute(
        `DELETE FROM campos_consolidados_proyecciones_federacion
          WHERE proyeccion_id=? AND nombre_sha256=?`,
        [proyeccionId, nombreSha256]
      );
    }
    return { agregado: false, retirado: actuales.length > 0 };
  }
  const elegida = soportes[0];
  const total = new Set(soportes.map((soporte) => soporte.contribucion_id)).size;
  await conexion.execute(
    `INSERT INTO campos_consolidados_proyecciones_federacion (
       proyeccion_id,nombre_sha256,nombre_campo,declaracion_campo_id,
       inbox_ocurrencia_id,secuencia_elemento,total_soportes_activos,
       consolidado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       nombre_campo=VALUES(nombre_campo),
       declaracion_campo_id=VALUES(declaracion_campo_id),
       inbox_ocurrencia_id=VALUES(inbox_ocurrencia_id),
       secuencia_elemento=VALUES(secuencia_elemento),
       total_soportes_activos=VALUES(total_soportes_activos),
       consolidado_en_utc=VALUES(consolidado_en_utc)`,
    [
      proyeccionId,
      nombreSha256,
      nombre,
      elegida.declaracion_campo_id,
      elegida.inbox_ocurrencia_id,
      String(elegida.secuencia_elemento),
      total,
      ahora
    ]
  );
  return { agregado: actuales.length === 0, retirado: false };
}

function parsearLista(valor) {
  const datos = typeof valor === 'string' ? JSON.parse(valor) : valor;
  if (!Array.isArray(datos) || datos.some((campo) => typeof campo !== 'string')) {
    fallar('selector_campos_invalido', 'La revisión no conserva campos interpretables.');
  }
  return datos;
}

function aadCampo({ inboxId, nombre }) {
  return {
    perfil: 'sentinelia-federacion-campo-inbox-v1',
    inboxId: String(inboxId),
    nombre
  };
}

function textoIdentidad(valor, campo) {
  const texto = String(valor || '');
  if (!/^sfid1\.[a-z_]+\.[A-Za-z0-9_-]{22}$/u.test(texto)) {
    fallar('identidad_soporte_invalida', `${campo} no es una identidad canónica.`);
  }
  return texto;
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto) || BigInt(texto) > MAX_BIGINT_UNSIGNED) {
    fallar('entero_soporte_invalido', `${campo} no es un entero durable positivo.`);
  }
  return texto;
}

function textoCausa(valor) {
  const texto = String(valor || '');
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/u.test(texto)) {
    fallar('causa_retirada_soporte_invalida', 'La retirada exige una causa estable.');
  }
  return texto;
}

function sha256(valor) {
  return createHash('sha256').update(valor, 'utf8').digest();
}

function fallar(codigo, mensaje) {
  throw new ErrorSoporteCamposFederacion(codigo, mensaje);
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    fallar('transaccion_soporte_ausente', 'El soporte exige SQL prestado.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_soporte_inactiva', 'El soporte exige una transacción activa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}
