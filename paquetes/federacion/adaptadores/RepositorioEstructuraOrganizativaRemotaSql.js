import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import {
  validarPayloadEstructuraOrganizativaFederacion
} from '../src/PayloadEstructuraOrganizativaFederacion.js';

export class ErrorEstructuraOrganizativaRemota extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorEstructuraOrganizativaRemota';
    this.codigo = codigo;
  }
}

export class RepositorioEstructuraOrganizativaRemotaSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La estructura organizativa remota requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async materializarEnTransaccion({ operacion, payload, contexto } = {}, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const trabajo = await obtenerTrabajoBloqueado(conexion, contexto);
    if (operacion !== trabajo.operacion) {
      fallar(
        'operacion_organizativa_no_corresponde',
        'La operación tipada no coincide con el trabajo federado reclamado.'
      );
    }
    if (operacion === 'salidaProyeccion') {
      return Object.freeze({
        estado: 'sinCambio',
        causa: 'salidaProyeccionGobernadaPorContribucion',
        proyeccionId: trabajo.proyeccion_id,
        secuenciaElemento: String(trabajo.secuencia_elemento)
      });
    }
    if (operacion === 'retirada' && payload !== null && payload !== undefined) {
      fallar(
        'retirada_organizativa_con_payload',
        'Una retirada organizativa no puede transportar un payload de actualización.'
      );
    }
    const normalizado = operacion === 'actualizacion'
      ? validarPayloadEstructuraOrganizativaFederacion(payload, { operacion })
      : await crearRepresentacionRetirada(conexion, trabajo);
    const canonico = canonicalizarJsonFederacion(normalizado);
    const existente = await obtenerVersion(conexion, trabajo, true);
    if (existente) {
      if (
        existente.trabajo_entrega_id !== trabajo.entrega_id ||
        existente.representacion_canonica !== canonico ||
        existente.estado_registro !== estadoRegistro(operacion)
      ) {
        fallar(
          'version_organizativa_divergente',
          'La secuencia organizativa ya fue materializada con otro contenido.'
        );
      }
      return Object.freeze({
        estado: operacion === 'retirada' ? 'retirada' : 'materializada',
        yaMaterializada: true,
        proyeccionId: trabajo.proyeccion_id,
        generacionId: trabajo.generacion_id,
        secuenciaElemento: String(trabajo.secuencia_elemento)
      });
    }
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO versiones_nodos_organizativos_remotos (
         proyeccion_id,generacion_id,secuencia_elemento,
         trabajo_entrega_id,inbox_ocurrencia_id,ocurrencia_origen_id,
         tipo_nodo,estado_registro,nombre,alias,estado_origen,
         descripcion,timezone,causa_retirada,representacion_canonica,
         materializada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        trabajo.proyeccion_id,
        trabajo.generacion_id,
        String(trabajo.secuencia_elemento),
        trabajo.entrega_id,
        String(trabajo.inbox_ocurrencia_id),
        trabajo.ocurrencia_origen_id,
        normalizado.tipo,
        estadoRegistro(operacion),
        operacion === 'actualizacion' ? normalizado.nombre : null,
        operacion === 'actualizacion' ? normalizado.alias : null,
        operacion === 'actualizacion' ? normalizado.estado : null,
        operacion === 'actualizacion' ? normalizado.descripcion : null,
        operacion === 'actualizacion' ? normalizado.timezone : null,
        operacion === 'retirada' ? 'retiradaOrigen' : null,
        canonico,
        ahora
      ]
    );
    if (operacion === 'actualizacion') {
      for (let indice = 0; indice < normalizado.linaje.length; indice += 1) {
        const ancestro = normalizado.linaje[indice];
        await conexion.execute(
          `INSERT INTO linaje_versiones_nodos_organizativos_remotos (
             proyeccion_id,generacion_id,secuencia_elemento,ordinal,
             tipo_ancestro,elemento_origen_id,nombre,visibilidad
           ) VALUES (?,?,?,?,?,?,?,?)`,
          [
            trabajo.proyeccion_id,
            trabajo.generacion_id,
            String(trabajo.secuencia_elemento),
            indice + 1,
            ancestro.tipo,
            ancestro.elementoOrigenId,
            ancestro.nombre,
            ancestro.visibilidad
          ]
        );
      }
    }
    return Object.freeze({
      estado: operacion === 'retirada' ? 'retirada' : 'materializada',
      yaMaterializada: false,
      proyeccionId: trabajo.proyeccion_id,
      generacionId: trabajo.generacion_id,
      secuenciaElemento: String(trabajo.secuencia_elemento)
    });
  }

  async listarActuales({ installationOrigenId = null, tipo = null } = {}) {
    const condiciones = [];
    const parametros = [];
    if (installationOrigenId !== null) {
      condiciones.push('p.installation_origen_id=?');
      parametros.push(identidad(
        installationOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
        'installationOrigenId'
      ));
    }
    if (tipo !== null) {
      if (!['tenant', 'empresa', 'sitio'].includes(tipo)) {
        fallar('tipo_consulta_organizativa_invalido', 'El tipo de consulta no es organizativo.');
      }
      condiciones.push('n.tipo_nodo=?');
      parametros.push(tipo);
    }
    const filtro = condiciones.length > 0
      ? `AND ${condiciones.join(' AND ')}`
      : '';
    const filas = await this.clienteSql.consultar(
      `WITH nodos_actuales AS (
         SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
                p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
                a.generacion_actual_id,v.ultima_secuencia_evaluada,
                (
                  SELECT MAX(n2.secuencia_elemento)
                    FROM versiones_nodos_organizativos_remotos n2
                   WHERE n2.proyeccion_id=p.proyeccion_id
                     AND n2.generacion_id=a.generacion_actual_id
                     AND n2.secuencia_elemento<=v.ultima_secuencia_evaluada
                ) AS secuencia_organizativa
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='estructuraOrganizativa'
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              p.generacion_actual_id,n.secuencia_elemento,n.tipo_nodo,
              n.nombre,n.alias,n.estado_origen,n.descripcion,n.timezone,
              l.ordinal,l.tipo_ancestro,l.elemento_origen_id AS ancestro_origen_id,
              l.nombre AS ancestro_nombre,l.visibilidad
         FROM nodos_actuales p
         JOIN versiones_nodos_organizativos_remotos n
           ON n.proyeccion_id=p.proyeccion_id
          AND n.generacion_id=p.generacion_actual_id
          AND n.secuencia_elemento=p.secuencia_organizativa
          AND n.estado_registro='presente'
         LEFT JOIN linaje_versiones_nodos_organizativos_remotos l
           ON l.proyeccion_id=n.proyeccion_id
          AND l.generacion_id=n.generacion_id
          AND l.secuencia_elemento=n.secuencia_elemento
        WHERE 1=1 ${filtro}
        ORDER BY p.proyeccion_id,l.ordinal`,
      parametros
    );
    return agruparNodos(filas);
  }
}

