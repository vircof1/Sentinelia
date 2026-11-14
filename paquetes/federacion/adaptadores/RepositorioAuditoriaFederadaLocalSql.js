import { bytesAUuidV7Auditoria, uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';
import { crearCampoPresenteFederado } from '../src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA, crearIdentidadFederada } from '../src/IdentidadFederada.js';
import { crearPayloadAuditoriaFederadaDesdeVista } from '../src/PayloadAuditoriaFederada.js';
import { FuenteEntropiaCriptograficaNode } from './FuenteEntropiaCriptograficaNode.js';

export class ErrorAuditoriaFederadaLocal extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorAuditoriaFederadaLocal';
    this.codigo = codigo;
  }
}

export class RepositorioAuditoriaFederadaLocalSql {
  constructor(clienteSql, {
    installationLocalId,
    generadorIdentidades = new GeneradorIdentidadesFederadas({
      fuenteEntropia: new FuenteEntropiaCriptograficaNode()
    }),
    ahora = () => new Date()
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La auditoría federable local requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.installationLocalId = identidad(installationLocalId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
    this.generador = generadorIdentidades;
    this.ahora = ahora;
  }

  async prepararCapturaEnTransaccion({
    eventoId,
    incluirPayloadCompleto = false,
    puedeFederarPayloadCompleto = false
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    exigirSeleccionSensible(incluirPayloadCompleto, puedeFederarPayloadCompleto);
    const evento = await cargarEvento(conexion, eventoId);
    if (!evento) fallar('evento_auditoria_federable_inexistente', 'El evento de auditoría no existe.');
    return this.#capturaDesdeFila(conexion, evento, { incluirPayloadCompleto });
  }

  async listarCapturasEnTransaccion({
    flujoId,
    generacionId,
    incluirPayloadCompleto = false,
    puedeFederarPayloadCompleto = false
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    exigirSeleccionSensible(incluirPayloadCompleto, puedeFederarPayloadCompleto);
    const flujo = await cargarFlujo(conexion, flujoId, generacionId);
    const [eventos] = await conexion.execute(
      `SELECT * FROM eventos_auditoria WHERE ${condicionScope(flujo)}
        ORDER BY registrado_en_utc,evento_id FOR UPDATE`,
      parametrosScope(flujo)
    );
    const capturas = [];
    for (const evento of eventos) {
      capturas.push(await this.#capturaDesdeFila(conexion, evento, { incluirPayloadCompleto }));
    }
    return Object.freeze(capturas);
  }

  async prepararRetiradaEnTransaccion(_solicitud = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    fallar(
      'retirada_auditoria_federada_no_permitida',
      'Los eventos de auditoría no admiten retirada ordenada por el emisor.'
    );
  }

  async #capturaDesdeFila(conexion, evento, { incluirPayloadCompleto }) {
    const eventoOrigenId = bytesAUuidV7Auditoria(evento.evento_id, 'eventoId');
    const instante = iso(this.ahora());
    const elementoOrigenId = await asegurarIdentidad(
      conexion,
      evento,
      eventoOrigenId,
      this.generador,
      instante
    );
    const vista = vistaEvento(evento, { incluirPayloadCompleto });
    const payload = crearPayloadAuditoriaFederadaDesdeVista({
      vistaAutorizada: vista,
      evidenciaOrigen: incluirPayloadCompleto
        ? {
            estado: 'verificable',
            sobreCanonico: vista,
            hashPayload: hex(evento.hash_payload),
            hashAnterior: hex(evento.hash_anterior),
            hashActual: hex(evento.hash_actual)
          }
        : { estado: 'noVerificable', causa: 'vistaParcialOrigen' }
    });
    return Object.freeze({
      tipoRegistro: 'evento',
      elementoOrigenId,
      payload,
      prioridad: 'reconstruccion',
      definicion: Object.freeze({
        familia: 'auditoria',
        familiaVersion: 1,
        installationOrigenId: this.installationLocalId,
        elementoOrigenId,
        ocurrenciaOrigenId: String(this.generador.generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)),
        operacion: 'actualizacion',
        tiempoOrigenUtc: normalizarFecha(evento.efectivo_en_utc),
        scopeOrigenDeclarado: scopeDeclarado(evento),
        vigenciaRestanteMs: null,
        campos: {
          auditoria: crearCampoPresenteFederado({
            valor: payload,
            sensibilidad: incluirPayloadCompleto ? 'sensible' : 'ordinario'
          })
        },
        evidenciaIntegridad: []
      })
    });
  }
}

function vistaEvento(fila, { incluirPayloadCompleto }) {
  return {
    eventoId: bytesAUuidV7Auditoria(fila.evento_id, 'eventoId'),
    tipo: fila.tipo_evento,
    versionContrato: Number(fila.version_contrato),
    flujo: fila.flujo,
    claveCadena: fila.clave_cadena,
    secuencia: String(fila.secuencia),
    actorReal: { tipo: fila.actor_real_tipo, id: fila.actor_real_id },
    actorEfectivo: fila.actor_efectivo_tipo
      ? { tipo: fila.actor_efectivo_tipo, id: fila.actor_efectivo_id }
      : null,
    modoActuacion: fila.modo_actuacion,
    sujeto: { tipo: fila.sujeto_tipo, id: fila.sujeto_id },
    origen: fila.origen,
    scope: scopeAuditoria(fila),
    correlacionId: bytesAUuidV7Auditoria(fila.correlacion_id, 'correlacionId'),
    causalidad: fila.causalidad_tipo
      ? { tipo: fila.causalidad_tipo, id: fila.causalidad_id }
      : null,
    productor: fila.productor,
    claveOperacion: Buffer.from(fila.clave_operacion).toString('ascii'),
    rolEvento: fila.rol_evento,
    efectivoEnUtc: normalizarFecha(fila.efectivo_en_utc),
    registradoEnUtc: normalizarFecha(fila.registrado_en_utc),
    versionCanonicalizador: fila.version_canonicalizador,
    versionEncadenado: fila.version_encadenado,
    payload: incluirPayloadCompleto
      ? json(fila.payload)
      : { contenidoOmitido: true, causa: 'omitidoPorSeleccion' }
  };
}

async function asegurarIdentidad(conexion, evento, eventoOrigenId, generador, instante) {
  const [filas] = await conexion.execute(
    'SELECT elemento_origen_id FROM identidades_eventos_auditoria_federacion WHERE evento_origen_id=? FOR UPDATE',
    [eventoOrigenId]
  );
  if (filas[0]) return filas[0].elemento_origen_id;
  const elementoOrigenId = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN));
  await conexion.execute(
    `INSERT INTO identidades_eventos_auditoria_federacion (
       evento_origen_id,elemento_origen_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,creada_en_utc
     ) VALUES (?,?,?,?,?,?)`,
    [eventoOrigenId, elementoOrigenId, evento.scope_tenant_id,
      evento.scope_empresa_id, evento.scope_sitio_id, sqlFecha(instante)]
  );
  return elementoOrigenId;
}

async function cargarEvento(conexion, eventoId) {
  let bytes;
  try { bytes = uuidV7AuditoriaABytes(eventoId, 'eventoId'); }
  catch { fallar('evento_auditoria_federable_invalido', 'La identidad del evento no es UUIDv7.'); }
  const [filas] = await conexion.execute(
    'SELECT * FROM eventos_auditoria WHERE evento_id=? LIMIT 1 FOR UPDATE',
    [bytes]
  );
  return filas[0] || null;
}

async function cargarFlujo(conexion, flujoId, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT f.scope_nivel,f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
      WHERE f.flujo_id=? AND f.direccion='emision' AND f.familia='auditoria'
        AND g.estado NOT IN ('cancelada','sustituida')
      LIMIT 1 FOR UPDATE`,
    [generacionId, flujoId]
  );
  if (!filas[0]) fallar('flujo_auditoria_federada_invalido', 'No existe el flujo emisor solicitado.');
  return filas[0];
}

function condicionScope(flujo) {
  if (flujo.scope_nivel === 'portal') return '1=1';
  if (flujo.scope_nivel === 'tenant') return 'scope_tenant_id=?';
  if (flujo.scope_nivel === 'empresa') return 'scope_empresa_id=?';
  return 'scope_sitio_id=?';
}
function parametrosScope(flujo) {
  if (flujo.scope_nivel === 'portal') return [];
  if (flujo.scope_nivel === 'tenant') return [flujo.scope_tenant_id];
  if (flujo.scope_nivel === 'empresa') return [flujo.scope_empresa_id];
  return [flujo.scope_sitio_id];
}
function scopeAuditoria(fila) {
  return {
    tenantId: decimal(fila.scope_tenant_id),
    empresaId: decimal(fila.scope_empresa_id),
    sitioId: decimal(fila.scope_sitio_id)
  };
}
function scopeDeclarado(fila) {
  const tenantId = decimal(fila.scope_tenant_id);
  const empresaId = decimal(fila.scope_empresa_id);
  const sitioId = decimal(fila.scope_sitio_id);
  const nivel = sitioId !== null
    ? 'sitio'
    : empresaId !== null
      ? 'empresa'
      : tenantId !== null
        ? 'tenant'
        : 'portal';
  return { nivel, tenantId, empresaId, sitioId };
}
function decimal(valor) { return valor === null || valor === undefined ? null : String(valor); }
function json(valor) { return typeof valor === 'string' ? JSON.parse(valor) : valor; }
function hex(valor) { return Buffer.from(valor).toString('hex').toLowerCase(); }
function normalizarFecha(valor) { const fecha = valor instanceof Date ? valor : new Date(`${String(valor).replace(' ', 'T')}Z`); return fecha.toISOString(); }
function iso(valor) { const fecha = valor instanceof Date ? valor : new Date(valor); if (Number.isNaN(fecha.getTime())) fallar('reloj_auditoria_federada_invalido', 'El reloj no devolvió una fecha válida.'); return fecha.toISOString(); }
function sqlFecha(valor) { return valor.slice(0, 23).replace('T', ' ').replace('Z', ''); }
function exigirSeleccionSensible(incluir, puede) { if (typeof incluir !== 'boolean' || typeof puede !== 'boolean') fallar('seleccion_auditoria_federada_invalida', 'La selección sensible debe ser booleana.'); if (incluir && !puede) fallar('payload_auditoria_federada_no_autorizado', 'El payload completo exige permiso actual.'); }
async function exigirTransaccion(conexion) { if (typeof conexion?.execute !== 'function') fallar('conexion_auditoria_federada_ausente', 'Se requiere conexión compartida.'); const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa'); if (!Boolean(filas[0]?.activa)) fallar('transaccion_auditoria_federada_ausente', 'Se requiere transacción activa.'); }
function identidad(valor, tipo) { try { return String(crearIdentidadFederada({ tipo, valor: String(valor || '') })); } catch { fallar('identidad_auditoria_federada_invalida', 'La identidad de instalación no es válida.'); } }
function fallar(codigo, mensaje) { throw new ErrorAuditoriaFederadaLocal(codigo, mensaje); }
