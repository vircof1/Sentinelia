import { createHash } from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { crearOcurrenciaOrigenFederada } from '../src/EnvolventeFederacion.js';
import {
  FAMILIAS_FEDERACION,
  PRIORIDADES_FLUJO_FEDERACION
} from '../src/CatalogosFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';
import {
  listarReferenciasContenidoSensibleFederacion,
  restaurarContenidoSensibleFederacion,
  separarContenidoSensibleFederacion
} from '../src/SeparacionContenidoSensibleFederacion.js';

const MAXIMO_BYTES_OCURRENCIA = 2 * 1024 * 1024;
const ESTADOS_GENERACION_TERMINALES = new Set(['cancelada', 'sustituida']);
const CLASES_POSICION_CORTE = new Set(['fotografiaInicial', 'cambioPosterior']);

export class ErrorPersistenciaOcurrenciaFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorPersistenciaOcurrenciaFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioOcurrenciasFederacionSql {
  constructor(clienteSql, {
    installationLocalId,
    protectorContenidoSensible = null
  } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Las ocurrencias federadas requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.installationLocalId = String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: String(installationLocalId || '')
    }));
    this.protectorContenidoSensible = protectorContenidoSensible;
  }

  async registrarOcurrenciaEnTransaccion({ definicion, destinos } = {}, {
    conexion
  } = {}) {
    exigirConexionPrestada(conexion);
    await exigirTransaccionActiva(conexion);
    const definicionNormalizada = rehidratarIdentidadesDefinicion(definicion);
    const provisional = crearOcurrenciaOrigenFederada({
      ...definicionNormalizada,
      // La secuencia forma parte del contrato y nunca puede ser cero. Se usa
      // un valor válido únicamente para validar/canonicalizar la intención;
      // se elimina antes de calcular su huella y SQL asigna el valor efectivo.
      secuenciaElemento: '1'
    });
    const datosProvisionales = provisional.toJSON();
    if (datosProvisionales.installationOrigenId !== this.installationLocalId) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'origen_local_incompatible',
        'La asignación de secuencia local solo admite ocurrencias nacidas en esta instalación.'
      );
    }
    const destinosNormalizados = normalizarDestinos(destinos);
    const { secuenciaElemento: _omitida, ...intencionCompleta } = datosProvisionales;
    const intencion = separarContenidoSensibleFederacion(intencionCompleta).publico;
    const intencionCanonica = canonicalizarJsonFederacion(intencion);
    const intencionHash = sha256(intencionCanonica);
    const identidad = identidadDesde(datosProvisionales);
    for (const destino of destinosNormalizados) {
      await bloquearYValidarDestino(conexion, {
        destino,
        familia: datosProvisionales.familia,
        versionFamilia: datosProvisionales.familiaVersion,
        installationLocalId: this.installationLocalId
      });
    }
    const ahora = await ahoraSql(conexion);

    await reservarIdentidad(conexion, {
      ...identidad,
      intencionHash,
      ahora
    });
    const reserva = await obtenerReservaBloqueada(conexion, identidad);
    if (!reserva || !hashIgual(reserva.intencion_sha256, intencionHash)) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'identidad_causal_divergente',
        'La identidad preasignada ya pertenece a otra intención inmutable.'
      );
    }

    let ocurrencia;
    let estadoRegistro;
    if (reserva.secuencia_elemento === null) {
      const secuencia = await asignarSecuenciaElemento(conexion, identidad, ahora);
      ocurrencia = crearOcurrenciaOrigenFederada({
        ...definicionNormalizada,
        secuenciaElemento: secuencia
      });
      await insertarOcurrencia(
        conexion,
        ocurrencia,
        ahora,
        this.protectorContenidoSensible
      );
      const [consolidacion] = await conexion.execute(
        `UPDATE reservas_identidad_ocurrencias_federacion
            SET secuencia_elemento=?,consolidada_en_utc=?
          WHERE installation_origen_id=? AND familia=?
            AND elemento_origen_id=? AND ocurrencia_origen_id=?
            AND secuencia_elemento IS NULL`,
        [
          secuencia,
          ahora,
          identidad.installationOrigenId,
          identidad.familia,
          identidad.elementoOrigenId,
          identidad.ocurrenciaOrigenId
        ]
      );
      if (consolidacion.affectedRows !== 1) throw errorConcurrente();
      estadoRegistro = 'creada';
    } else {
      ocurrencia = await cargarOcurrencia(
        conexion,
        identidad,
        this.protectorContenidoSensible
      );
      if (!ocurrencia) {
        throw new ErrorPersistenciaOcurrenciaFederacion(
          'reserva_sin_ocurrencia',
          'La reserva causal consolidada perdió su ocurrencia durable.'
        );
      }
      const esperado = crearOcurrenciaOrigenFederada({
        ...definicionNormalizada,
        secuenciaElemento: String(reserva.secuencia_elemento)
      });
      if (ocurrencia.canonicalizar() !== esperado.canonicalizar()) {
        throw new ErrorPersistenciaOcurrenciaFederacion(
          'ocurrencia_inmutable_divergente',
          'El replay intenta reinterpretar una ocurrencia ya persistida.'
        );
      }
      estadoRegistro = 'yaConocida';
    }

    const posiciones = [];
    for (const destino of destinosNormalizados) {
      posiciones.push(await asignarPosicion(conexion, {
        destino,
        identidad,
        familia: ocurrencia.toJSON().familia,
        versionFamilia: ocurrencia.toJSON().familiaVersion,
        installationLocalId: this.installationLocalId,
        ahora
      }));
    }
    return Object.freeze({
      estado: estadoRegistro,
      ocurrencia,
      posiciones: Object.freeze(posiciones)
    });
  }

  async registrarOcurrenciaRefederadaEnTransaccion({ ocurrencia, destinos } = {}, {
    conexion
  } = {}) {
    exigirConexionPrestada(conexion);
    await exigirTransaccionActiva(conexion);
    const definicion = rehidratarIdentidadesDefinicion(
      typeof ocurrencia?.toJSON === 'function' ? ocurrencia.toJSON() : ocurrencia
    );
    const validada = crearOcurrenciaOrigenFederada(definicion);
    const datos = validada.toJSON();
    if (datos.installationOrigenId === this.installationLocalId) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'origen_refederado_local',
        'Una ocurrencia local debe usar la captura que asigna su secuencia de origen.'
      );
    }
    const destinosNormalizados = normalizarDestinos(destinos);
    for (const destino of destinosNormalizados) {
      await bloquearYValidarDestino(conexion, {
        destino,
        familia: datos.familia,
        versionFamilia: datos.familiaVersion,
        installationLocalId: this.installationLocalId
      });
    }
    const { secuenciaElemento: _omitida, ...intencionCompleta } = datos;
    const intencionCanonica = canonicalizarJsonFederacion(
      separarContenidoSensibleFederacion(intencionCompleta).publico
    );
    const intencionHash = sha256(intencionCanonica);
    const identidad = identidadDesde(datos);
    const ahora = await ahoraSql(conexion);
    await reservarIdentidad(conexion, { ...identidad, intencionHash, ahora });
    const reserva = await obtenerReservaBloqueada(conexion, identidad);
    if (!reserva || !hashIgual(reserva.intencion_sha256, intencionHash)) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'identidad_causal_divergente',
        'La identidad refederada ya pertenece a otra intención inmutable.'
      );
    }
    let estadoRegistro = 'yaConocida';
    if (reserva.secuencia_elemento === null) {
      try {
        await insertarOcurrencia(
          conexion,
          validada,
          ahora,
          this.protectorContenidoSensible
        );
      } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
        throw new ErrorPersistenciaOcurrenciaFederacion(
          'secuencia_origen_refederada_divergente',
          'La secuencia conservada por la ocurrencia refederada identifica otro hecho.'
        );
      }
      const [consolidacion] = await conexion.execute(
        `UPDATE reservas_identidad_ocurrencias_federacion
            SET secuencia_elemento=?,consolidada_en_utc=?
          WHERE installation_origen_id=? AND familia=?
            AND elemento_origen_id=? AND ocurrencia_origen_id=?
            AND secuencia_elemento IS NULL`,
        [datos.secuenciaElemento, ahora, ...parametrosIdentidad(identidad)]
      );
      if (consolidacion.affectedRows !== 1) throw errorConcurrente();
      estadoRegistro = 'creada';
    } else {
      if (String(reserva.secuencia_elemento) !== datos.secuenciaElemento) {
        throw new ErrorPersistenciaOcurrenciaFederacion(
          'secuencia_origen_refederada_divergente',
          'El replay intenta reinterpretar la secuencia asignada por el origen.'
        );
      }
      const persistida = await cargarOcurrencia(
        conexion,
        identidad,
        this.protectorContenidoSensible
      );
      if (!persistida || persistida.canonicalizar() !== validada.canonicalizar()) {
        throw new ErrorPersistenciaOcurrenciaFederacion(
          'ocurrencia_inmutable_divergente',
          'El replay intenta reinterpretar una ocurrencia refederada ya persistida.'
        );
      }
    }
    const posiciones = [];
    for (const destino of destinosNormalizados) {
      posiciones.push(await asignarPosicion(conexion, {
        destino,
        identidad,
        familia: datos.familia,
        versionFamilia: datos.familiaVersion,
        installationLocalId: this.installationLocalId,
        ahora
      }));
    }
    return Object.freeze({
      estado: estadoRegistro,
      ocurrencia: validada,
      posiciones: Object.freeze(posiciones)
    });
  }

  async buscarOcurrenciaPorIdentidad({
    installationOrigenId,
    familia,
    elementoOrigenId,
    ocurrenciaOrigenId
  } = {}) {
    const identidad = {
      installationOrigenId: identidadTexto(
        installationOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
        'installationOrigenId'
      ),
      familia: FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' }),
      elementoOrigenId: identidadTexto(
        elementoOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
        'elementoOrigenId'
      ),
      ocurrenciaOrigenId: identidadTexto(
        ocurrenciaOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
        'ocurrenciaOrigenId'
      )
    };
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      return await cargarOcurrencia(conexion, identidad, this.protectorContenidoSensible);
    } finally {
      conexion.release();
    }
  }

  async purgarContenidoSensible({
    installationOrigenId,
    familia,
    elementoOrigenId,
    ocurrenciaOrigenId
  } = {}) {
    const [resultado] = await this.clienteSql.ejecutar(
      `DELETE s FROM secretos_ocurrencias_federacion s
        JOIN ocurrencias_federacion o ON o.id=s.ocurrencia_id
       WHERE o.installation_origen_id=? AND o.familia=?
         AND o.elemento_origen_id=? AND o.ocurrencia_origen_id=?`,
      [installationOrigenId, familia, elementoOrigenId, ocurrenciaOrigenId]
    );
    return Object.freeze({ purgado: resultado.affectedRows === 1 });
  }

  async bloquearCorteInicialEnTransaccion({ flujoId, generacionId } = {}, {
    conexion
  } = {}) {
    exigirConexionPrestada(conexion);
    await exigirTransaccionActiva(conexion);
    const destino = {
      flujoId: identidadTexto(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId'),
      generacionId: identidadTexto(
        generacionId,
        TIPOS_IDENTIDAD_FEDERADA.GENERACION,
        'generacionId'
      )
    };
    const corte = await obtenerCorteBloqueado(conexion, destino);
    if (!corte) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'corte_inicial_inexistente',
        'La generación no fue preparada para construir una fotografía inicial.'
      );
    }
    return Object.freeze({
      flujoId: corte.flujo_id,
      generacionId: corte.generacion_id,
      estado: corte.estado,
      fronteraInicial: corte.frontera_inicial === null
        ? null
        : String(corte.frontera_inicial),
      totalCambiosAbsorbidos: Number(corte.total_cambios_absorbidos)
    });
  }

  async cerrarCorteInicialEnTransaccion({ flujoId, generacionId } = {}, {
    conexion
  } = {}) {
    exigirConexionPrestada(conexion);
    await exigirTransaccionActiva(conexion);
    const destino = {
      flujoId: identidadTexto(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId'),
      generacionId: identidadTexto(
        generacionId,
        TIPOS_IDENTIDAD_FEDERADA.GENERACION,
        'generacionId'
      )
    };
    const corte = await obtenerCorteBloqueado(conexion, destino);
    if (!corte) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'corte_inicial_inexistente',
        'La generación no fue preparada para construir una fotografía inicial.'
      );
    }
    if (corte.estado === 'cerrado') {
      return serializarCierreCorte(corte);
    }
    const gobiernaFlujo = corte.rol_generacion === 'activa' &&
      corte.generacion_activa_id === destino.generacionId;
    const esCandidata = corte.rol_generacion === 'candidata';
    if ((!gobiernaFlujo && !esCandidata) || corte.estado_generacion !== 'preparada') {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'corte_inicial_no_preparable',
        'Solo la generación activa y preparada puede cerrar su fotografía inicial.'
      );
    }
    const [resumenesFotografia] = await conexion.execute(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(clase_posicion='fotografiaInicial'),0) AS total_fotografia,
              COALESCE(MAX(posicion_flujo),0) AS maxima_posicion
         FROM posiciones_ocurrencias_flujos_federacion
        WHERE flujo_id=? AND generacion_id=?`,
      [destino.flujoId, destino.generacionId]
    );
    const resumenFotografia = resumenesFotografia[0];
    const totalFotografia = BigInt(String(resumenFotografia.total));
    if (BigInt(String(resumenFotografia.total_fotografia)) !== totalFotografia ||
        BigInt(String(resumenFotografia.maxima_posicion)) !== totalFotografia) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'fotografia_inicial_no_densa',
        'El corte inicial contiene posiciones ajenas o un hueco antes de cerrarse.'
      );
    }
    const fronteraInicial = totalFotografia.toString();
    const ahora = await ahoraSql(conexion);
    const [frontera] = await conexion.execute(
      `UPDATE fronteras_generaciones_federacion
          SET posicion_inicial_comprometida=?,version_frontera=version_frontera+1,
              actualizada_en_utc=?
        WHERE generacion_id=? AND posicion_inicial_comprometida=0`,
      [fronteraInicial, ahora, destino.generacionId]
    );
    const [cierre] = await conexion.execute(
      `UPDATE cortes_iniciales_generaciones_federacion
          SET estado='cerrado',frontera_inicial=?,version_corte=version_corte+1,
              cerrado_en_utc=?,actualizado_en_utc=?
        WHERE generacion_id=? AND flujo_id=? AND estado='pendiente'`,
      [fronteraInicial, ahora, ahora, destino.generacionId, destino.flujoId]
    );
    if (frontera.affectedRows !== 1 || cierre.affectedRows !== 1) {
      throw errorConcurrente();
    }
    const [absorcion] = await conexion.execute(
      `UPDATE cambios_pendientes_corte_federacion
          SET estado='absorbida',absorbida_en_utc=?
        WHERE flujo_id=? AND generacion_id=? AND estado='pendiente'`,
      [ahora, destino.flujoId, destino.generacionId]
    );
    return Object.freeze({
      flujoId: destino.flujoId,
      generacionId: destino.generacionId,
      estado: 'cerrado',
      fronteraInicial,
      totalFotografia: fronteraInicial,
      totalCambiosAbsorbidos: absorcion.affectedRows
    });
  }
}

async function reservarIdentidad(conexion, entrada) {
  try {
    await conexion.execute(
      `INSERT INTO reservas_identidad_ocurrencias_federacion (
         installation_origen_id,familia,elemento_origen_id,
         ocurrencia_origen_id,intencion_sha256,secuencia_elemento,
         reservada_en_utc,consolidada_en_utc
       ) VALUES (?,?,?,?,?,NULL,?,NULL)`,
      [
        entrada.installationOrigenId,
        entrada.familia,
        entrada.elementoOrigenId,
        entrada.ocurrenciaOrigenId,
        entrada.intencionHash,
        entrada.ahora
      ]
    );
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
  }
}

async function obtenerReservaBloqueada(conexion, identidad) {
  const [filas] = await conexion.execute(
    `SELECT intencion_sha256,secuencia_elemento
       FROM reservas_identidad_ocurrencias_federacion
      WHERE installation_origen_id=? AND familia=?
        AND elemento_origen_id=? AND ocurrencia_origen_id=?
      FOR UPDATE`,
    parametrosIdentidad(identidad)
  );
  return filas[0] || null;
}

async function asignarSecuenciaElemento(conexion, identidad, ahora) {
  try {
    await conexion.execute(
      `INSERT INTO contadores_secuencia_elementos_federacion (
         installation_origen_id,familia,elemento_origen_id,
         ultima_secuencia,version_contador,actualizada_en_utc
       ) VALUES (?,?,?,0,1,?)`,
      [
        identidad.installationOrigenId,
        identidad.familia,
        identidad.elementoOrigenId,
        ahora
      ]
    );
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
  }
  const [avance] = await conexion.execute(
    `UPDATE contadores_secuencia_elementos_federacion
        SET ultima_secuencia=ultima_secuencia+1,
            version_contador=version_contador+1,
            actualizada_en_utc=GREATEST(actualizada_en_utc,?)
      WHERE installation_origen_id=? AND familia=? AND elemento_origen_id=?`,
    [
      ahora,
      identidad.installationOrigenId,
      identidad.familia,
      identidad.elementoOrigenId
    ]
  );
  if (avance.affectedRows !== 1) throw errorConcurrente();
  const [filas] = await conexion.execute(
    `SELECT ultima_secuencia
       FROM contadores_secuencia_elementos_federacion
      WHERE installation_origen_id=? AND familia=? AND elemento_origen_id=?`,
    [identidad.installationOrigenId, identidad.familia, identidad.elementoOrigenId]
  );
  return String(filas[0].ultima_secuencia);
}

async function insertarOcurrencia(conexion, ocurrencia, ahora, protector) {
  const datos = ocurrencia.toJSON();
  const canonicoOriginal = ocurrencia.canonicalizar();
  const bytes = Buffer.byteLength(canonicoOriginal, 'utf8');
  if (bytes > MAXIMO_BYTES_OCURRENCIA) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'ocurrencia_excede_limite_duro',
      'La ocurrencia supera el máximo físico de la primera beta.'
    );
  }
  const separacion = separarContenidoSensibleFederacion(datos);
  if (separacion.contenidoSensible && typeof protector?.cifrar !== 'function') {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'custodia_sensible_ausente',
      'La ocurrencia emisora contiene campos sensibles sin custodia cifrada operativa.'
    );
  }
  const canonico = canonicalizarJsonFederacion(separacion.publico);
  const [insercion] = await conexion.execute(
    `INSERT INTO ocurrencias_federacion (
       installation_origen_id,familia,version_familia,elemento_origen_id,
       ocurrencia_origen_id,secuencia_elemento,operacion,tiempo_origen_utc,
       payload_canonico,payload_sha256,registrada_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      datos.installationOrigenId,
      datos.familia,
      datos.familiaVersion,
      datos.elementoOrigenId,
      datos.ocurrenciaOrigenId,
      datos.secuenciaElemento,
      datos.operacion,
      fechaSql(datos.tiempoOrigenUtc),
      canonico,
      sha256(canonico),
      ahora
    ]
  );
  if (separacion.contenidoSensible) {
    const identidad = identidadDesde(datos);
    const sobre = protector.cifrar({
      contenido: separacion.contenidoSensible,
      aad: contextoContenidoSensible(identidad)
    });
    await conexion.execute(
      `INSERT INTO secretos_ocurrencias_federacion (
         ocurrencia_id,perfil,keyring_referencia,key_id,nonce,ciphertext,
         auth_tag,contenido_sha256,creado_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        insercion.insertId, sobre.perfil, sobre.keyringReferencia, sobre.keyId,
        sobre.nonce, sobre.ciphertext, sobre.authTag, sha256(canonicoOriginal), ahora
      ]
    );
  }
}

async function cargarOcurrencia(conexion, identidad, protector) {
  const [filas] = await conexion.execute(
    `SELECT o.installation_origen_id,o.familia,o.version_familia,
            o.elemento_origen_id,o.ocurrencia_origen_id,
            o.secuencia_elemento,o.operacion,o.tiempo_origen_utc,
            o.payload_canonico,o.payload_sha256,
            s.perfil AS sensible_perfil,s.keyring_referencia,s.key_id,
            s.nonce,s.ciphertext,s.auth_tag,
            s.contenido_sha256 AS sensible_contenido_sha256,
            r.secuencia_elemento AS secuencia_reservada
       FROM ocurrencias_federacion o
       JOIN reservas_identidad_ocurrencias_federacion r
         ON r.installation_origen_id=o.installation_origen_id
        AND r.familia=o.familia
        AND r.elemento_origen_id=o.elemento_origen_id
        AND r.ocurrencia_origen_id=o.ocurrencia_origen_id
       LEFT JOIN secretos_ocurrencias_federacion s ON s.ocurrencia_id=o.id
      WHERE o.installation_origen_id=? AND o.familia=?
        AND o.elemento_origen_id=? AND o.ocurrencia_origen_id=?`,
    parametrosIdentidad(identidad)
  );
  if (!filas[0]) return null;
  const canonico = String(filas[0].payload_canonico);
  if (!hashIgual(filas[0].payload_sha256, sha256(canonico))) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'contenido_durable_invalido',
      'La huella durable de la ocurrencia no coincide con su contenido canónico.'
    );
  }
  let datos = JSON.parse(canonico);
  if (listarReferenciasContenidoSensibleFederacion(datos).length > 0) {
    if (!filas[0].sensible_perfil || typeof protector?.descifrar !== 'function') {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'contenido_sensible_purgado',
        'La ocurrencia conserva identidad, pero su contenido sensible ya no es recuperable.'
      );
    }
    const sensible = protector.descifrar({
      sobre: {
        perfil: filas[0].sensible_perfil,
        keyringReferencia: filas[0].keyring_referencia,
        keyId: filas[0].key_id,
        nonce: Buffer.from(filas[0].nonce),
        ciphertext: Buffer.from(filas[0].ciphertext),
        authTag: Buffer.from(filas[0].auth_tag)
      },
      aad: contextoContenidoSensible(identidad)
    });
    datos = restaurarContenidoSensibleFederacion(datos, sensible);
    if (!Buffer.from(filas[0].sensible_contenido_sha256).equals(
      sha256(canonicalizarJsonFederacion(datos))
    )) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'contenido_sensible_divergente',
        'La custodia sensible emisora no coincide con la ocurrencia original.'
      );
    }
  }
  const ocurrencia = crearOcurrenciaOrigenFederada({
    ...datos,
    installationOrigenId: crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: datos.installationOrigenId
    }),
    elementoOrigenId: crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
      valor: datos.elementoOrigenId
    }),
    ocurrenciaOrigenId: crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
      valor: datos.ocurrenciaOrigenId
    })
  });
  const canonicoPersistible = canonicalizarJsonFederacion(
    separarContenidoSensibleFederacion(ocurrencia.toJSON()).publico
  );
  if (canonicoPersistible !== canonico) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'contenido_no_canonico',
      'La ocurrencia durable dejó de usar su representación canónica exacta.'
    );
  }
  const fila = filas[0];
  if (fila.installation_origen_id !== datos.installationOrigenId ||
      fila.familia !== datos.familia ||
      Number(fila.version_familia) !== datos.familiaVersion ||
      fila.elemento_origen_id !== datos.elementoOrigenId ||
      fila.ocurrencia_origen_id !== datos.ocurrenciaOrigenId ||
      String(fila.secuencia_elemento) !== datos.secuenciaElemento ||
      String(fila.secuencia_reservada) !== datos.secuenciaElemento ||
      fila.operacion !== datos.operacion ||
      fechaUtcDesdeSql(fila.tiempo_origen_utc) !== datos.tiempoOrigenUtc) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'metadatos_durables_divergentes',
      'Las columnas indexadas, la reserva y el contenido canónico no describen la misma ocurrencia.'
    );
  }
  return ocurrencia;
}

function contextoContenidoSensible(identidad) {
  return {
    perfil: 'sentinelia-federacion-contexto-contenido-sensible-v1',
    ...identidad
  };
}

async function asignarPosicion(conexion, {
  destino,
  identidad,
  familia,
  versionFamilia,
  installationLocalId,
  ahora
}) {
  const generacion = await bloquearYValidarDestino(conexion, {
    destino,
    familia,
    versionFamilia,
    installationLocalId
  });
  if (generacion.estado_corte === 'pendiente' &&
      destino.clasePosicion === 'cambioPosterior') {
    await registrarCambioPendienteCorte(conexion, {
      destino,
      identidad,
      ahora
    });
    return Object.freeze({
      flujoId: destino.flujoId,
      generacionId: destino.generacionId,
      posicionFlujo: null,
      prioridad: destino.prioridad,
      clasePosicion: destino.clasePosicion,
      estado: 'pendienteCorte'
    });
  }
  if (generacion.estado_corte === 'cerrado' &&
      destino.clasePosicion === 'fotografiaInicial') {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'fotografia_inicial_cerrada',
      'Una fotografía cerrada no admite nuevas posiciones iniciales.'
    );
  }
  const [existentes] = await conexion.execute(
    `SELECT posicion_flujo,clase_posicion
       FROM posiciones_ocurrencias_flujos_federacion
      WHERE flujo_id=? AND generacion_id=?
        AND installation_origen_id=? AND familia=?
        AND elemento_origen_id=? AND ocurrencia_origen_id=?`,
    [destino.flujoId, destino.generacionId, ...parametrosIdentidad(identidad)]
  );
  if (existentes[0]) {
    return Object.freeze({
      flujoId: destino.flujoId,
      generacionId: destino.generacionId,
      posicionFlujo: String(existentes[0].posicion_flujo),
      prioridad: destino.prioridad,
      clasePosicion: existentes[0].clase_posicion,
      estado: 'yaAsignada'
    });
  }
  const marcaCorte = await obtenerMarcaCorte(conexion, { destino, identidad });
  if (marcaCorte?.estado === 'absorbida') {
    if (marcaCorte.prioridad !== destino.prioridad) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'cambio_absorbido_divergente',
        'El replay intenta reinterpretar la prioridad de un cambio absorbido.'
      );
    }
    return Object.freeze({
      flujoId: destino.flujoId,
      generacionId: destino.generacionId,
      posicionFlujo: null,
      prioridad: marcaCorte.prioridad,
      clasePosicion: destino.clasePosicion,
      estado: 'absorbidaCorte'
    });
  }
  try {
    await conexion.execute(
      `INSERT INTO contadores_posiciones_generaciones_federacion (
         flujo_id,generacion_id,ultima_posicion,version_contador,actualizada_en_utc
       ) VALUES (?,?,0,1,?)`,
      [destino.flujoId, destino.generacionId, ahora]
    );
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
  }
  const [avance] = await conexion.execute(
    `UPDATE contadores_posiciones_generaciones_federacion
        SET ultima_posicion=ultima_posicion+1,
            version_contador=version_contador+1,
            actualizada_en_utc=GREATEST(actualizada_en_utc,?)
      WHERE flujo_id=? AND generacion_id=?`,
    [ahora, destino.flujoId, destino.generacionId]
  );
  if (avance.affectedRows !== 1) throw errorConcurrente();
  const [contadores] = await conexion.execute(
    `SELECT ultima_posicion
       FROM contadores_posiciones_generaciones_federacion
      WHERE flujo_id=? AND generacion_id=?`,
    [destino.flujoId, destino.generacionId]
  );
  const posicionFlujo = String(contadores[0].ultima_posicion);
  await conexion.execute(
    `INSERT INTO posiciones_ocurrencias_flujos_federacion (
       flujo_id,generacion_id,posicion_flujo,clase_posicion,installation_origen_id,
       familia,elemento_origen_id,ocurrencia_origen_id,asignada_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      destino.flujoId,
      destino.generacionId,
      posicionFlujo,
      destino.clasePosicion,
      ...parametrosIdentidad(identidad),
      ahora
    ]
  );
  return Object.freeze({
    flujoId: destino.flujoId,
    generacionId: destino.generacionId,
    posicionFlujo,
    prioridad: destino.prioridad,
    clasePosicion: destino.clasePosicion,
    estado: 'asignada'
  });
}

