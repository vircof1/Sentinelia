import { FuenteEntropiaCriptograficaNode } from './FuenteEntropiaCriptograficaNode.js';
import { asegurarIdentidadesScopeOrganizativoFederacion }
  from './RepositorioEstructuraOrganizativaLocalSql.js';
import { crearCampoPresenteFederado } from '../src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';
import {
  PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
  VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
  validarPayloadContextoOperativoAgentesSesionesFederacion
} from '../src/PayloadContextoOperativoAgentesSesionesFederacion.js';

export class ErrorContextoOperativoAgentesSesionesLocalFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorContextoOperativoAgentesSesionesLocalFederacion';
    this.codigo = codigo;
  }
}

export async function asegurarIdentidadContextoAgenteFederacion({
  conexion,
  agente,
  generadorIdentidades,
  instante
} = {}) {
  const [filas] = await conexion.execute(
    `SELECT elemento_origen_id,estado
       FROM identidades_contexto_operativo_agentes_federacion
      WHERE agente_id_local=? FOR UPDATE`,
    [String(agente?.id)]
  );
  if (filas[0]?.estado === 'vigente') return filas[0].elemento_origen_id;
  return asegurarIdentidadAgente(
    conexion,
    agente,
    generadorIdentidades,
    instante
  );
}

export class RepositorioContextoOperativoAgentesSesionesLocalSql {
  constructor(clienteSql, {
    installationLocalId,
    generadorIdentidades = new GeneradorIdentidadesFederadas({
      fuenteEntropia: new FuenteEntropiaCriptograficaNode()
    }),
    ahora = () => new Date()
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El contexto local de agentes requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.installationLocal = identidad(
      installationLocalId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationLocalId'
    );
    this.generadorIdentidades = generadorIdentidades;
    this.ahora = ahora;
  }

  async prepararCapturaEnTransaccion({ agenteId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const agente = await cargarAgente(conexion, idPositivo(agenteId, 'agenteId'));
    if (!agente) fallar('agente_contexto_inexistente', 'El agente ya no existe.');
    return this.#crearCaptura(agente, conexion, 'operativaActual');
  }

  async listarCapturasEnTransaccion({ flujoId, generacionId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const flujo = await cargarFlujo(conexion, flujoId, generacionId);
    const agentes = await listarAgentesScope(conexion, flujo);
    const capturas = [];
    for (const agente of agentes) {
      capturas.push(await this.#crearCaptura(agente, conexion, 'reconstruccion'));
    }
    return Object.freeze(capturas);
  }

  async prepararRetiradaEnTransaccion({ agenteId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const id = idPositivo(agenteId, 'agenteId');
    const agente = await cargarAgente(conexion, id);
    if (!agente) fallar('agente_retirada_inexistente', 'El agente a retirar ya no existe.');
    const instante = fechaIso(this.ahora());
    const elementoOrigenId = await asegurarIdentidadAgente(
      conexion, agente, this.generadorIdentidades, instante
    );
    await conexion.execute(
      `UPDATE identidades_contexto_operativo_agentes_federacion
          SET guid_ultimo=?,nombre_ultimo=?,scope_tenant_id=?,scope_empresa_id=?,
              scope_sitio_id=?,estado='retirado',actualizada_en_utc=?,retirada_en_utc=?,
              version_registro=version_registro+1
        WHERE agente_id_local=?`,
      [agente.guid, agente.nombre, agente.tenant_id, agente.empresa_id, agente.sitio_id,
        instanteSql(instante), instanteSql(instante), String(agente.id)]
    );
    return Object.freeze({
      agenteId: String(agente.id),
      elementoOrigenId,
      prioridad: 'operativaActual',
      definicion: this.#definicion({
        agente,
        elementoOrigenId,
        instante,
        operacion: 'retirada',
        campos: {}
      })
    });
  }

  async prepararRetiradaPublicadaEnTransaccion({ agenteId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const id = idPositivo(agenteId, 'agenteId');
    const agente = await cargarAgente(conexion, id);
    if (!agente) fallar('agente_retirada_inexistente', 'El agente debe existir durante la retirada.');
    const [filas] = await conexion.execute(
      `SELECT elemento_origen_id,scope_tenant_id,scope_empresa_id,scope_sitio_id
         FROM identidades_contexto_operativo_agentes_federacion
        WHERE agente_id_local=? AND estado='vigente' FOR UPDATE`,
      [id]
    );
    const identidadLocal = filas[0];
    if (!identidadLocal) return null;
    const instante = fechaIso(this.ahora());
    await conexion.execute(
      `UPDATE identidades_contexto_operativo_agentes_federacion
          SET guid_ultimo=?,nombre_ultimo=?,estado='retirado',
              actualizada_en_utc=?,retirada_en_utc=?,
              version_registro=version_registro+1
        WHERE agente_id_local=? AND estado='vigente'`,
      [agente.guid, agente.nombre, instanteSql(instante),
        instanteSql(instante), id]
    );
    const scopeIdentidad = {
      ...agente,
      tenant_id: identidadLocal.scope_tenant_id,
      empresa_id: identidadLocal.scope_empresa_id,
      sitio_id: identidadLocal.scope_sitio_id
    };
    return Object.freeze({
      agenteId: String(agente.id),
      elementoOrigenId: identidadLocal.elemento_origen_id,
      prioridad: 'operativaActual',
      definicion: this.#definicion({
        agente: scopeIdentidad,
        elementoOrigenId: identidadLocal.elemento_origen_id,
        instante,
        operacion: 'retirada',
        campos: {}
      })
    });
  }

  async #crearCaptura(agente, conexion, prioridad) {
    const instante = fechaIso(this.ahora());
    const elementoOrigenId = await asegurarIdentidadAgente(
      conexion, agente, this.generadorIdentidades, instante
    );
    const identidadesScope = await asegurarIdentidadesScopeOrganizativoFederacion({
      conexion,
      tenantId: agente.tenant_id,
      empresaId: agente.empresa_id,
      sitioId: agente.sitio_id,
      generadorIdentidades: this.generadorIdentidades,
      instante
    });
    const periodos = await cargarPeriodos(conexion, agente.id);
    const ultimo = periodos.at(-1) || null;
    const payload = validarPayloadContextoOperativoAgentesSesionesFederacion({
      perfil: PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
      version: VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
      tipo: 'agente',
      identidadTecnica: {
        guid: agente.guid,
        nombre: agente.nombre,
        descripcion: agente.descripcion,
        versionAgente: agente.ultima_version_agente
      },
      scopeOrganizativo: identidadesScope,
      estadoPol: {
        estado: ultimo === null ? 'nuncaObservado' : ultimo.fin_utc === null ? 'abierto' : 'cerrado',
        bootId: agente.ultimo_boot_id,
        ultimoHeartbeatUtc: fechaIsoOpcional(agente.ultimo_heartbeat_utc),
        ultimoSeq: decimalOpcional(agente.ultimo_seq)
      },
      periodos: periodos.map((periodo) => ({
        bootId: periodo.boot_id,
        inicioUtc: fechaIso(periodo.inicio_utc),
        finUtc: fechaIsoOpcional(periodo.fin_utc),
        ultimoHeartbeatUtc: fechaIsoOpcional(periodo.ultimo_heartbeat_utc),
        ultimoSeq: decimalOpcional(periodo.ultimo_seq),
        motivoCierre: periodo.motivo_cierre
      }))
    });
    return Object.freeze({
      agenteId: String(agente.id),
      elementoOrigenId,
      payload,
      prioridad,
      definicion: this.#definicion({
        agente,
        elementoOrigenId,
        instante,
        operacion: 'actualizacion',
        campos: { contextoOperativoAgente: crearCampoPresenteFederado({ valor: payload }) }
      })
    });
  }

  #definicion({ agente, elementoOrigenId, instante, operacion, campos }) {
    return Object.freeze({
      familia: 'contextoOperativoAgentesSesiones',
      familiaVersion: VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
      installationOrigenId: this.installationLocal,
      elementoOrigenId: identidad(
        elementoOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
        'elementoOrigenId'
      ),
      ocurrenciaOrigenId: this.generadorIdentidades.generar(
        TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
      ),
      operacion,
      tiempoOrigenUtc: instante,
      scopeOrigenDeclarado: {
        nivel: 'sitio',
        tenantId: String(agente.tenant_id),
        empresaId: String(agente.empresa_id),
        sitioId: String(agente.sitio_id)
      },
      vigenciaRestanteMs: null,
      campos,
      evidenciaIntegridad: []
    });
  }
}