async function obtenerTrabajoBloqueado(conexion, contexto) {
  const entregaId = identidad(
    contexto?.entregaId,
    TIPOS_IDENTIDAD_FEDERADA.ENTREGA,
    'entregaId'
  );
  const propietario = textoAscii(contexto?.propietario, 128, 'propietario');
  const fencingToken = decimalPositivo(contexto?.fencingToken, 'fencingToken');
  const [filas] = await conexion.execute(
    `SELECT t.*,p.familia AS familia_proyeccion
       FROM trabajos_materializacion_federacion t
       JOIN proyecciones_federacion p ON p.proyeccion_id=t.proyeccion_id
      WHERE t.entrega_id=? AND t.estado='procesando'
        AND t.propietario_lease=? AND t.fencing_token=?
        AND t.lease_hasta_utc>UTC_TIMESTAMP(3)
      FOR UPDATE`,
    [entregaId, propietario, fencingToken]
  );
  const trabajo = filas[0];
  if (!trabajo) {
    fallar(
      'fencing_materializacion_organizativa_obsoleto',
      'El materializador organizativo no gobierna el trabajo reclamado.'
    );
  }
  if (
    trabajo.familia !== 'estructuraOrganizativa' ||
    trabajo.familia_proyeccion !== 'estructuraOrganizativa'
  ) {
    fallar(
      'familia_materializacion_organizativa_incompatible',
      'El trabajo no pertenece a una proyección de estructura organizativa.'
    );
  }
  return trabajo;
}