async function bloquearYValidarDestino(conexion, {
  destino,
  familia,
  versionFamilia,
  installationLocalId
}) {
  const [generaciones] = await conexion.execute(
    `SELECT f.familia,f.version_familia,f.direccion,g.estado,
            g.installation_propietaria_id,r.estado_ciclo,r.estado_autoridad,
            r.estado_identidad,r.estado_compatibilidad,
            c.estado AS estado_corte
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
       JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
       LEFT JOIN cortes_iniciales_generaciones_federacion c
         ON c.flujo_id=f.flujo_id AND c.generacion_id=g.generacion_id
      WHERE f.flujo_id=? FOR UPDATE`,
    [destino.generacionId, destino.flujoId]
  );
  const generacion = generaciones[0];
  if (!generacion) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'destino_inexistente',
      'El flujo o generación de destino no existe.'
    );
  }
  if (generacion.familia !== familia ||
      Number(generacion.version_familia) !== Number(versionFamilia)) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'contrato_destino_incompatible',
      'Una ocurrencia no puede incorporarse a un flujo de otra familia o versión.'
    );
  }
  if (generacion.direccion !== 'emision' ||
      generacion.installation_propietaria_id !== installationLocalId) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'direccion_destino_incompatible',
      'Una ocurrencia local solo puede recibir posición en un flujo emisor local.'
    );
  }
  if (generacion.estado_ciclo !== 'vinculada' ||
      generacion.estado_autoridad !== 'autorizada' ||
      generacion.estado_identidad !== 'valida' ||
      !['compatible', 'compatibleParcial'].includes(generacion.estado_compatibilidad)) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'relacion_destino_no_operativa',
      'La relación ya no autoriza incorporar trabajo nuevo a este flujo.'
    );
  }
  if (ESTADOS_GENERACION_TERMINALES.has(generacion.estado)) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'generacion_terminal',
      'Una generación terminal no admite posiciones nuevas.'
    );
  }
  return generacion;
}

