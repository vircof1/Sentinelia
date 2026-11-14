import { createHash } from 'node:crypto';

import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { OperacionAdministrativa } from './OperacionAdministrativa.js';
import {
  CAUSAS_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA,
  CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
} from '../../coordinacion-durable/src/DiagnosticosOperacionesAdministrativas.js';

const CODIGOS_DIAGNOSTICO = new Set([
  ...CAUSAS_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA,
  'agente_eliminacion_estructura_modificada',
  'agente_eliminacion_identidad_federada_incompleta',
  'agente_eliminacion_impacto_no_seguro',
  'agente_eliminacion_sujeto_ausente'
]);

export class ErrorPersistenciaOperacionAdministrativa extends Error {
  constructor(codigo, mensaje, { causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorPersistenciaOperacionAdministrativa';
    this.codigo = codigo;
    this.permanente = true;
  }
}

export class RepositorioOperacionesAdministrativasSql {
  constructor({ clienteSql, catalogoEjecutores } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El repositorio de operaciones administrativas exige ClienteSql.');
    }
    if (typeof catalogoEjecutores?.validarComando !== 'function') {
      throw new Error('El repositorio exige un catálogo cerrado de ejecutores.');
    }
    this.clienteSql = clienteSql;
    this.catalogoEjecutores = catalogoEjecutores;
  }

