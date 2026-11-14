import { FuenteEntropiaCriptograficaNode } from './FuenteEntropiaCriptograficaNode.js';
import { crearCampoPresenteFederado } from '../src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';
import {
  PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
  VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
  validarPayloadEstructuraOrganizativaFederacion
} from '../src/PayloadEstructuraOrganizativaFederacion.js';

const TIPOS = new Set(['tenant', 'empresa', 'sitio']);
const ORDEN_FOTOGRAFIA = Object.freeze(['tenant', 'empresa', 'sitio']);
const ORDEN_RETIRADA = Object.freeze(['sitio', 'empresa', 'tenant']);

export class ErrorEstructuraOrganizativaLocalFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorEstructuraOrganizativaLocalFederacion';
    this.codigo = codigo;
  }
}

export async function asegurarIdentidadesScopeOrganizativoFederacion({
  conexion,
  tenantId,
  empresaId = null,
  sitioId = null,
  generadorIdentidades,
  instante
} = {}) {
  await exigirTransaccion(conexion);
  if (typeof generadorIdentidades?.generar !== 'function') {
    fallar('generador_identidad_scope_invalido', 'El scope opaco requiere identidad durable.');
  }
  const solicitadas = [
    ['tenant', tenantId, 'tenantElementoOrigenId'],
    ...(empresaId === null ? [] : [['empresa', empresaId, 'empresaElementoOrigenId']]),
    ...(sitioId === null ? [] : [['sitio', sitioId, 'sitioElementoOrigenId']])
  ];
  const existentes = {};
  for (const [tipoSolicitado, idSolicitado, clave] of solicitadas) {
    const [filas] = await conexion.execute(
      `SELECT elemento_origen_id
         FROM identidades_estructura_organizativa_federacion
        WHERE tipo_nodo=? AND id_local=? AND estado='vigente'
        LIMIT 1 FOR UPDATE`,
      [tipoSolicitado, String(idSolicitado)]
    );
    if (filas[0]) existentes[clave] = filas[0].elemento_origen_id;
  }
  if (Object.keys(existentes).length === solicitadas.length) {
    return Object.freeze({
      tenantElementoOrigenId: existentes.tenantElementoOrigenId,
      empresaElementoOrigenId: existentes.empresaElementoOrigenId || null,
      sitioElementoOrigenId: existentes.sitioElementoOrigenId || null
    });
  }
  const tipo = sitioId !== null ? 'sitio' : empresaId !== null ? 'empresa' : 'tenant';
  const id = sitioId ?? empresaId ?? tenantId;
  const nodo = await cargarNodo(conexion, tipo, idPositivo(id, `${tipo}Id`));
  if (!nodo || String(nodo.tenantId) !== String(tenantId) ||
      (empresaId !== null && String(nodo.empresaId) !== String(empresaId))) {
    fallar('scope_organizativo_federable_inexistente', 'El scope organizativo local no existe.');
  }
  const identidades = await asegurarIdentidadesNodo({
    conexion,
    nodo,
    generador: generadorIdentidades,
    instante: fechaIso(instante),
    permitirRetirada: false
  });
  return Object.freeze({
    tenantElementoOrigenId: tipo === 'tenant' ? identidades.nodo : identidades.tenant,
    empresaElementoOrigenId: tipo === 'tenant' ? null
      : tipo === 'empresa' ? identidades.nodo : identidades.empresa,
    sitioElementoOrigenId: tipo === 'sitio' ? identidades.nodo : null
  });
}

export class RepositorioEstructuraOrganizativaLocalSql {
  constructor(clienteSql, {
    installationLocalId,
    generadorIdentidades = new GeneradorIdentidadesFederadas({
      fuenteEntropia: new FuenteEntropiaCriptograficaNode()
    }),
    ahora = () => new Date()
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La estructura organizativa local federable requiere SQL operativo.');
    }
    if (typeof generadorIdentidades?.generar !== 'function' || typeof ahora !== 'function') {
      throw new Error('La estructura organizativa local requiere identidad y reloj.');
    }
    this.clienteSql = clienteSql;
    this.installationLocal = identidadOpaca(
      installationLocalId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationLocalId'
    );
    this.installationLocalId = String(this.installationLocal);
    this.generadorIdentidades = generadorIdentidades;
    this.ahora = ahora;
  }

