import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada,
  exigirIdentidadFederada
} from '../src/index.js';

export class RepositorioIdentidadFederacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error(
        'RepositorioIdentidadFederacionSql requiere un cliente SQL operativo.'
      );
    }
    this.clienteSql = clienteSql;
  }

  async obtenerIdentidadInstalacion({ conexion = null, bloquear = false } = {}) {
    const filas = await consultar({
      clienteSql: this.clienteSql,
      conexion,
      sql: `SELECT installation_id, version_contrato, creada_en_utc
              FROM identidad_instalacion_federacion
             WHERE id = 1
             ${bloquear ? 'FOR UPDATE' : ''}`
    });
    return filas[0] ? hidratarIdentidadInstalacion(filas[0]) : null;
  }

  async registrarArranqueEnTransaccion({
    installationId,
    bootId,
    conexion
  } = {}) {
    exigirConexion(conexion);
    const instalacionCandidata = exigirIdentidadFederada(installationId, {
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      campo: 'installationId'
    });
    const arranque = exigirIdentidadFederada(bootId, {
      tipo: TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
      campo: 'bootId'
    });

    await conexion.execute(
      `INSERT INTO identidad_instalacion_federacion (
         id, installation_id, version_contrato, creada_en_utc
       ) VALUES (1, ?, 1, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE id = VALUES(id)`,
      [instalacionCandidata.serializar()]
    );

    const identidadDurable = await this.obtenerIdentidadInstalacion({
      conexion,
      bloquear: true
    });
    if (!identidadDurable) {
      throw new Error('No se pudo consolidar la identidad durable de instalación.');
    }

    await conexion.execute(
      `INSERT INTO arranques_instalacion_federacion (
         boot_id,
         installation_id,
         version_contrato,
         iniciado_en_utc,
         registrado_en_utc
       ) VALUES (?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE boot_id = VALUES(boot_id)`,
      [arranque.serializar(), identidadDurable.installationId.serializar()]
    );

    const [filas] = await conexion.execute(
      `SELECT
         boot_id,
         installation_id,
         version_contrato,
         iniciado_en_utc,
         registrado_en_utc
       FROM arranques_instalacion_federacion
       WHERE boot_id = ?
       LIMIT 1
       FOR UPDATE`,
      [arranque.serializar()]
    );
    if (!filas[0]) {
      throw new Error('No se pudo registrar el arranque federado durable.');
    }
    const registro = hidratarArranque(filas[0]);
    if (!registro.installationId.esIgual(identidadDurable.installationId)) {
      throw new Error(
        'El bootId ya pertenece a otra identidad de instalación.'
      );
    }
    return registro;
  }

  async asegurarIdentidadEnTransaccion({ installationId, conexion } = {}) {
    exigirConexion(conexion);
    const candidata = exigirIdentidadFederada(installationId, {
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      campo: 'installationId'
    });
    await conexion.execute(
      `INSERT INTO identidad_instalacion_federacion (
         id, installation_id, version_contrato, creada_en_utc
       ) VALUES (1, ?, 1, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE id = VALUES(id)`,
      [candidata.serializar()]
    );
    const identidad = await this.obtenerIdentidadInstalacion({
      conexion,
      bloquear: true
    });
    if (!identidad) {
      throw new Error('No se pudo consolidar la identidad durable de instalación.');
    }
    return identidad;
  }

  async listarArranquesConocidos() {
    const filas = await this.clienteSql.consultar(
      `SELECT
         boot_id,
         installation_id,
         version_contrato,
         iniciado_en_utc,
         registrado_en_utc
       FROM arranques_instalacion_federacion
       ORDER BY iniciado_en_utc ASC, id ASC`
    );
    return Object.freeze(filas.map(hidratarArranque));
  }
}

function hidratarIdentidadInstalacion(fila) {
  exigirVersionContrato(fila.version_contrato);
  return Object.freeze({
    installationId: crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: String(fila.installation_id)
    }),
    versionContrato: 1,
    creadaEnUtc: normalizarFechaUtc(fila.creada_en_utc, 'creada_en_utc')
  });
}

function hidratarArranque(fila) {
  exigirVersionContrato(fila.version_contrato);
  return Object.freeze({
    bootId: crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.ARRANQUE,
      valor: String(fila.boot_id)
    }),
    installationId: crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: String(fila.installation_id)
    }),
    versionContrato: 1,
    iniciadoEnUtc: normalizarFechaUtc(fila.iniciado_en_utc, 'iniciado_en_utc'),
    registradoEnUtc: normalizarFechaUtc(
      fila.registrado_en_utc,
      'registrado_en_utc'
    )
  });
}

async function consultar({ clienteSql, conexion, sql }) {
  if (conexion !== null) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(sql);
    return filas;
  }
  return clienteSql.consultar(sql);
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error(
      'La identidad federada durable exige una conexión SQL prestada.'
    );
  }
}

function exigirVersionContrato(version) {
  if (Number(version) !== 1) {
    throw new Error('La identidad federada SQL usa una versión incompatible.');
  }
}

function normalizarFechaUtc(valor, campo) {
  const fecha = valor instanceof Date ? valor : new Date(String(valor));
  if (!Number.isFinite(fecha.getTime())) {
    throw new Error(`La columna ${campo} no contiene una fecha UTC válida.`);
  }
  return fecha.toISOString();
}