async function cargarFlujo(conexion, flujoId, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT f.scope_nivel,f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
      WHERE f.flujo_id=? AND f.direccion='emision'
        AND f.familia='contextoOperativoAgentesSesiones'
        AND g.estado NOT IN ('cancelada','sustituida')
      LIMIT 1 FOR UPDATE`,
    [generacionId, flujoId]
  );
  if (!filas[0]) fallar('flujo_contexto_agente_invalido', 'La fotografía exige una generación emisora vigente.');
  return filas[0];
}

async function listarAgentesScope(conexion, flujo) {
  const filtros = {
    portal: ['', []],
    tenant: ['WHERE a.tenant_id=?', [flujo.scope_tenant_id]],
    empresa: ['WHERE a.tenant_id=? AND a.empresa_id=?', [flujo.scope_tenant_id, flujo.scope_empresa_id]],
    sitio: ['WHERE a.tenant_id=? AND a.empresa_id=? AND a.sitio_id=?', [
      flujo.scope_tenant_id, flujo.scope_empresa_id, flujo.scope_sitio_id
    ]]
  };
  const [filtro, parametros] = filtros[flujo.scope_nivel];
  const [filas] = await conexion.execute(
    `SELECT a.* FROM agentes_sentinelia a ${filtro} ORDER BY a.id FOR UPDATE`,
    parametros
  );
  return filas;
}

async function cargarAgente(conexion, agenteId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM agentes_sentinelia WHERE id=? FOR UPDATE', [agenteId]
  );
  return filas[0] || null;
}

async function cargarPeriodos(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT boot_id,inicio_utc,fin_utc,ultimo_heartbeat_utc,ultimo_seq,motivo_cierre
       FROM periodos_vida_pol_agentes WHERE agente_id=? ORDER BY inicio_utc,id FOR UPDATE`,
    [String(agenteId)]
  );
  return filas;
}

