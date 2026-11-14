import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';
import { validarPayloadContextoOperativoAgentesSesionesFederacion } from '../src/PayloadContextoOperativoAgentesSesionesFederacion.js';

export class ErrorContextoOperativoAgentesSesionesRemotoFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorContextoOperativoAgentesSesionesRemotoFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioContextoOperativoAgentesSesionesRemotoSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El contexto remoto de agentes requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async materializarEnTransaccion({ operacion, payload, contexto } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const trabajo = await obtenerTrabajo(conexion, contexto);
    if (operacion !== trabajo.operacion) {
      fallar('operacion_contexto_agente_no_corresponde', 'La operación tipada no coincide con el trabajo.');
    }
    if (operacion === 'salidaProyeccion') {
      return Object.freeze({ estado: 'sinCambio', causa: 'salidaProyeccionGobernadaPorContribucion' });
    }
    if (operacion === 'retirada' && payload !== null && payload !== undefined) {
      fallar('retirada_contexto_agente_con_payload', 'Una retirada no transporta payload.');
    }
    const normalizado = operacion === 'actualizacion'
      ? validarPayloadContextoOperativoAgentesSesionesFederacion(payload, { operacion })
      : { perfil: 'sentinelia-federacion-contexto-operativo-agente-retirada-v1', version: 1, causa: 'retiradaOrigen' };
    const canonico = canonicalizarJsonFederacion(normalizado);
    const [existentes] = await conexion.execute(
      `SELECT trabajo_entrega_id,estado_registro,representacion_canonica
         FROM versiones_contexto_operativo_agentes_remotos
        WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=? FOR UPDATE`,
      [trabajo.proyeccion_id, trabajo.generacion_id, String(trabajo.secuencia_elemento)]
    );
    if (existentes[0]) {
      if (existentes[0].trabajo_entrega_id !== trabajo.entrega_id ||
          existentes[0].estado_registro !== estadoRegistro(operacion) ||
          existentes[0].representacion_canonica !== canonico) {
        fallar('version_contexto_agente_divergente', 'La secuencia ya fue materializada con otro contenido.');
      }
      return resultado(trabajo, operacion, true);
    }
    const [reloj] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
    await conexion.execute(
      `INSERT INTO versiones_contexto_operativo_agentes_remotos (
         proyeccion_id,generacion_id,secuencia_elemento,trabajo_entrega_id,
         inbox_ocurrencia_id,ocurrencia_origen_id,estado_registro,
         guid_agente,nombre_agente,estado_pol,ultimo_heartbeat_utc,
         causa_retirada,representacion_canonica,materializada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        trabajo.proyeccion_id, trabajo.generacion_id, String(trabajo.secuencia_elemento),
        trabajo.entrega_id, String(trabajo.inbox_ocurrencia_id), trabajo.ocurrencia_origen_id,
        estadoRegistro(operacion),
        operacion === 'actualizacion' ? normalizado.identidadTecnica.guid : null,
        operacion === 'actualizacion' ? normalizado.identidadTecnica.nombre : null,
        operacion === 'actualizacion' ? normalizado.estadoPol.estado : null,
        operacion === 'actualizacion' ? fechaSql(normalizado.estadoPol.ultimoHeartbeatUtc) : null,
        operacion === 'retirada' ? 'retiradaOrigen' : null,
        canonico, reloj[0].ahora
      ]
    );
    return resultado(trabajo, operacion, false);
  }

  async listarActuales({ installationOrigenId = null } = {}) {
    const parametros = [];
    let filtro = '';
    if (installationOrigenId !== null) {
      filtro = 'AND p.installation_origen_id=?';
      parametros.push(identidad(installationOrigenId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION));
    }
    const filas = await this.clienteSql.consultar(
      `WITH actuales AS (
         SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
                p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
                a.generacion_actual_id,v.ultima_secuencia_evaluada,
                (SELECT MAX(r.secuencia_elemento)
                   FROM versiones_contexto_operativo_agentes_remotos r
                  WHERE r.proyeccion_id=p.proyeccion_id
                    AND r.generacion_id=a.generacion_actual_id
                    AND r.secuencia_elemento<=v.ultima_secuencia_evaluada) AS secuencia_contexto
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='contextoOperativoAgentesSesiones' ${filtro}
       )
       SELECT a.*,r.representacion_canonica
         FROM actuales a
         JOIN versiones_contexto_operativo_agentes_remotos r
           ON r.proyeccion_id=a.proyeccion_id
          AND r.generacion_id=a.generacion_actual_id
          AND r.secuencia_elemento=a.secuencia_contexto
          AND r.estado_registro='presente'
        ORDER BY a.proyeccion_id`,
      parametros
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      proyeccionId: fila.proyeccion_id,
      installationOrigenId: fila.installation_origen_id,
      elementoOrigenId: fila.elemento_origen_id,
      generacionId: fila.generacion_actual_id,
      secuenciaElemento: String(fila.secuencia_contexto),
      scopeRecepcion: Object.freeze({
        nivel: fila.scope_nivel,
        tenantId: opcional(fila.scope_tenant_id),
        empresaId: opcional(fila.scope_empresa_id),
        sitioId: opcional(fila.scope_sitio_id)
      }),
      contexto: validarPayloadContextoOperativoAgentesSesionesFederacion(
        JSON.parse(fila.representacion_canonica)
      )
    })));
  }
}

async function obtenerTrabajo(conexion, contexto) {
  const entregaId = identidad(contexto?.entregaId, TIPOS_IDENTIDAD_FEDERADA.ENTREGA);
  const propietario = String(contexto?.propietario || '');
  const fencing = String(contexto?.fencingToken || '');
  if (!propietario || !/^[1-9]\d*$/u.test(fencing)) {
    fallar('lease_contexto_agente_invalido', 'La materialización exige lease y fencing válidos.');
  }
  const [filas] = await conexion.execute(
    `SELECT t.*,p.familia AS familia_proyeccion
       FROM trabajos_materializacion_federacion t
       JOIN proyecciones_federacion p ON p.proyeccion_id=t.proyeccion_id
      WHERE t.entrega_id=? AND t.estado='procesando'
        AND t.propietario_lease=? AND t.fencing_token=?
        AND t.lease_hasta_utc>UTC_TIMESTAMP(3) FOR UPDATE`,
    [entregaId, propietario, fencing]
  );
  const trabajo = filas[0];
  if (!trabajo) fallar('fencing_contexto_agente_obsoleto', 'El materializador no gobierna el trabajo.');
  if (trabajo.familia !== 'contextoOperativoAgentesSesiones' ||
      trabajo.familia_proyeccion !== 'contextoOperativoAgentesSesiones') {
    fallar('familia_contexto_agente_incompatible', 'El trabajo pertenece a otra familia.');
  }
  return trabajo;
}

async function exigirTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function') fallar('conexion_contexto_agente_ausente', 'Se requiere conexión compartida.');
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) fallar('transaccion_contexto_agente_ausente', 'Se requiere transacción activa.');
}

function resultado(trabajo, operacion, yaMaterializada) {
  return Object.freeze({
    estado: operacion === 'retirada' ? 'retirada' : 'materializada',
    yaMaterializada,
    proyeccionId: trabajo.proyeccion_id,
    generacionId: trabajo.generacion_id,
    secuenciaElemento: String(trabajo.secuencia_elemento)
  });
}

function estadoRegistro(operacion) { return operacion === 'retirada' ? 'retirado' : 'presente'; }
function opcional(valor) { return valor === null || valor === undefined ? null : String(valor); }
function fechaSql(valor) { return valor === null ? null : valor.slice(0, 23).replace('T', ' ').replace('Z', ''); }
function identidad(valor, tipo) {
  try { return String(crearIdentidadFederada({ tipo, valor: String(valor || '') })); }
  catch { fallar('identidad_contexto_agente_invalida', 'La identidad federada no es válida.'); }
}
function fallar(codigo, mensaje) { throw new ErrorContextoOperativoAgentesSesionesRemotoFederacion(codigo, mensaje); }
