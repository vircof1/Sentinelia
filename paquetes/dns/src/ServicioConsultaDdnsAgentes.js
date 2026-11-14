import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

const LIMITE_POR_DEFECTO = 100;
const LIMITE_MAXIMO = 500;
const PRESUPUESTO_PUBLICACION = 3;

export class ServicioConsultaDdnsAgentes {
  constructor({ clienteSql, secretoCursores } = {}) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new TypeError('La consulta DDNS del agente requiere SQL operativo.');
    }
    if (!Buffer.isBuffer(secretoCursores) || secretoCursores.length < 32) {
      throw new TypeError('La consulta DDNS del agente requiere un secreto de cursor.');
    }
    this.clienteSql = clienteSql;
    this.secretoCursores = Buffer.from(secretoCursores);
  }

  async listar({ agenteId, limite: limiteEntrada, cursor = null } = {}) {
    const agente = idPositivo(agenteId, 'agenteId');
    const limite = normalizarLimite(limiteEntrada);
    const posicion = cursor
      ? decodificarCursor({
          cursor,
          agenteId: agente,
          limite,
          secreto: this.secretoCursores
        })
      : null;
    const parametros = [agente];
    let continuacion = '';
    if (posicion) {
      continuacion = 'AND c.concesion_id>?';
      parametros.push(uuidV7AuditoriaABytes(posicion.concesionId, 'cursor.concesionId'));
    }
    parametros.push(limite + 1);
    const filas = await this.clienteSql.consultar(
      `SELECT c.concesion_id,CAST(c.version_ddns AS CHAR) AS version_ddns,
              c.decision,c.modo,c.condicion_operativa,
              c.contenido_deseado_canonico,c.contenido_publicado_canonico,
              c.creada_en_utc,c.actualizada_en_utc,
              r.host_relativo,r.tipo_registro,z.nombre_zona,
              i.hito,i.terminal,i.aceptada_en_utc,i.persistida_en_utc,
              i.publicada_en_utc,i.terminada_en_utc,
              p.estado AS intento_estado,p.codigo_diagnostico,
              (SELECT COUNT(*) FROM intentos_publicacion_ddns pc
                WHERE pc.intencion_interna_id=c.intencion_gobernante_id
                  AND pc.estado='rechazo_atribuible') AS intentos_consumidos
         FROM concesiones_ddns_agentes c
         JOIN registros_dns r ON r.id=c.registro_dns_id
         JOIN zonas_dns z ON z.id=r.zona_id
         LEFT JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
         LEFT JOIN intentos_publicacion_ddns p ON p.id=(
           SELECT pi.id FROM intentos_publicacion_ddns pi
            WHERE pi.intencion_interna_id=c.intencion_gobernante_id
            ORDER BY pi.numero_intento DESC,pi.id DESC LIMIT 1
         )
        WHERE c.agente_id=? AND c.estado='vigente' ${continuacion}
        ORDER BY c.concesion_id LIMIT ?`,
      parametros
    );
    const hayMas = filas.length > limite;
    const pagina = filas.slice(0, limite).map(proyectar);
    const ultima = pagina.at(-1);
    return Object.freeze({
      concesiones: Object.freeze(pagina),
      paginacion: Object.freeze({
        limite,
        siguienteCursor: hayMas && ultima
          ? codificarCursor({
              agenteId: agente,
              limite,
              concesionId: ultima.concesionId,
              secreto: this.secretoCursores
            })
          : null
      })
    });
  }
}

function proyectar(fila) {
  const consumidos = Math.min(
    PRESUPUESTO_PUBLICACION,
    Number(fila.intentos_consumidos || 0)
  );
  return Object.freeze({
    concesionId: bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId'),
    registro: Object.freeze({
      nombre: fila.host_relativo === '@'
        ? fila.nombre_zona
        : `${fila.host_relativo}.${fila.nombre_zona}`,
      tipo: fila.tipo_registro
    }),
    capacidades: Object.freeze({
      modos: Object.freeze(['A', 'AAAA'].includes(fila.tipo_registro)
        ? ['observada', 'declarada']
        : ['declarada'])
    }),
    version: String(fila.version_ddns),
    decision: fila.decision,
    modo: fila.modo,
    condicion: fila.condicion_operativa,
    estadoDeseado: proyectarEstado(json(fila.contenido_deseado_canonico)),
    estadoPublicado: proyectarEstado(json(fila.contenido_publicado_canonico)),
    progreso: Object.freeze({
      hito: fila.hito,
      terminal: fila.terminal
    }),
    intentos: Object.freeze({
      consumidos,
      restantes: PRESUPUESTO_PUBLICACION - consumidos
    }),
    diagnostico: diagnosticoSaneado(fila),
    timestamps: Object.freeze({
      concesionCreadaEnUtc: fechaIso(fila.creada_en_utc),
      actualizadaEnUtc: fechaIso(fila.actualizada_en_utc),
      intencionAceptadaEnUtc: fechaIso(fila.aceptada_en_utc),
      contenidoPersistidoEnUtc: fechaIso(fila.persistida_en_utc),
      contenidoPublicadoEnUtc: fechaIso(fila.publicada_en_utc),
      terminadaEnUtc: fechaIso(fila.terminada_en_utc)
    })
  });
}