  async prepararCapturaEnTransaccion({ entidad, id, ancestrosSeleccionados = [] } = {}, {
    conexion
  } = {}) {
    await exigirTransaccion(conexion);
    const tipo = exigirTipo(entidad);
    const nodo = await cargarNodo(conexion, tipo, idPositivo(id, 'id'), true);
    if (!nodo) fallar('nodo_organizativo_inexistente', `El ${tipo} ya no existe.`);
    const seleccionados = normalizarAncestrosSeleccionados(ancestrosSeleccionados);
    return this.#crearCaptura(
      nodo,
      seleccionados,
      conexion,
      fechaIso(this.ahora()),
      'operativaActual'
    );
  }

  async listarCapturasEnTransaccion({ flujoId, generacionId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const flujo = await cargarFlujoFotografia(conexion, flujoId, generacionId);
    const nodos = await listarNodosScope(conexion, flujo);
    const seleccionados = new Set(nodos.map((nodo) => claveNodo(nodo.tipo, nodo.id)));
    const instante = fechaIso(this.ahora());
    const capturas = [];
    for (const tipo of ORDEN_FOTOGRAFIA) {
      for (const nodo of nodos.filter((entrada) => entrada.tipo === tipo)) {
        capturas.push(await this.#crearCaptura(
          nodo,
          seleccionados,
          conexion,
          instante,
          'reconstruccion'
        ));
      }
    }
    return Object.freeze(capturas);
  }

  async prepararCapturasMovimientoEnTransaccion({ entidad, id } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const tipo = exigirTipo(entidad);
    if (tipo === 'tenant') {
      fallar(
        'movimiento_organizativo_invalido',
        'Un tenant no posee un ancestro organizativo al que pueda moverse.'
      );
    }
    const raizId = idPositivo(id, 'id');
    const nodos = tipo === 'empresa'
      ? await listarEmpresaYSitios(conexion, raizId)
      : [await cargarNodo(conexion, 'sitio', raizId, true)].filter(Boolean);
    if (nodos.length === 0) {
      fallar('nodo_movido_inexistente', `El ${tipo} movido ya no existe.`);
    }
    const seleccionados = new Set(nodos.map((nodo) => claveNodo(nodo.tipo, nodo.id)));
    const instante = fechaIso(this.ahora());
    const capturas = [];
    for (const nodo of nodos) {
      capturas.push(await this.#crearCaptura(
        nodo,
        seleccionados,
        conexion,
        instante,
        'operativaActual'
      ));
    }
    return Object.freeze(capturas);
  }

  async prepararRetiradaEnTransaccion({ entidad, id } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const tipo = exigirTipo(entidad);
    const nodos = await listarCascadaRetirada(conexion, tipo, idPositivo(id, 'id'));
    if (!nodos.some((nodo) => nodo.tipo === tipo && String(nodo.id) === String(id))) {
      fallar('raiz_retirada_inexistente', `El ${tipo} que se pretende retirar ya no existe.`);
    }
    const instante = fechaIso(this.ahora());
    const retiradas = [];
    for (const tipoRetirada of ORDEN_RETIRADA) {
      for (const nodo of nodos.filter((entrada) => entrada.tipo === tipoRetirada)) {
        const identidades = await asegurarIdentidadesNodo({
          conexion,
          nodo,
          generador: this.generadorIdentidades,
          instante,
          permitirRetirada: true
        });
        await retirarIdentidad(conexion, nodo, instante);
        retiradas.push(Object.freeze({
          tipo: nodo.tipo,
          idLocal: String(nodo.id),
          elementoOrigenId: identidades.nodo,
          prioridad: 'operativaActual',
          definicion: Object.freeze({
            familia: 'estructuraOrganizativa',
            familiaVersion: VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
            installationOrigenId: this.installationLocal,
            elementoOrigenId: identidadOpaca(
              identidades.nodo,
              TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
              'elementoOrigenId'
            ),
            ocurrenciaOrigenId: this.generadorIdentidades.generar(
              TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
            ),
            operacion: 'retirada',
            tiempoOrigenUtc: instante,
            scopeOrigenDeclarado: scopeNodo(nodo),
            vigenciaRestanteMs: null,
            campos: {},
            evidenciaIntegridad: []
          })
        }));
      }
    }
    return Object.freeze({
      entidadRaiz: tipo,
      idRaiz: String(id),
      orden: 'hojasAntesRaiz',
      retiradas: Object.freeze(retiradas)
    });
  }

  async #crearCaptura(nodo, seleccionados, conexion, instante, prioridad) {
    const identidades = await asegurarIdentidadesNodo({
      conexion,
      nodo,
      generador: this.generadorIdentidades,
      instante,
      permitirRetirada: false
    });
    const payload = validarPayloadEstructuraOrganizativaFederacion({
      perfil: PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
      version: VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
      tipo: nodo.tipo,
      nombre: nodo.nombre,
      alias: nodo.alias,
      estado: nodo.estado,
      descripcion: nodo.descripcion,
      timezone: nodo.tipo === 'sitio' ? nodo.timezone : null,
      linaje: construirLinaje(nodo, identidades, seleccionados)
    });
    return Object.freeze({
      tipo: nodo.tipo,
      idLocal: String(nodo.id),
      elementoOrigenId: identidades.nodo,
      payload,
      prioridad,
      definicion: Object.freeze({
        familia: 'estructuraOrganizativa',
        familiaVersion: VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
        installationOrigenId: this.installationLocal,
        elementoOrigenId: identidadOpaca(
          identidades.nodo,
          TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
          'elementoOrigenId'
        ),
        ocurrenciaOrigenId: this.generadorIdentidades.generar(
          TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
        ),
        operacion: 'actualizacion',
        tiempoOrigenUtc: instante,
        scopeOrigenDeclarado: scopeNodo(nodo),
        vigenciaRestanteMs: null,
        campos: {
          nodoOrganizativo: crearCampoPresenteFederado({ valor: payload })
        },
        evidenciaIntegridad: []
      })
    });
  }

}