  async crearORecuperar({ comando, maxIntentos = 3, conexion = null } = {}) {
    const contrato = contratoDesdeComando(comando);
    const normalizado = this.catalogoEjecutores.validarComando(
      contrato.tipo,
      contrato.version,
      comando
    );
    const canonico = canonicalizarRfc8785(normalizado);
    const huella = createHash('sha256').update(canonico, 'utf8').digest();
    const intentos = entero(maxIntentos, 1, 100, 'maxIntentos');
    const recursos = this.catalogoEjecutores.resolverRecursos(
      contrato.tipo,
      contrato.version,
      normalizado
    );

    try {
      return await this.#transaccion(async (conexionActiva) => {
        const existente = await seleccionarPorClave(
          conexionActiva,
          normalizado.identidades.claveOperacion,
          { bloquear: true }
        );
        if (existente) return this.#resolverRepeticion(existente, huella);

        await conexionActiva.execute(
          `INSERT INTO operaciones_administrativas (
             operacion_id,clave_operacion,correlacion_id,evento_aceptacion_id,
             tipo,version_contrato,sujeto_tipo,sujeto_id,sujeto_guid,
             actor_real_usuario_id,actor_efectivo_usuario_id,destinatario_usuario_id,
             comando_canonico,huella_intencion,estado,fase,intentos,max_intentos,
             disponible_desde_utc,fencing_token,creada_en_utc,actualizada_en_utc
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'encolada','preparacion',0,?,
                     UTC_TIMESTAMP(3),0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          parametrosInsercion(normalizado, canonico, huella, intentos)
        );
        for (const recurso of recursos) {
          await conexionActiva.execute(
            `INSERT INTO recursos_operaciones_administrativas (
               operacion_id,tipo_recurso,recurso_id,estado_reclamo,reclamado_en_utc
             ) VALUES (?,?,?,'activo',UTC_TIMESTAMP(3))`,
            [
              uuidV7AuditoriaABytes(normalizado.identidades.operacionId),
              recurso.tipoRecurso,
              recurso.recursoId
            ]
          );
        }
        const fila = await seleccionarPorId(
          conexionActiva,
          normalizado.identidades.operacionId,
          { bloquear: false }
        );
        return Object.freeze({ creada: true, operacion: this.#rehidratar(fila) });
      }, conexion);
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const existente = await this.buscarPorClave(
        normalizado.identidades.claveOperacion,
        { conexion }
      );
      if (existente) {
        const mismaHuella = await this.#huellaPorClave(
          normalizado.identidades.claveOperacion,
          { conexion }
        );
        if (mismaHuella.equals(huella)) {
          return Object.freeze({ creada: false, operacion: existente });
        }
        throw claveReutilizada();
      }
      if (esDuplicadoIdentidadOperacion(error)) {
        throw new ErrorPersistenciaOperacionAdministrativa(
          'identidad_operacion_administrativa_reutilizada',
          'Una identidad causal de la operación ya está registrada.',
          { causa: error }
        );
      }
      throw new ErrorPersistenciaOperacionAdministrativa(
        'operacion_administrativa_recurso_reclamado',
        `El recurso ${normalizado.sujeto.tipo}:${normalizado.sujeto.id} ` +
          'ya posee una operación activa.',
        { causa: error }
      );
    }
  }

  async buscarPorId(operacionId, { conexion = null, bloquear = false } = {}) {
    const filas = await this.#consultar(
      `${SELECCION_OPERACION} WHERE operacion_id=?`,
      [uuidV7AuditoriaABytes(operacionId)],
      { conexion, bloquear }
    );
    return filas[0] ? this.#rehidratar(filas[0]) : null;
  }

  async buscarPorClave(claveOperacion, { conexion = null, bloquear = false } = {}) {
    const filas = await this.#consultar(
      `${SELECCION_OPERACION} WHERE clave_operacion=?`,
      [uuidV7AuditoriaABytes(claveOperacion)],
      { conexion, bloquear }
    );
    return filas[0] ? this.#rehidratar(filas[0]) : null;
  }

  async reclamarSiguiente({ instanciaId, leaseToken, ttlSegundos } = {}) {
    const instancia = ascii(instanciaId, 128, 'instanciaId');
    const token = tokenLease(leaseToken);
    const ttl = entero(ttlSegundos, 1, 3600, 'ttlSegundos');
    return this.#transaccion(async (conexion) => {
      await cerrarLeaseAgotado(conexion);
      const [filas] = await conexion.execute(
        `${SELECCION_OPERACION}
          WHERE intentos < max_intentos
            AND (
              (estado='encolada' AND disponible_desde_utc<=UTC_TIMESTAMP(3))
              OR (estado='ejecutando' AND lease_expira_utc<=UTC_TIMESTAMP(3))
            )
          ORDER BY disponible_desde_utc,creada_en_utc,operacion_id
          LIMIT 1 FOR UPDATE SKIP LOCKED`
      );
      if (!filas[0]) return null;
      const operacionId = bytesAUuidV7Auditoria(filas[0].operacion_id);
      const [actualizacion] = await conexion.execute(
        `UPDATE operaciones_administrativas
            SET estado='ejecutando',fase='preparacion',intentos=intentos+1,
                instancia_id=?,lease_token=?,
                lease_expira_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
                fencing_token=fencing_token+1,
                ultimo_codigo_error=NULL,ultimo_mensaje_error=NULL,
                resultado_canonico=NULL,terminada_en_utc=NULL,
                actualizada_en_utc=UTC_TIMESTAMP(3)
          WHERE operacion_id=?`,
        [instancia, token, ttl, uuidV7AuditoriaABytes(operacionId)]
      );
      if (Number(actualizacion.affectedRows) !== 1) {
        throw new Error('No se pudo materializar el lease bloqueado.');
      }
      const fila = await seleccionarPorId(conexion, operacionId, { bloquear: false });
      const operacion = this.#rehidratar(fila);
      return Object.freeze({
        operacionId,
        fencingToken: operacion.fencingToken,
        intentos: operacion.intentos,
        operacion: operacion.serializar()
      });
    });
  }

  async renovarLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    ttlSegundos
  } = {}) {
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE operaciones_administrativas
          SET lease_expira_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
              actualizada_en_utc=UTC_TIMESTAMP(3)
        WHERE operacion_id=? AND estado='ejecutando' AND instancia_id=?
          AND lease_token=? AND fencing_token=?
          AND lease_expira_utc>UTC_TIMESTAMP(3)`,
      [
        entero(ttlSegundos, 1, 3600, 'ttlSegundos'),
        uuidV7AuditoriaABytes(operacionId),
        ascii(instanciaId, 128, 'instanciaId'),
        tokenLease(leaseToken),
        fencing(fencingToken)
      ]
    );
    return Object.freeze({ actualizada: Number(resultado.affectedRows) === 1 });
  }

  async avanzarConLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    transicion,
    datos,
    conexion = null
  } = {}) {
    if (datos !== null && datos !== undefined) {
      throw new ErrorPersistenciaOperacionAdministrativa(
        'datos_transicion_operacion_administrativa_no_admitidos',
        'Las fases administrativas no persisten callbacks ni cuerpos arbitrarios.'
      );
    }
    return this.#transaccion(async (conexionActiva) => {
      const fila = await seleccionarLeaseVigente(
        conexionActiva,
        { operacionId, instanciaId, leaseToken, fencingToken }
      );
      if (!fila) return Object.freeze({ actualizada: false });
      const operacion = this.#rehidratar(fila);
      const fase = operacion.siguienteFase(String(transicion || ''));
      const [resultado] = await conexionActiva.execute(
        `UPDATE operaciones_administrativas
            SET fase=?,actualizada_en_utc=UTC_TIMESTAMP(3)
          ${CONDICION_AUTORIDAD_LEASE_BLOQUEADA}`,
        parametrosLease({ operacionId, instanciaId, leaseToken, fencingToken }, [fase])
      );
      return Object.freeze({
        actualizada: Number(resultado.affectedRows) === 1,
        fase
      });
    }, conexion);
  }

  async consolidarConLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    resultado,
    conexion = null
  } = {}) {
    return this.#transaccion(async (conexionActiva) => {
      const fila = await seleccionarLeaseVigente(
        conexionActiva,
        { operacionId, instanciaId, leaseToken, fencingToken }
      );
      if (!fila) return Object.freeze({ actualizada: false });
      const operacion = this.#rehidratar(fila);
      if (operacion.fase !== 'commit') {
        throw new ErrorPersistenciaOperacionAdministrativa(
          'fase_consolidacion_operacion_administrativa_invalida',
          'La operación solo puede consolidarse después de alcanzar commit.'
        );
      }
      const normalizado = this.catalogoEjecutores.validarResultado(
        operacion.tipo,
        operacion.version,
        resultado
      );
      if (!['completada', 'completada_con_advertencias'].includes(normalizado.estado)) {
        throw new ErrorPersistenciaOperacionAdministrativa(
          'estado_resultado_operacion_administrativa_invalido',
          'El ejecutor debe devolver un resultado terminal satisfactorio.'
        );
      }
      const canonico = canonicalizarRfc8785(normalizado);
      const [actualizacion] = await conexionActiva.execute(
        `UPDATE operaciones_administrativas
          SET estado=?,fase='limpieza',instancia_id=NULL,lease_token=NULL,
              lease_expira_utc=NULL,resultado_canonico=?,
              terminada_en_utc=UTC_TIMESTAMP(3),actualizada_en_utc=UTC_TIMESTAMP(3)
          ${CONDICION_AUTORIDAD_LEASE_BLOQUEADA}`,
        parametrosLease(
          { operacionId, instanciaId, leaseToken, fencingToken },
          [normalizado.estado, canonico]
        )
      );
      if (Number(actualizacion.affectedRows) !== 1) {
        return Object.freeze({ actualizada: false });
      }
      await liberarRecursos(conexionActiva, operacionId);
      return Object.freeze({ actualizada: true, estado: normalizado.estado });
    }, conexion);
  }

  async registrarFalloConLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    diagnostico,
    permanente,
    demoraReintentoSegundos,
    resumen
  } = {}) {
    const codigo = codigoDiagnostico(diagnostico?.codigo);
    const mensaje = mensajeDiagnostico(diagnostico?.mensaje);
    const demora = entero(
      demoraReintentoSegundos,
      1,
      86_400,
      'demoraReintentoSegundos'
    );
    if (resumen !== null && resumen !== undefined) {
      throw new ErrorPersistenciaOperacionAdministrativa(
        'resumen_fallo_operacion_administrativa_no_admitido',
        'El motor no persiste cuerpos de fallo suministrados por ejecutores.'
      );
    }
    return this.#transaccion(async (conexion) => {
      const fila = await seleccionarLeaseVigente(
        conexion,
        { operacionId, instanciaId, leaseToken, fencingToken }
      );
      if (!fila) return Object.freeze({ actualizada: false });
      const operacion = this.#rehidratar(fila);
      const terminal = Boolean(permanente) || operacion.intentos >= operacion.maxIntentos;
      if (!terminal) {
        const [actualizacion] = await conexion.execute(
          `UPDATE operaciones_administrativas
            SET estado='encolada',fase='preparacion',instancia_id=NULL,
                lease_token=NULL,lease_expira_utc=NULL,
                ultimo_codigo_error=?,ultimo_mensaje_error=?,
                disponible_desde_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
                actualizada_en_utc=UTC_TIMESTAMP(3)
            ${CONDICION_AUTORIDAD_LEASE_BLOQUEADA}`,
          parametrosLease(
            { operacionId, instanciaId, leaseToken, fencingToken },
            [codigo, mensaje, demora]
          )
        );
        return Object.freeze({
          actualizada: Number(actualizacion.affectedRows) === 1,
          estado: 'encolada'
        });
      }

      const resultadoCanonico = canonicalizarRfc8785({
        estado: 'fallida',
        error: { codigo, mensaje }
      });
      const [actualizacion] = await conexion.execute(
        `UPDATE operaciones_administrativas
          SET estado='fallida',instancia_id=NULL,lease_token=NULL,
              lease_expira_utc=NULL,ultimo_codigo_error=?,ultimo_mensaje_error=?,
              resultado_canonico=?,terminada_en_utc=UTC_TIMESTAMP(3),
              actualizada_en_utc=UTC_TIMESTAMP(3)
          ${CONDICION_AUTORIDAD_LEASE_BLOQUEADA}`,
        parametrosLease(
          { operacionId, instanciaId, leaseToken, fencingToken },
          [codigo, mensaje, resultadoCanonico]
        )
      );
      if (Number(actualizacion.affectedRows) !== 1) {
        return Object.freeze({ actualizada: false });
      }
      await liberarRecursos(conexion, operacionId);
      return Object.freeze({ actualizada: true, estado: 'fallida' });
    });
  }

  async #huellaPorClave(claveOperacion, { conexion = null } = {}) {
    const filas = await this.#consultar(
      'SELECT huella_intencion FROM operaciones_administrativas WHERE clave_operacion=?',
      [uuidV7AuditoriaABytes(claveOperacion)],
      { conexion }
    );
    return filas[0]?.huella_intencion || Buffer.alloc(0);
  }

  #resolverRepeticion(fila, huella) {
    if (!fila.huella_intencion.equals(huella)) throw claveReutilizada();
    return Object.freeze({ creada: false, operacion: this.#rehidratar(fila) });
  }

  #rehidratar(fila) {
    const comando = JSON.parse(fila.comando_canonico);
    const tipo = String(fila.tipo);
    const version = Number(fila.version_contrato);
    const comandoValidado = this.catalogoEjecutores.validarComando(tipo, version, comando);
    return new OperacionAdministrativa({
      operacionId: bytesAUuidV7Auditoria(fila.operacion_id),
      claveOperacion: bytesAUuidV7Auditoria(fila.clave_operacion),
      tipo,
      version,
      sujeto: comandoValidado.sujeto,
      comando: comandoValidado,
      estado: fila.estado,
      fase: fila.fase,
      intentos: Number(fila.intentos),
      maxIntentos: Number(fila.max_intentos),
      disponibleDesdeUtc: fila.disponible_desde_utc,
      instanciaId: fila.instancia_id,
      leaseExpiraUtc: fila.lease_expira_utc,
      fencingToken: String(fila.fencing_token),
      ultimoError: fila.ultimo_codigo_error === null ? null : {
        codigo: fila.ultimo_codigo_error,
        mensaje: fila.ultimo_mensaje_error
      },
      resultado: fila.resultado_canonico === null
        ? null
        : JSON.parse(fila.resultado_canonico),
      creadaEnUtc: fila.creada_en_utc,
      actualizadaEnUtc: fila.actualizada_en_utc,
      terminadaEnUtc: fila.terminada_en_utc
    });
  }

  async #consultar(sql, parametros, { conexion = null, bloquear = false } = {}) {
    const sentencia = `${sql}${bloquear ? ' FOR UPDATE' : ''}`;
    if (conexion?.execute) {
      const [filas] = await conexion.execute(sentencia, parametros);
      return filas;
    }
    return this.clienteSql.consultar(sentencia, parametros);
  }

  async #transaccion(trabajo, conexionPrestada = null) {
    if (conexionPrestada?.execute) {
      const savepoint = 'crear_operacion_administrativa';
      await conexionPrestada.query(`SAVEPOINT ${savepoint}`);
      try {
        const resultado = await trabajo(conexionPrestada);
        await conexionPrestada.query(`RELEASE SAVEPOINT ${savepoint}`);
        return resultado;
      } catch (error) {
        await conexionPrestada.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
        await conexionPrestada.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
        throw error;
      }
    }
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }
}