async function registrarCambioPendienteCorte(conexion, {
  destino,
  identidad,
  ahora
}) {
  try {
    await conexion.execute(
      `INSERT INTO cambios_pendientes_corte_federacion (
         flujo_id,generacion_id,installation_origen_id,familia,
         elemento_origen_id,ocurrencia_origen_id,prioridad,registrada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        destino.flujoId,
        destino.generacionId,
        ...parametrosIdentidad(identidad),
        destino.prioridad,
        ahora
      ]
    );
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const [filas] = await conexion.execute(
      `SELECT prioridad
         FROM cambios_pendientes_corte_federacion
        WHERE flujo_id=? AND generacion_id=?
          AND installation_origen_id=? AND familia=?
          AND elemento_origen_id=? AND ocurrencia_origen_id=?
        FOR UPDATE`,
      [destino.flujoId, destino.generacionId, ...parametrosIdentidad(identidad)]
    );
    if (!filas[0] || filas[0].prioridad !== destino.prioridad) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'cambio_pendiente_divergente',
        'El replay intenta reinterpretar la prioridad de un cambio pendiente.'
      );
    }
  }
}

async function obtenerMarcaCorte(conexion, { destino, identidad }) {
  const [filas] = await conexion.execute(
    `SELECT prioridad,estado
       FROM cambios_pendientes_corte_federacion
      WHERE flujo_id=? AND generacion_id=?
        AND installation_origen_id=? AND familia=?
        AND elemento_origen_id=? AND ocurrencia_origen_id=?
      FOR UPDATE`,
    [destino.flujoId, destino.generacionId, ...parametrosIdentidad(identidad)]
  );
  return filas[0] || null;
}

async function obtenerCorteBloqueado(conexion, { flujoId, generacionId }) {
  const [filas] = await conexion.execute(
    `SELECT c.*,f.generacion_activa_id,g.estado AS estado_generacion,
            g.rol_generacion,
            (SELECT COUNT(*)
               FROM cambios_pendientes_corte_federacion m
              WHERE m.flujo_id=c.flujo_id
                AND m.generacion_id=c.generacion_id
                AND m.estado='absorbida') AS total_cambios_absorbidos
       FROM cortes_iniciales_generaciones_federacion c
       JOIN flujos_federacion f ON f.flujo_id=c.flujo_id
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=c.flujo_id AND g.generacion_id=c.generacion_id
      WHERE c.flujo_id=? AND c.generacion_id=? FOR UPDATE`,
    [flujoId, generacionId]
  );
  return filas[0] || null;
}

function serializarCierreCorte(corte) {
  return Object.freeze({
    flujoId: corte.flujo_id,
    generacionId: corte.generacion_id,
    estado: corte.estado,
    fronteraInicial: String(corte.frontera_inicial),
    totalFotografia: String(corte.frontera_inicial),
    totalCambiosAbsorbidos: Number(corte.total_cambios_absorbidos)
  });
}

function normalizarDestinos(destinos) {
  if (!Array.isArray(destinos) || destinos.length === 0) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'destinos_ausentes',
      'Una ocurrencia federable necesita al menos un flujo de emisión.'
    );
  }
  const unicos = new Map();
  for (const destino of destinos) {
    const flujoId = identidadTexto(
      destino?.flujoId,
      TIPOS_IDENTIDAD_FEDERADA.FLUJO,
      'destino.flujoId'
    );
    const generacionId = identidadTexto(
      destino?.generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      'destino.generacionId'
    );
    const prioridad = PRIORIDADES_FLUJO_FEDERACION.exigir(
      destino?.prioridad ?? 'reconstruccion',
      { campo: 'destino.prioridad' }
    );
    const clasePosicion = String(
      destino?.clasePosicion ?? 'cambioPosterior'
    );
    if (!CLASES_POSICION_CORTE.has(clasePosicion)) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'clase_posicion_invalida',
        'La posición debe pertenecer a la fotografía inicial o a sus cambios posteriores.'
      );
    }
    const clave = `${flujoId}\u0000${generacionId}`;
    const anterior = unicos.get(clave);
    if (anterior && (anterior.prioridad !== prioridad ||
        anterior.clasePosicion !== clasePosicion)) {
      throw new ErrorPersistenciaOcurrenciaFederacion(
        'prioridad_destino_divergente',
        'Un mismo destino no puede reinterpretar prioridad ni clase de la ocurrencia.'
      );
    }
    unicos.set(clave, { flujoId, generacionId, prioridad, clasePosicion });
  }
  return [...unicos.values()].sort((a, b) =>
    a.flujoId.localeCompare(b.flujoId, 'en') ||
    a.generacionId.localeCompare(b.generacionId, 'en')
  );
}

function identidadDesde(datos) {
  return {
    installationOrigenId: datos.installationOrigenId,
    familia: datos.familia,
    elementoOrigenId: datos.elementoOrigenId,
    ocurrenciaOrigenId: datos.ocurrenciaOrigenId
  };
}

function parametrosIdentidad(identidad) {
  return [
    identidad.installationOrigenId,
    identidad.familia,
    identidad.elementoOrigenId,
    identidad.ocurrenciaOrigenId
  ];
}

function rehidratarIdentidadesDefinicion(definicion) {
  if (!definicion || typeof definicion !== 'object' || Array.isArray(definicion)) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'definicion_ocurrencia_invalida',
      'La captura debe aportar una definición de ocurrencia.'
    );
  }
  return {
    ...definicion,
    installationOrigenId: identidadOpaca(
      definicion.installationOrigenId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationOrigenId'
    ),
    elementoOrigenId: identidadOpaca(
      definicion.elementoOrigenId,
      TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
      'elementoOrigenId'
    ),
    ocurrenciaOrigenId: identidadOpaca(
      definicion.ocurrenciaOrigenId,
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
      'ocurrenciaOrigenId'
    )
  };
}

function identidadOpaca(valor, tipo, campo) {
  try {
    return crearIdentidadFederada({ tipo, valor: String(valor || '') });
  } catch (error) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'identidad_invalida',
      `${campo} no es canónica: ${error.message}`
    );
  }
}

function identidadTexto(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch (error) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'identidad_invalida',
      `${campo} no es canónica: ${error.message}`
    );
  }
}

function sha256(valor) {
  return createHash('sha256').update(valor, 'utf8').digest();
}

function hashIgual(a, b) {
  return Buffer.from(a).equals(Buffer.from(b));
}

function fechaSql(fechaUtc) {
  return String(fechaUtc).replace('T', ' ').replace('Z', '');
}

function fechaUtcDesdeSql(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor);
  return `${texto.includes('T') ? texto : texto.replace(' ', 'T')}${
    texto.endsWith('Z') ? '' : 'Z'
  }`;
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function exigirConexionPrestada(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'transaccion_prestada_ausente',
      'El registro de una ocurrencia exige la conexión SQL de la mutación productora.'
    );
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new ErrorPersistenciaOcurrenciaFederacion(
      'transaccion_prestada_inactiva',
      'La conexión prestada debe encontrarse dentro de la transacción productora.'
    );
  }
}

function errorConcurrente() {
  return new ErrorPersistenciaOcurrenciaFederacion(
    'asignacion_concurrente',
    'No se pudo consolidar la asignación monotónica de la ocurrencia.'
  );
}
