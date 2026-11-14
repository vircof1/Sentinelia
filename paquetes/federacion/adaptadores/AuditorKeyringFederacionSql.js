export class AuditorKeyringFederacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('La auditoría del keyring federado requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async auditar({ keyring, referencia } = {}) {
    if (typeof keyring?.validarDisponibilidad !== 'function') {
      throw new Error('La auditoría exige un keyring federado válido.');
    }
    const inventario = await this.inventariar();
    const referencias = new Set(
      inventario.entradas.map((entrada) => entrada.referencia)
    );
    if ([...referencias].some((valor) => valor !== referencia)) {
      throw errorKeyring(
        'KEYRING_REFERENCIA_HISTORICA_NO_DISPONIBLE',
        'Existen sobres federados ligados a otra referencia de keyring.'
      );
    }
    const keyIdsRequeridos = [...new Set(
      inventario.entradas.map((entrada) => entrada.keyId)
    )];
    let disponibilidad;
    try {
      disponibilidad = keyring.validarDisponibilidad({ referencia, keyIdsRequeridos });
    } catch {
      throw errorKeyring(
        'KEYRING_CLAVE_HISTORICA_NO_DISPONIBLE',
        'El keyring no contiene todas las claves requeridas por los sobres federados conservados.'
      );
    }
    return Object.freeze({
      ...disponibilidad,
      totalSobres: inventario.totalSobres,
      keyIdsRequeridos: Object.freeze(keyIdsRequeridos.sort())
    });
  }

  async inventariar() {
    const filas = await this.clienteSql.consultar(
      `SELECT keyring_referencia,key_id,COUNT(*) AS total FROM (
         SELECT keyring_referencia,key_id
           FROM credenciales_persistentes_federacion
          WHERE keyring_referencia IS NOT NULL
         UNION ALL
         SELECT keyring_referencia,key_id FROM secretos_ocurrencias_federacion
         UNION ALL
         SELECT keyring_referencia,key_id FROM secretos_inbox_federacion
         UNION ALL
         SELECT keyring_referencia,key_id FROM secretos_conflictos_inbox_federacion
         UNION ALL
         SELECT keyring_referencia,key_id
           FROM declaraciones_campos_inbox_federacion
          WHERE keyring_referencia IS NOT NULL
       ) inventario
       GROUP BY keyring_referencia,key_id
       ORDER BY keyring_referencia,key_id`
    );
    return Object.freeze({
      totalSobres: filas.reduce((total, fila) => total + Number(fila.total), 0),
      entradas: Object.freeze(filas.map((fila) => Object.freeze({
        referencia: String(fila.keyring_referencia),
        keyId: String(fila.key_id),
        totalSobres: Number(fila.total)
      })))
    });
  }
}

function errorKeyring(codigo, mensaje) {
  return Object.assign(new Error(mensaje), { codigo });
}