const SELECCION_OPERACION = `SELECT
  operacion_id,clave_operacion,tipo,version_contrato,comando_canonico,
  huella_intencion,estado,fase,intentos,max_intentos,disponible_desde_utc,
  instancia_id,lease_expira_utc,CAST(fencing_token AS CHAR) AS fencing_token,
  ultimo_codigo_error,ultimo_mensaje_error,resultado_canonico,
  creada_en_utc,actualizada_en_utc,terminada_en_utc
FROM operaciones_administrativas`;

const CONDICION_AUTORIDAD_LEASE_BLOQUEADA = `WHERE operacion_id=?
  AND estado='ejecutando' AND instancia_id=?
  AND lease_token=? AND fencing_token=?`;

async function seleccionarPorId(conexion, operacionId, { bloquear }) {
  const [filas] = await conexion.execute(
    `${SELECCION_OPERACION} WHERE operacion_id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [uuidV7AuditoriaABytes(operacionId)]
  );
  return filas[0] || null;
}

async function seleccionarPorClave(conexion, claveOperacion, { bloquear }) {
  const [filas] = await conexion.execute(
    `${SELECCION_OPERACION} WHERE clave_operacion=?${bloquear ? ' FOR UPDATE' : ''}`,
    [uuidV7AuditoriaABytes(claveOperacion)]
  );
  return filas[0] || null;
}

async function seleccionarLeaseVigente(conexion, lease) {
  const [filas] = await conexion.execute(
    `${SELECCION_OPERACION}
      WHERE operacion_id=? AND estado='ejecutando' AND instancia_id=?
        AND lease_token=? AND fencing_token=?
        AND lease_expira_utc>UTC_TIMESTAMP(3)
      FOR UPDATE`,
    parametrosLease(lease)
  );
  return filas[0] || null;
}

function parametrosLease(
  { operacionId, instanciaId, leaseToken, fencingToken },
  prefijo = []
) {
  return [
    ...prefijo,
    uuidV7AuditoriaABytes(operacionId),
    ascii(instanciaId, 128, 'instanciaId'),
    tokenLease(leaseToken),
    fencing(fencingToken)
  ];
}

function parametrosInsercion(comando, canonico, huella, maxIntentos) {
  return [
    uuidV7AuditoriaABytes(comando.identidades.operacionId),
    uuidV7AuditoriaABytes(comando.identidades.claveOperacion),
    uuidV7AuditoriaABytes(comando.identidades.correlacionId),
    uuidV7AuditoriaABytes(comando.identidades.eventoId),
    comando.tipoOperacion,
    comando.version,
    comando.sujeto.tipo,
    comando.sujeto.id,
    comando.sujeto.guid ?? null,
    comando.fotografiaAutorizacion.actorReal.usuarioId,
    comando.fotografiaAutorizacion.actorEfectivo.usuarioId,
    comando.fotografiaAutorizacion.destinatarioUsuarioId,
    canonico,
    huella,
    maxIntentos
  ];
}

async function liberarRecursos(conexion, operacionId) {
  const [resultado] = await conexion.execute(
    `UPDATE recursos_operaciones_administrativas
        SET estado_reclamo='liberado',liberado_en_utc=UTC_TIMESTAMP(3)
      WHERE operacion_id=? AND estado_reclamo='activo'`,
    [uuidV7AuditoriaABytes(operacionId)]
  );
  if (Number(resultado.affectedRows) < 1) {
    throw new Error('La operación terminal no conservaba recursos activos.');
  }
}

async function cerrarLeaseAgotado(conexion) {
  const [filas] = await conexion.execute(
    `${SELECCION_OPERACION}
      WHERE estado='ejecutando' AND intentos>=max_intentos
        AND lease_expira_utc<=UTC_TIMESTAMP(3)
      ORDER BY lease_expira_utc,creada_en_utc,operacion_id
      LIMIT 1 FOR UPDATE SKIP LOCKED`
  );
  if (!filas[0]) return false;
  const operacionId = bytesAUuidV7Auditoria(filas[0].operacion_id);
  const codigo =
    CODIGOS_DIAGNOSTICO_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA.ERROR_PERMANENTE;
  const mensaje = 'La operación agotó sus intentos después de perder el último lease.';
  const resultado = canonicalizarRfc8785({
    estado: 'fallida',
    error: { codigo, mensaje }
  });
  const [actualizacion] = await conexion.execute(
    `UPDATE operaciones_administrativas
        SET estado='fallida',instancia_id=NULL,lease_token=NULL,
            lease_expira_utc=NULL,ultimo_codigo_error=?,ultimo_mensaje_error=?,
            resultado_canonico=?,terminada_en_utc=UTC_TIMESTAMP(3),
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE operacion_id=? AND estado='ejecutando'
        AND intentos>=max_intentos AND lease_expira_utc<=UTC_TIMESTAMP(3)`,
    [codigo, mensaje, resultado, uuidV7AuditoriaABytes(operacionId)]
  );
  if (Number(actualizacion.affectedRows) !== 1) return false;
  await liberarRecursos(conexion, operacionId);
  return true;
}

function contratoDesdeComando(comando) {
  return {
    tipo: String(comando?.tipoOperacion || ''),
    version: Number(comando?.version)
  };
}

function claveReutilizada() {
  return new ErrorPersistenciaOperacionAdministrativa(
    'clave_operacion_administrativa_reutilizada',
    'La clave de operación ya protege una intención diferente.'
  );
}

function esDuplicadoIdentidadOperacion(error) {
  const detalle = String(error?.message || '');
  return [
    'PRIMARY',
    'uk_operaciones_administrativas_evento'
  ].some((indice) => detalle.includes(indice));
}

function tokenLease(valor) {
  const token = Buffer.isBuffer(valor) ? Buffer.from(valor) : Buffer.alloc(0);
  if (token.length !== 32) throw new Error('leaseToken debe contener 32 bytes.');
  return token;
}

function fencing(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error('fencingToken debe ser un entero decimal positivo.');
  }
  return texto;
}

function ascii(valor, maximo, campo) {
  const texto = String(valor || '');
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/u.test(texto)) {
    throw new Error(`${campo} no es ASCII válido.`);
  }
  return texto;
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

function codigoDiagnostico(valor) {
  const texto = String(valor || '');
  if (!CODIGOS_DIAGNOSTICO.has(texto)) {
    throw new Error('El código no pertenece al diagnóstico administrativo cerrado.');
  }
  return texto;
}

function mensajeDiagnostico(valor) {
  const texto = String(valor || '').trim();
  if (!texto || Buffer.byteLength(texto, 'utf8') > 512) {
    throw new Error('El mensaje de diagnóstico no es válido.');
  }
  return texto;
}