async function asegurarIdentidadAgente(conexion, agente, generador, instante) {
  const [filas] = await conexion.execute(
    `SELECT elemento_origen_id,estado
       FROM identidades_contexto_operativo_agentes_federacion
      WHERE agente_id_local=? FOR UPDATE`,
    [String(agente.id)]
  );
  if (filas[0]) {
    if (filas[0].estado !== 'vigente') {
      fallar('identidad_contexto_agente_retirada', 'Una identidad retirada no puede resucitar.');
    }
    await conexion.execute(
      `UPDATE identidades_contexto_operativo_agentes_federacion
          SET guid_ultimo=?,nombre_ultimo=?,scope_tenant_id=?,scope_empresa_id=?,
              scope_sitio_id=?,actualizada_en_utc=?,version_registro=version_registro+1
        WHERE agente_id_local=?`,
      [agente.guid, agente.nombre, agente.tenant_id, agente.empresa_id,
        agente.sitio_id, instanteSql(instante), String(agente.id)]
    );
    return filas[0].elemento_origen_id;
  }
  const elementoOrigenId = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN));
  await conexion.execute(
    `INSERT INTO identidades_contexto_operativo_agentes_federacion (
       agente_id_local,elemento_origen_id,guid_ultimo,nombre_ultimo,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,?,?,'vigente',?,?,NULL,1)`,
    [String(agente.id), elementoOrigenId, agente.guid, agente.nombre,
      agente.tenant_id, agente.empresa_id, agente.sitio_id,
      instanteSql(instante), instanteSql(instante)]
  );
  return elementoOrigenId;
}

async function exigirTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function') fallar('conexion_contexto_agente_ausente', 'Se requiere conexión compartida.');
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) fallar('transaccion_contexto_agente_ausente', 'Se requiere transacción activa.');
}

function identidad(valor, tipo, campo) {
  try { return String(crearIdentidadFederada({ tipo, valor: String(valor || '') })); }
  catch { fallar('identidad_contexto_agente_invalida', `${campo} no es válido.`); }
}

function idPositivo(valor, campo) {
  const texto = String(valor || '');
  if (!/^[1-9]\d*$/u.test(texto)) fallar('id_contexto_agente_invalido', `${campo} debe ser positivo.`);
  return texto;
}

function decimalOpcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(String(valor).replace(' ', 'T') + (String(valor).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(fecha.getTime())) fallar('fecha_contexto_agente_invalida', 'La fecha SQL no es válida.');
  return fecha.toISOString();
}

function fechaIsoOpcional(valor) { return valor === null ? null : fechaIso(valor); }
function instanteSql(valor) { return valor.slice(0, 23).replace('T', ' ').replace('Z', ''); }

function fallar(codigo, mensaje) {
  throw new ErrorContextoOperativoAgentesSesionesLocalFederacion(codigo, mensaje);
}