async function obtenerVersion(conexion, trabajo, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT * FROM versiones_nodos_organizativos_remotos
      WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=?${
  bloquear ? ' FOR UPDATE' : ''
}`,
    [
      trabajo.proyeccion_id,
      trabajo.generacion_id,
      String(trabajo.secuencia_elemento)
    ]
  );
  return filas[0] || null;
}

async function crearRepresentacionRetirada(conexion, trabajo) {
  const [filas] = await conexion.execute(
    `SELECT tipo_nodo
       FROM versiones_nodos_organizativos_remotos
      WHERE proyeccion_id=? AND generacion_id=?
        AND estado_registro='presente'
        AND secuencia_elemento<?
      ORDER BY secuencia_elemento DESC,materializada_en_utc DESC
      LIMIT 1 FOR UPDATE`,
    [
      trabajo.proyeccion_id,
      trabajo.generacion_id,
      String(trabajo.secuencia_elemento)
    ]
  );
  return {
    perfil: 'sentinelia-federacion-estructura-organizativa-retirada-v1',
    version: 1,
    tipo: filas[0]?.tipo_nodo ?? null,
    causa: 'retiradaOrigen'
  };
}

function agruparNodos(filas) {
  const nodos = new Map();
  for (const fila of filas) {
    let nodo = nodos.get(fila.proyeccion_id);
    if (!nodo) {
      nodo = {
        proyeccionId: fila.proyeccion_id,
        installationOrigenId: fila.installation_origen_id,
        elementoOrigenId: fila.elemento_origen_id,
        generacionId: fila.generacion_actual_id,
        secuenciaElemento: String(fila.secuencia_elemento),
        tipo: fila.tipo_nodo,
        nombre: fila.nombre,
        alias: fila.alias,
        estado: fila.estado_origen,
        descripcion: fila.descripcion,
        timezone: fila.timezone,
        scopeRecepcion: {
          nivel: fila.scope_nivel,
          tenantId: decimalOpcional(fila.scope_tenant_id),
          empresaId: decimalOpcional(fila.scope_empresa_id),
          sitioId: decimalOpcional(fila.scope_sitio_id)
        },
        linaje: []
      };
      nodos.set(fila.proyeccion_id, nodo);
    }
    if (fila.ordinal !== null) {
      nodo.linaje.push({
        tipo: fila.tipo_ancestro,
        elementoOrigenId: fila.ancestro_origen_id,
        nombre: fila.ancestro_nombre,
        visibilidad: fila.visibilidad
      });
    }
  }
  return Object.freeze([...nodos.values()].map((nodo) => Object.freeze({
    ...nodo,
    scopeRecepcion: Object.freeze(nodo.scopeRecepcion),
    linaje: Object.freeze(nodo.linaje.map(Object.freeze))
  })));
}

function estadoRegistro(operacion) {
  return operacion === 'retirada' ? 'retirado' : 'presente';
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    fallar('identidad_organizativa_invalida', `${campo} no es una identidad federada válida.`);
  }
}

function decimalPositivo(valor, campo) {
  let numero;
  try { numero = BigInt(valor); } catch { numero = 0n; }
  if (numero < 1n || numero > 18_446_744_073_709_551_615n) {
    fallar('decimal_organizativo_invalido', `${campo} debe ser un decimal positivo.`);
  }
  return numero.toString();
}

function decimalOpcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function textoAscii(valor, maximo, campo) {
  const texto = String(valor || '');
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/u.test(texto)) {
    fallar('texto_organizativo_invalido', `${campo} debe ser ASCII válido.`);
  }
  return texto;
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    fallar('conexion_organizativa_ausente', 'La materialización exige conexión compartida.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_organizativa_ausente', 'La materialización exige transacción activa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorEstructuraOrganizativaRemota(codigo, mensaje);
}