function diagnosticoSaneado(fila) {
  if (fila.terminal === 'publicacion_fallida') return 'publicacion_fallida';
  if (fila.condicion_operativa === 'publicacion_bloqueada' ||
      fila.intento_estado === 'bloqueada') return 'publicacion_bloqueada';
  if (fila.condicion_operativa === 'registro_no_operable') {
    return 'registro_no_operable';
  }
  if (fila.condicion_operativa === 'esperando_observacion') {
    return 'esperando_observacion';
  }
  if (fila.condicion_operativa === 'publicacion_previa_desconocida') {
    return 'publicacion_previa_desconocida';
  }
  if (fila.hito === 'contenido_deseado_persistido') return 'publicacion_pendiente';
  return null;
}

function proyectarEstado(estado) {
  if (!estado) return null;
  return Object.freeze({
    tipo: estado.tipo,
    modo: estado.modo,
    valor: estado.valor
  });
}

function normalizarLimite(valor) {
  if (valor === undefined || valor === null || valor === '') return LIMITE_POR_DEFECTO;
  const texto = String(valor);
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw errorConsulta('El límite DDNS debe ser un entero positivo.');
  }
  return Math.min(Number(texto), LIMITE_MAXIMO);
}

function codificarCursor({ agenteId, limite, concesionId, secreto }) {
  const cuerpo = Buffer.from(JSON.stringify({
    v: 1,
    agenteId,
    limite,
    concesionId
  }), 'utf8').toString('base64url');
  return `${cuerpo}.${firmar(cuerpo, secreto)}`;
}

function decodificarCursor({ cursor, agenteId, limite, secreto }) {
  const partes = String(cursor).split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1] ||
      !seguroIgual(partes[1], firmar(partes[0], secreto))) {
    throw errorConsulta('El cursor DDNS no es válido.', 'cursor_ddns_invalido');
  }
  let datos;
  try {
    datos = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
  } catch {
    throw errorConsulta('El cursor DDNS no es válido.', 'cursor_ddns_invalido');
  }
  if (datos?.v !== 1 || String(datos.agenteId) !== agenteId ||
      Number(datos.limite) !== limite || typeof datos.concesionId !== 'string') {
    throw errorConsulta('El cursor DDNS no pertenece a esta consulta.',
      'cursor_ddns_invalido');
  }
  try {
    uuidV7AuditoriaABytes(datos.concesionId, 'cursor.concesionId');
  } catch {
    throw errorConsulta('El cursor DDNS no es válido.', 'cursor_ddns_invalido');
  }
  return Object.freeze({ concesionId: datos.concesionId });
}

function firmar(cuerpo, secreto) {
  return createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('base64url');
}

function seguroIgual(a, b) {
  const izquierda = Buffer.from(String(a));
  const derecha = Buffer.from(String(b));
  return izquierda.length === derecha.length && timingSafeEqual(izquierda, derecha);
}

function errorConsulta(mensaje, codigo = 'consulta_ddns_invalida') {
  return Object.assign(new Error(mensaje), { statusCode: 400, codigo });
}

function json(valor) {
  if (valor === null || valor === undefined) return null;
  const contenido = typeof valor === 'object' && !Buffer.isBuffer(valor)
    ? structuredClone(valor)
    : JSON.parse(String(valor));
  return Object.freeze(contenido);
}

function fechaIso(valor) {
  if (valor === null || valor === undefined) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function idPositivo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${nombre} debe ser un identificador positivo.`);
  }
  return texto;
}

export const __testablesServicioConsultaDdnsAgentes = Object.freeze({
  normalizarLimite,
  codificarCursor,
  decodificarCursor
});
