import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';

export class RepositorioCausasPolDdns {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
  }

  async crear(datos) {
    return this.crearEnTransaccion(datos);
  }

  async crearEnTransaccion({ causaId, agenteId, periodoVidaPolId, sesionId = null,
    secuencia, aceptadaEnUtc, direccionRemota = null, familiaDireccion = null },
  { conexion = null } = {}) {
    const ejecutar = conexion
      ? conexion.execute.bind(conexion)
      : this.clienteSql.ejecutar.bind(this.clienteSql);
    await ejecutar(
      `INSERT INTO causas_pol_ddns (
         causa_id,agente_id_fotografia,periodo_vida_pol_id,
         sesion_id_diagnostico,secuencia,aceptada_en_utc,direccion_remota,
         familia_direccion,disponible_en_utc,actualizada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        uuidV7AuditoriaABytes(causaId, 'causaId'), id(agenteId),
        id(periodoVidaPolId), sesionId, decimal(secuencia), fechaSql(aceptadaEnUtc),
        direccionRemota, familiaDireccion, fechaSql(aceptadaEnUtc),
        fechaSql(aceptadaEnUtc)
      ]
    );
    return causaId;
  }

  async reclamarSiguiente({ instanciaId, leaseToken, ttlSegundos }) {
    return this.frontera.ejecutar(async (conexion) => {
      const [filas] = await conexion.execute(
        `SELECT causa_id
           FROM causas_pol_ddns
          WHERE (estado IN ('pendiente','reintentable')
                 AND disponible_en_utc<=UTC_TIMESTAMP(3))
             OR (estado='procesando' AND lease_expira_utc<=UTC_TIMESTAMP(3))
          ORDER BY aceptada_en_utc,causa_id
          LIMIT 1 FOR UPDATE SKIP LOCKED`
      );
      if (!filas[0]) return null;
      const [resultado] = await conexion.execute(
        `UPDATE causas_pol_ddns
            SET estado='procesando',instancia_id=?,lease_token=?,
                lease_expira_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
                fencing_token=fencing_token+1,intentos=intentos+1,
                codigo_diagnostico=NULL,mensaje_diagnostico=NULL,
                actualizada_en_utc=UTC_TIMESTAMP(3)
          WHERE causa_id=?`,
        [instanciaId, token(leaseToken), entero(ttlSegundos), filas[0].causa_id]
      );
      if (resultado.affectedRows !== 1) return null;
      const [actuales] = await conexion.execute(
        `SELECT causa_id,fencing_token,intentos,agente_id_fotografia,
                periodo_vida_pol_id,secuencia,direccion_remota,
                familia_direccion,aceptada_en_utc
           FROM causas_pol_ddns WHERE causa_id=?`,
        [filas[0].causa_id]
      );
      return mapearReclamada(actuales[0]);
    });
  }

  async renovarLease(argumentos) {
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE causas_pol_ddns
          SET lease_expira_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
              actualizada_en_utc=UTC_TIMESTAMP(3)
        WHERE causa_id=? AND estado='procesando' AND instancia_id=?
          AND lease_token=? AND fencing_token=?
          AND lease_expira_utc>UTC_TIMESTAMP(3)`,
      parametrosLease(argumentos, true)
    );
    return { actualizada: resultado.affectedRows === 1 };
  }

  async avanzarConLease(argumentos) {
    if (argumentos.transicion !== 'fanout_preparado') {
      throw new Error('La transición de causa POL no es válida.');
    }
    return this.renovarLease({ ...argumentos, ttlSegundos: 30 });
  }

  async consolidarConLease(argumentos) {
    return this.#finalizar(argumentos, {
      estado: 'completada', codigo: null, mensaje: null
    });
  }

  async registrarFalloConLease(argumentos) {
    const permanente = Boolean(argumentos.permanente);
    const diagnostico = argumentos.diagnostico || {};
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE causas_pol_ddns
          SET estado=?,disponible_en_utc=IF(?='fallida',disponible_en_utc,
                TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3))),
              instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
              codigo_diagnostico=?,mensaje_diagnostico=?,
              actualizada_en_utc=UTC_TIMESTAMP(3),
              terminada_en_utc=IF(?='fallida',UTC_TIMESTAMP(3),NULL)
        WHERE causa_id=? AND estado='procesando' AND instancia_id=?
          AND lease_token=? AND fencing_token=?
          AND lease_expira_utc>UTC_TIMESTAMP(3)`,
      [
        permanente ? 'fallida' : 'reintentable',
        permanente ? 'fallida' : 'reintentable',
        entero(argumentos.demoraReintentoSegundos), diagnostico.codigo,
        diagnostico.mensaje, permanente ? 'fallida' : 'reintentable',
        uuidV7AuditoriaABytes(argumentos.operacionId, 'operacionId'),
        argumentos.instanciaId, token(argumentos.leaseToken),
        decimal(argumentos.fencingToken)
      ]
    );
    return {
      actualizada: resultado.affectedRows === 1,
      estado: permanente ? 'fallida' : 'reintentable'
    };
  }

  async #finalizar(argumentos, { estado, codigo, mensaje }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE causas_pol_ddns
          SET estado=?,instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
              codigo_diagnostico=?,mensaje_diagnostico=?,
              actualizada_en_utc=UTC_TIMESTAMP(3),
              terminada_en_utc=UTC_TIMESTAMP(3)
        WHERE causa_id=? AND estado='procesando' AND instancia_id=?
          AND lease_token=? AND fencing_token=?
          AND lease_expira_utc>UTC_TIMESTAMP(3)`,
      [
        estado, codigo, mensaje,
        uuidV7AuditoriaABytes(argumentos.operacionId, 'operacionId'),
        argumentos.instanciaId, token(argumentos.leaseToken),
        decimal(argumentos.fencingToken)
      ]
    );
    return { actualizada: resultado.affectedRows === 1, estado };
  }
}

function mapearReclamada(fila) {
  return {
    operacionId: bytesAUuidV7Auditoria(fila.causa_id, 'causaId'),
    fencingToken: String(fila.fencing_token),
    intentos: Number(fila.intentos),
    operacion: {
      agenteId: String(fila.agente_id_fotografia),
      periodoVidaPolId: String(fila.periodo_vida_pol_id),
      secuencia: String(fila.secuencia),
      direccionRemota: fila.direccion_remota,
      familiaDireccion: fila.familia_direccion,
      aceptadaEnUtc: fila.aceptada_en_utc
    }
  };
}

function parametrosLease(argumentos, incluirTtl) {
  const comunes = [
    uuidV7AuditoriaABytes(argumentos.operacionId, 'operacionId'),
    argumentos.instanciaId,
    token(argumentos.leaseToken),
    decimal(argumentos.fencingToken)
  ];
  return incluirTtl ? [entero(argumentos.ttlSegundos), ...comunes] : comunes;
}

function token(valor) {
  const buffer = Buffer.isBuffer(valor) ? valor : Buffer.from(String(valor || ''), 'hex');
  if (buffer.length !== 32) throw new TypeError('leaseToken debe tener 32 bytes.');
  return buffer;
}

function decimal(valor) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) throw new TypeError('El decimal causal no es válido.');
  return texto;
}

function id(valor) {
  const texto = decimal(valor);
  if (texto === '0') throw new TypeError('El identificador debe ser positivo.');
  return texto;
}

function entero(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 86_400) {
    throw new TypeError('La duración no es válida.');
  }
  return numero;
}

function fechaSql(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new TypeError('El instante causal POL no es válido.');
  }
  return fecha.toISOString().slice(0, 23).replace('T', ' ');
}