async function cargarFlujoFotografia(conexion, flujoId, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT f.flujo_id,f.scope_nivel,f.scope_tenant_id,
            f.scope_empresa_id,f.scope_sitio_id
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
      WHERE f.flujo_id=? AND f.direccion='emision'
        AND f.familia='estructuraOrganizativa'
        AND g.estado NOT IN ('cancelada','sustituida')
      LIMIT 1 FOR UPDATE`,
    [generacionId, flujoId]
  );
  if (!filas[0]) {
    fallar(
      'flujo_fotografia_organizativa_invalido',
      'La fotografía exige una generación emisora organizativa vigente.'
    );
  }
  return filas[0];
}

async function listarNodosScope(conexion, flujo) {
  const nodos = [];
  if (flujo.scope_nivel === 'portal' || flujo.scope_nivel === 'tenant') {
    const filtro = flujo.scope_nivel === 'tenant' ? 'WHERE t.id=?' : '';
    nodos.push(...await consultarNodos(
      conexion,
      'tenant',
      filtro,
      flujo.scope_nivel === 'tenant' ? [flujo.scope_tenant_id] : []
    ));
  }
  if (flujo.scope_nivel !== 'sitio') {
    const filtros = {
      portal: ['', []],
      tenant: ['WHERE e.tenant_id=?', [flujo.scope_tenant_id]],
      empresa: ['WHERE e.id=?', [flujo.scope_empresa_id]]
    };
    const [filtro, parametros] = filtros[flujo.scope_nivel];
    nodos.push(...await consultarNodos(conexion, 'empresa', filtro, parametros));
  }
  const filtrosSitio = {
    portal: ['', []],
    tenant: ['WHERE s.tenant_id=?', [flujo.scope_tenant_id]],
    empresa: ['WHERE s.empresa_id=?', [flujo.scope_empresa_id]],
    sitio: ['WHERE s.id=?', [flujo.scope_sitio_id]]
  };
  const [filtroSitio, parametrosSitio] = filtrosSitio[flujo.scope_nivel];
  nodos.push(...await consultarNodos(conexion, 'sitio', filtroSitio, parametrosSitio));
  return nodos;
}

async function listarEmpresaYSitios(conexion, empresaId) {
  return [
    ...await consultarNodos(conexion, 'empresa', 'WHERE e.id=?', [empresaId]),
    ...await consultarNodos(conexion, 'sitio', 'WHERE s.empresa_id=?', [empresaId])
  ];
}

async function listarCascadaRetirada(conexion, tipo, id) {
  if (tipo === 'tenant') return [
    ...await consultarNodos(conexion, 'tenant', 'WHERE t.id=?', [id]),
    ...await consultarNodos(conexion, 'empresa', 'WHERE e.tenant_id=?', [id]),
    ...await consultarNodos(conexion, 'sitio', 'WHERE s.tenant_id=?', [id])
  ];
  if (tipo === 'empresa') return listarEmpresaYSitios(conexion, id);
  return consultarNodos(conexion, 'sitio', 'WHERE s.id=?', [id]);
}

async function cargarNodo(conexion, tipo, id) {
  const nodos = await consultarNodos(
    conexion,
    tipo,
    `WHERE ${tipo === 'tenant' ? 't' : tipo === 'empresa' ? 'e' : 's'}.id=?`,
    [id]
  );
  return nodos[0] || null;
}

async function consultarNodos(conexion, tipo, filtro, parametros) {
  const sql = tipo === 'tenant'
    ? `SELECT 'tenant' AS tipo,t.id,t.nombre,t.alias,t.descripcion,t.estado,
              NULL AS timezone,t.id AS tenant_id,t.nombre AS tenant_nombre,
              NULL AS empresa_id,NULL AS empresa_nombre
         FROM tenants t ${filtro} ORDER BY t.id FOR UPDATE`
    : tipo === 'empresa'
      ? `SELECT 'empresa' AS tipo,e.id,e.nombre,e.alias,e.descripcion,e.estado,
                NULL AS timezone,e.tenant_id,t.nombre AS tenant_nombre,
                e.id AS empresa_id,e.nombre AS empresa_nombre
           FROM empresas e JOIN tenants t ON t.id=e.tenant_id
           ${filtro} ORDER BY e.id FOR UPDATE`
      : `SELECT 'sitio' AS tipo,s.id,s.nombre,s.alias,s.descripcion,s.estado,
                s.timezone,s.tenant_id,t.nombre AS tenant_nombre,
                s.empresa_id,e.nombre AS empresa_nombre
           FROM sitios s JOIN tenants t ON t.id=s.tenant_id
           JOIN empresas e ON e.id=s.empresa_id
           ${filtro} ORDER BY s.id FOR UPDATE`;
  const [filas] = await conexion.execute(sql, parametros);
  return filas.map(normalizarNodo);
}

function normalizarNodo(fila) {
  return Object.freeze({
    tipo: fila.tipo,
    id: String(fila.id),
    nombre: fila.nombre,
    alias: fila.alias,
    descripcion: fila.descripcion ?? null,
    estado: fila.estado,
    timezone: fila.timezone ?? null,
    tenantId: String(fila.tenant_id),
    tenantNombre: fila.tenant_nombre,
    empresaId: fila.empresa_id === null ? null : String(fila.empresa_id),
    empresaNombre: fila.empresa_nombre ?? null
  });
}

async function asegurarIdentidadesNodo({
  conexion, nodo, generador, instante, permitirRetirada
}) {
  const resultado = {};
  const ancestros = [];
  if (nodo.tipo !== 'tenant') {
    ancestros.push({
      tipo: 'tenant', id: nodo.tenantId, nombre: nodo.tenantNombre,
      tenantId: nodo.tenantId, empresaId: null
    });
  }
  if (nodo.tipo === 'sitio') {
    ancestros.push({
      tipo: 'empresa', id: nodo.empresaId, nombre: nodo.empresaNombre,
      tenantId: nodo.tenantId, empresaId: nodo.empresaId
    });
  }
  for (const ancestro of ancestros) {
    resultado[ancestro.tipo] = await asegurarIdentidad({
      conexion, nodo: ancestro, generador, instante, permitirRetirada
    });
  }
  resultado.nodo = await asegurarIdentidad({
    conexion, nodo, generador, instante, permitirRetirada
  });
  return Object.freeze(resultado);
}

async function asegurarIdentidad({ conexion, nodo, generador, instante, permitirRetirada }) {
  const [filas] = await conexion.execute(
    `SELECT * FROM identidades_estructura_organizativa_federacion
      WHERE tipo_nodo=? AND id_local=? FOR UPDATE`,
    [nodo.tipo, nodo.id]
  );
  let fila = filas[0];
  if (!fila) {
    const elementoOrigenId = identidad(
      generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
      'elementoOrigenId'
    );
    await conexion.execute(
      `INSERT INTO identidades_estructura_organizativa_federacion (
         tipo_nodo,id_local,elemento_origen_id,estado,nombre_ultimo,
         scope_tenant_id,scope_empresa_id,scope_sitio_id,
         creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
       ) VALUES (?,?,?,'vigente',?,?,?,?,?,?,NULL,1)`,
      [
        nodo.tipo, nodo.id, elementoOrigenId, nodo.nombre,
        nodo.tenantId,
        nodo.tipo === 'tenant' ? null : nodo.empresaId,
        nodo.tipo === 'sitio' ? nodo.id : null,
        fechaSql(instante), fechaSql(instante)
      ]
    );
    fila = { elemento_origen_id: elementoOrigenId, estado: 'vigente' };
  }
  if (fila.estado === 'retirado' && !permitirRetirada) {
    fallar(
      'identidad_organizativa_ya_retirada',
      'Una identidad organizativa retirada no puede resucitarse con el mismo id local.'
    );
  }
  if (fila.estado === 'vigente') {
    await conexion.execute(
      `UPDATE identidades_estructura_organizativa_federacion
          SET nombre_ultimo=?,scope_tenant_id=?,scope_empresa_id=?,scope_sitio_id=?,
              actualizada_en_utc=?,version_registro=version_registro+1
        WHERE tipo_nodo=? AND id_local=?`,
      [
        nodo.nombre, nodo.tenantId,
        nodo.tipo === 'tenant' ? null : nodo.empresaId,
        nodo.tipo === 'sitio' ? nodo.id : null,
        fechaSql(instante), nodo.tipo, nodo.id
      ]
    );
  }
  return fila.elemento_origen_id;
}

async function retirarIdentidad(conexion, nodo, instante) {
  await conexion.execute(
    `UPDATE identidades_estructura_organizativa_federacion
        SET estado='retirado',retirada_en_utc=COALESCE(retirada_en_utc,?),
            actualizada_en_utc=?,version_registro=version_registro+1
      WHERE tipo_nodo=? AND id_local=? AND estado='vigente'`,
    [fechaSql(instante), fechaSql(instante), nodo.tipo, nodo.id]
  );
}

function construirLinaje(nodo, identidades, seleccionados) {
  const linaje = [];
  if (nodo.tipo !== 'tenant') {
    linaje.push({
      tipo: 'tenant',
      elementoOrigenId: identidades.tenant,
      nombre: nodo.tenantNombre,
      visibilidad: seleccionados.has(claveNodo('tenant', nodo.tenantId))
        ? 'seleccionada' : 'opaca'
    });
  }
  if (nodo.tipo === 'sitio') {
    linaje.push({
      tipo: 'empresa',
      elementoOrigenId: identidades.empresa,
      nombre: nodo.empresaNombre,
      visibilidad: seleccionados.has(claveNodo('empresa', nodo.empresaId))
        ? 'seleccionada' : 'opaca'
    });
  }
  return linaje;
}

function scopeNodo(nodo) {
  return Object.freeze({
    nivel: nodo.tipo,
    tenantId: nodo.tenantId,
    empresaId: nodo.tipo === 'tenant' ? null : nodo.empresaId,
    sitioId: nodo.tipo === 'sitio' ? nodo.id : null
  });
}

function normalizarAncestrosSeleccionados(valor) {
  if (!Array.isArray(valor)) {
    fallar('seleccion_ancestros_invalida', 'Los ancestros seleccionados deben ser una lista.');
  }
  return new Set(valor.map((entrada) => {
    const tipo = exigirTipo(entrada?.tipo);
    if (tipo === 'sitio') {
      fallar('ancestro_seleccionado_invalido', 'Un sitio no puede ser ancestro organizativo.');
    }
    return claveNodo(tipo, idPositivo(entrada?.id, 'ancestro.id'));
  }));
}

async function exigirTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function' || typeof conexion?.query !== 'function') {
    fallar('conexion_organizativa_local_ausente', 'La captura exige una conexión prestada.');
  }
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_organizativa_local_ausente', 'La captura exige transacción activa.');
  }
}

function exigirTipo(valor) {
  if (!TIPOS.has(valor)) {
    fallar('tipo_organizativo_local_invalido', 'El tipo debe ser tenant, empresa o sitio.');
  }
  return valor;
}

function idPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    fallar('id_organizativo_local_invalido', `${campo} debe ser un id decimal positivo.`);
  }
  return texto;
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    fallar('identidad_organizativa_local_invalida', `${campo} no es una identidad válida.`);
  }
}

function identidadOpaca(valor, tipo, campo) {
  try {
    return crearIdentidadFederada({ tipo, valor: String(valor || '') });
  } catch {
    fallar('identidad_organizativa_local_invalida', `${campo} no es una identidad válida.`);
  }
}

function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    fallar('tiempo_organizativo_local_invalido', 'El reloj no produjo un instante válido.');
  }
  return fecha.toISOString();
}

function fechaSql(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    fallar('tiempo_organizativo_local_invalido', 'El instante SQL no es válido.');
  }
  return fecha;
}

function claveNodo(tipo, id) {
  return `${tipo}:${id}`;
}

function fallar(codigo, mensaje) {
  throw new ErrorEstructuraOrganizativaLocalFederacion(codigo, mensaje);
}
