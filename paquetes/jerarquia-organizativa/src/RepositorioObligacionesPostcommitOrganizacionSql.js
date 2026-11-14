import { createHash } from 'node:crypto';

import {
  canonicalizarRfc8785
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

const TIPOS_RAIZ = new Set([
  'invalidar_catalogo_monitores',
  'invalidar_sesiones_usuarios_redis',
  'retirar_estructura_organizacion_redis'
]);

export class RepositorioObligacionesPostcommitOrganizacionSql {
  async crearORecuperarVariasEnTransaccion(
    { operacionId, obligaciones = [], creadaEnUtc, retenerHastaUtc } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const idOperacion = uuid(operacionId, 'operacionId');
    if (!Array.isArray(obligaciones)) {
      throw new TypeError('obligaciones debe ser una colección.');
    }
    const creada = fechaSql(creadaEnUtc, 'creadaEnUtc');
    const retencion = fechaSql(retenerHastaUtc, 'retenerHastaUtc');
    if (Date.parse(retenerHastaUtc) <= Date.parse(creadaEnUtc)) {
      throw new TypeError('retenerHastaUtc debe ser posterior a creadaEnUtc.');
    }
    const referencias = [];
    for (const entrada of obligaciones) {
      const obligacion = normalizarObligacion(entrada, idOperacion);
      const objetivoCanonico = canonicalizarRfc8785(obligacion.objetivo);
      const huella = createHash('sha256').update(objetivoCanonico, 'utf8').digest();
      const [existentes] = await conexion.execute(
        `SELECT obligacion_id,objetivo_canonico
           FROM obligaciones_postcommit_operaciones_administrativas
          WHERE operacion_id=? AND tipo=? AND huella_objetivo=?
          ORDER BY obligacion_id FOR UPDATE`,
        [uuidV7AuditoriaABytes(idOperacion), obligacion.tipo, huella]
      );
      if (existentes.length > 1) {
        throw new Error('La operación conserva obligaciones organizativas duplicadas.');
      }
      if (existentes[0]) {
        if (String(existentes[0].objetivo_canonico) !== objetivoCanonico) {
          throw new Error('La huella organizativa colisionó con otro objetivo.');
        }
        referencias.push(referencia(
          bytesAUuidV7Auditoria(existentes[0].obligacion_id),
          obligacion.tipo
        ));
        continue;
      }
      const columnas = columnasObjetivo(obligacion);
      await conexion.execute(
        `INSERT INTO obligaciones_postcommit_operaciones_administrativas (
           obligacion_id,operacion_id,tipo,version_contrato,objetivo_tipo,
           objetivo_id,agente_id,operacion_sesion_id,generacion_perfil,
           destinatario_usuario_id,objetivo_canonico,huella_objetivo,
           proximo_intento_utc,creada_en_utc,actualizada_en_utc,retener_hasta_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uuidV7AuditoriaABytes(obligacion.obligacionId),
          uuidV7AuditoriaABytes(idOperacion),
          obligacion.tipo,
          1,
          columnas.tipo,
          columnas.id,
          null,
          null,
          null,
          columnas.destinatarioUsuarioId,
          objetivoCanonico,
          huella,
          creada,
          creada,
          creada,
          retencion
        ]
      );
      referencias.push(referencia(obligacion.obligacionId, obligacion.tipo));
    }
    return Object.freeze(referencias);
  }

  async contarPorOperacionEnTransaccion(
    { operacionId } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const [[fila]] = await conexion.execute(
      `SELECT COUNT(*) total
         FROM obligaciones_postcommit_operaciones_administrativas
        WHERE operacion_id=?`,
      [uuidV7AuditoriaABytes(uuid(operacionId, 'operacionId'))]
    );
    const total = String(fila?.total ?? '0');
    if (!/^(0|[1-9][0-9]*)$/u.test(total)) {
      throw new Error('MariaDB devolvió un conteo de obligaciones inválido.');
    }
    return total;
  }

  async listarReferenciasPorOperacionEnTransaccion(
    { operacionId } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const [filas] = await conexion.execute(
      `SELECT obligacion_id,tipo
         FROM obligaciones_postcommit_operaciones_administrativas
        WHERE operacion_id=? ORDER BY obligacion_id FOR UPDATE`,
      [uuidV7AuditoriaABytes(uuid(operacionId, 'operacionId'))]
    );
    return Object.freeze(filas.map((fila) => referencia(
      bytesAUuidV7Auditoria(fila.obligacion_id),
      String(fila.tipo)
    )));
  }
}

function normalizarObligacion(entrada, operacionId) {
  const obligacionId = uuid(entrada?.obligacionId, 'obligacionId');
  if (obligacionId === operacionId) {
    throw new TypeError('La obligación no puede reutilizar la operación causal.');
  }
  const tipo = String(entrada?.tipo || '');
  if (!TIPOS_RAIZ.has(tipo) && tipo !== 'publicar_invalidacion_portal') {
    throw new TypeError('El tipo de obligación organizativa no está admitido.');
  }
  let objetivo;
  if (tipo === 'publicar_invalidacion_portal') {
    exigirClaves(entrada?.objetivo, ['destinatarioUsuarioId']);
    objetivo = Object.freeze({
      destinatarioUsuarioId: decimalPositivo(
        entrada.objetivo.destinatarioUsuarioId,
        'destinatarioUsuarioId'
      )
    });
  } else {
    exigirClaves(entrada?.objetivo, ['id', 'tipo']);
    const tipoRaiz = String(entrada.objetivo.tipo || '');
    if (!['tenant', 'empresa', 'sitio'].includes(tipoRaiz)) {
      throw new TypeError('El objetivo no es una raíz organizativa.');
    }
    objetivo = Object.freeze({
      tipo: tipoRaiz,
      id: decimalPositivo(entrada.objetivo.id, 'objetivo.id')
    });
  }
  return Object.freeze({ obligacionId, operacionId, tipo, objetivo });
}

function columnasObjetivo(obligacion) {
  if (obligacion.tipo === 'publicar_invalidacion_portal') {
    return Object.freeze({
      tipo: 'usuario',
      id: obligacion.objetivo.destinatarioUsuarioId,
      destinatarioUsuarioId: obligacion.objetivo.destinatarioUsuarioId
    });
  }
  return Object.freeze({
    tipo: obligacion.objetivo.tipo,
    id: obligacion.objetivo.id,
    destinatarioUsuarioId: null
  });
}

function referencia(obligacionId, tipo) {
  return Object.freeze({ obligacionId, tipo, estado: 'pendiente' });
}

function exigirClaves(entrada, esperadas) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new TypeError('El objetivo de obligación no es un objeto.');
  }
  const actuales = Object.keys(entrada).sort();
  const ordenadas = [...esperadas].sort();
  if (actuales.length !== ordenadas.length ||
      actuales.some((clave, indice) => clave !== ordenadas[indice])) {
    throw new TypeError('El objetivo de obligación contiene campos inesperados.');
  }
}

function uuid(valor, campo) {
  return bytesAUuidV7Auditoria(uuidV7AuditoriaABytes(valor, campo));
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new TypeError(`${campo} no es válido.`);
  return texto;
}

function fechaSql(valor, campo) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new TypeError(`${campo} no es una fecha válida.`);
  return fecha.toISOString().slice(0, 23).replace('T', ' ');
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function' || typeof conexion?.query !== 'function') {
    throw new TypeError('Las obligaciones organizativas exigen conexión prestada.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('Las obligaciones organizativas exigen transacción activa.');
  }
}
