import crypto from 'node:crypto';
import canonicalize from 'canonicalize';

import {
  DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL,
  ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL,
  ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL,
  PERFILES_RECUPERACION_PASSWORD_EMAIL,
  RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL,
  TIPOS_RESERVA_RECUPERACION_PASSWORD_EMAIL,
  VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
  crearFronteraRecuperacionPasswordEmail,
  crearHuellaRecuperacionPasswordEmail,
  crearSolicitudRecuperacionPasswordEmail
} from './ContratoRecuperacionPasswordEmail.js';
import { validarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';

const SCRIPT_PREPARAR = `
local existente = redis.call('GET', KEYS[1])
if existente then
  local actual = cjson.decode(existente)
  if actual.preparacion.huella == ARGV[1] and
     actual.preparacion.operacionId == ARGV[2] then
    return 'repetida'
  end
  return 'conflicto_solicitud'
end
local indice = redis.call('GET', KEYS[2])
if indice and indice ~= ARGV[3] then return 'conflicto_token' end
local tiempo = redis.call('TIME')
local ahora = tonumber(tiempo[1]) * 1000 + math.floor(tonumber(tiempo[2]) / 1000)
local vence = ahora + tonumber(ARGV[7]) * 1000
local agregado = cjson.decode(ARGV[4])
agregado.preparacion.creadaEnMs = ahora
agregado.preparacion.venceEnMs = vence
redis.call('SET', KEYS[1], cjson.encode(agregado))
redis.call('SET', KEYS[2], ARGV[3])
redis.call('SET', KEYS[3], ARGV[5])
redis.call('SET', KEYS[4], '{}')
for i=1,4 do redis.call('PEXPIREAT', KEYS[i], vence) end
return cjson.encode({estado='preparada',ahoraMs=ahora,venceEnMs=vence})
`;

const SCRIPT_ACTIVAR = `
local bruto = redis.call('GET', KEYS[1])
if not bruto or redis.call('GET', KEYS[2]) ~= ARGV[1] or
   not redis.call('GET', KEYS[3]) or not redis.call('GET', KEYS[4]) then
  return 'ausente'
end
local agregado = cjson.decode(bruto)
if agregado.tokenHashSha256 ~= ARGV[2] then return 'token_invalido' end
if agregado.estado == 'activa' then
  if agregado.activacionOperacionId ~= ARGV[3] or
     agregado.activacionPropietario ~= ARGV[4] then return 'propietario_rezagado' end
  return cjson.encode({estado='repetida',emitidaEnMs=agregado.emitidaEnMs,
    expiraEnMs=agregado.expiraEnMs})
end
if agregado.estado ~= 'preparada' then return 'estado_invalido' end
if agregado.preparacion.operacionId ~= ARGV[3] or
   agregado.preparacion.propietario ~= ARGV[4] then return 'propietario_rezagado' end
local tiempo = redis.call('TIME')
local ahora = tonumber(tiempo[1]) * 1000 + math.floor(tonumber(tiempo[2]) / 1000)
if ahora >= agregado.preparacion.venceEnMs then return 'lease_preparacion_expirada' end
local expira = ahora + tonumber(ARGV[5]) * 1000
agregado.estado = 'activa'
agregado.emitidaEnMs = ahora
agregado.expiraEnMs = expira
agregado.activacionOperacionId = ARGV[3]
agregado.activacionPropietario = ARGV[4]
agregado.preparacion = cjson.null
redis.call('SET', KEYS[1], cjson.encode(agregado))
for i=1,4 do redis.call('PEXPIREAT', KEYS[i], expira) end
return cjson.encode({estado='activada',emitidaEnMs=ahora,expiraEnMs=expira})
`;

const SCRIPT_INSPECCIONAR = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 'ausente' end
local bruto = redis.call('GET', KEYS[1])
local frontera = redis.call('GET', KEYS[3])
local alegaciones = redis.call('GET', KEYS[4])
if not bruto or not frontera or not alegaciones then return 'incompleta' end
local agregado = cjson.decode(bruto)
if agregado.solicitudId ~= ARGV[1] or agregado.tokenHashSha256 ~= ARGV[2] then
  return 'token_invalido'
end
local tiempo = redis.call('TIME')
local ahora = tonumber(tiempo[1]) * 1000 + math.floor(tonumber(tiempo[2]) / 1000)
if not agregado.expiraEnMs or ahora >= agregado.expiraEnMs then return 'expirada' end
return cjson.encode({agregado=agregado,frontera=cjson.decode(frontera)})
`;

const SCRIPT_RESERVAR_ALEGACION = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 'ausente' end
local bruto = redis.call('GET', KEYS[1])
local fronteraBruta = redis.call('GET', KEYS[3])
local alegacionesBrutas = redis.call('GET', KEYS[4])
if not bruto or not fronteraBruta or not alegacionesBrutas then return 'incompleta' end
local agregado = cjson.decode(bruto)
if agregado.tokenHashSha256 ~= ARGV[2] then return 'token_invalido' end
local tiempo = redis.call('TIME')
local ahora = tonumber(tiempo[1]) * 1000 + math.floor(tonumber(tiempo[2]) / 1000)
if agregado.estado ~= 'activa' or ahora >= agregado.expiraEnMs then
  return agregado.estado == 'consumida' and 'consumida' or 'no_utilizable'
end
local alegaciones = cjson.decode(alegacionesBrutas)
local actual = alegaciones[ARGV[3]]
if actual and actual.estado == 'consolidada' then
  return cjson.encode({estado='repetida',alegacion=actual})
end
if agregado.usuarioIdVinculado ~= cjson.null and not actual then return 'vinculada' end
if agregado.presupuestoRestante <= 0 and not actual then return 'presupuesto_agotado' end
if actual and actual.estado == 'reservada' and actual.venceEnMs > ahora then
  if actual.reservaId == ARGV[4] and actual.propietario == ARGV[5] then
    return cjson.encode({estado='repetida_reserva',reserva=actual})
  end
  return 'ocupada'
end
local reserva = {estado='reservada',reservaId=ARGV[4],propietario=ARGV[5],
  creadaEnMs=ahora,venceEnMs=ahora + tonumber(ARGV[6]) * 1000}
alegaciones[ARGV[3]] = reserva
redis.call('SET', KEYS[4], cjson.encode(alegaciones), 'KEEPTTL')
return cjson.encode({estado='reservada',reserva=reserva})
`;

const SCRIPT_CONSOLIDAR_ALEGACION = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 'ausente' end
local bruto = redis.call('GET', KEYS[1])
local fronteraBruta = redis.call('GET', KEYS[3])
local alegacionesBrutas = redis.call('GET', KEYS[4])
if not bruto or not fronteraBruta or not alegacionesBrutas then return 'incompleta' end
local agregado = cjson.decode(bruto)
if agregado.tokenHashSha256 ~= ARGV[2] or agregado.estado ~= 'activa' then
  return 'no_utilizable'
end
local alegaciones = cjson.decode(alegacionesBrutas)
local actual = alegaciones[ARGV[3]]
if actual and actual.estado == 'consolidada' then
  return cjson.encode({estado='repetida',alegacion=actual,agregado=agregado})
end
if not actual or actual.reservaId ~= ARGV[4] or actual.propietario ~= ARGV[5] then
  return 'reserva_invalida'
end
if agregado.presupuestoRestante <= 0 then return 'presupuesto_agotado' end
local resultado = ARGV[6]
local usuario = ARGV[7]
if resultado == 'resuelta' then
  local frontera = cjson.decode(fronteraBruta)
  local miembro = frontera[usuario]
  if not miembro or miembro.generacionRecuperacionObservada ~= ARGV[8] or
     miembro.estado ~= 'utilizable' then return 'frontera_invalida' end
  if agregado.usuarioIdVinculado ~= cjson.null and
     agregado.usuarioIdVinculado ~= usuario then
    return 'vinculo_inmutable'
  end
  agregado.usuarioIdVinculado = usuario
  agregado.huellaNombreVinculado = ARGV[3]
else
  usuario = ''
end
agregado.presupuestoRestante = agregado.presupuestoRestante - 1
table.insert(agregado.huellasAlegadas, ARGV[3])
local consolidada = {estado='consolidada',resultado=resultado,
  usuarioIdResuelto=usuario ~= '' and usuario or cjson.null}
alegaciones[ARGV[3]] = consolidada
redis.call('SET', KEYS[1], cjson.encode(agregado), 'KEEPTTL')
redis.call('SET', KEYS[4], cjson.encode(alegaciones), 'KEEPTTL')
return cjson.encode({estado='consolidada',alegacion=consolidada,agregado=agregado})
`;

const SCRIPT_RESTAURAR_ALEGACION = `
local agregadoBruto = redis.call('GET', KEYS[1])
if not agregadoBruto or redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
local agregado = cjson.decode(agregadoBruto)
if agregado.solicitudId ~= ARGV[1] then return 0 end
local bruto = redis.call('GET', KEYS[4])
if not bruto then return 0 end
local alegaciones = cjson.decode(bruto)
local actual = alegaciones[ARGV[2]]
if not actual or actual.estado ~= 'reservada' or actual.reservaId ~= ARGV[3] or
   actual.propietario ~= ARGV[4] then return 0 end
alegaciones[ARGV[2]] = nil
redis.call('SET', KEYS[4], cjson.encode(alegaciones), 'KEEPTTL')
return 1
`;

const SCRIPT_RESERVAR_CONSUMO = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 'ausente' end
local bruto = redis.call('GET', KEYS[1])
local fronteraBruta = redis.call('GET', KEYS[3])
if not bruto or not fronteraBruta or not redis.call('GET', KEYS[4]) then
  return 'incompleta'
end
local agregado = cjson.decode(bruto)
if agregado.tokenHashSha256 ~= ARGV[2] then return 'token_invalido' end
local tiempo = redis.call('TIME')
local ahora = tonumber(tiempo[1]) * 1000 + math.floor(tonumber(tiempo[2]) / 1000)
if agregado.estado == 'consumida' then return 'consumida' end
if agregado.estado == 'consumiendo' then
  if agregado.reserva and agregado.reserva.venceEnMs > ahora then
    if agregado.reserva.reservaId == ARGV[3] and
       agregado.reserva.propietario == ARGV[4] then
      return cjson.encode({estado='repetida',reserva=agregado.reserva})
    end
    return 'ocupada'
  end
  agregado.estado = 'activa'
  agregado.reserva = cjson.null
end
if agregado.estado ~= 'activa' or ahora >= agregado.expiraEnMs or
   agregado.usuarioIdVinculado == cjson.null then return 'no_utilizable' end
local frontera = cjson.decode(fronteraBruta)
local miembro = frontera[agregado.usuarioIdVinculado]
if not miembro or miembro.estado ~= 'utilizable' then return 'frontera_invalida' end
local reserva = {reservaId=ARGV[3],propietario=ARGV[4],tipo='consumo',
  creadaEnMs=ahora,venceEnMs=ahora + tonumber(ARGV[5]) * 1000}
agregado.estado = 'consumiendo'
agregado.reserva = reserva
redis.call('SET', KEYS[1], cjson.encode(agregado), 'KEEPTTL')
return cjson.encode({estado='reservada',reserva=reserva,
  usuarioId=agregado.usuarioIdVinculado,
  generacionRecuperacionObservada=miembro.generacionRecuperacionObservada,
  eventoConsumoId=agregado.eventoConsumoId})
`;

const SCRIPT_RESTAURAR_CONSUMO = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
local bruto = redis.call('GET', KEYS[1])
if not bruto then return 0 end
local agregado = cjson.decode(bruto)
if agregado.estado ~= 'consumiendo' or not agregado.reserva or
   agregado.reserva.reservaId ~= ARGV[2] or
   agregado.reserva.propietario ~= ARGV[3] then return 0 end
agregado.estado = 'activa'
agregado.reserva = cjson.null
redis.call('SET', KEYS[1], cjson.encode(agregado), 'KEEPTTL')
return 1
`;

const SCRIPT_CONSUMIR = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 'ausente' end
local bruto = redis.call('GET', KEYS[1])
local fronteraBruta = redis.call('GET', KEYS[3])
if not bruto or not fronteraBruta or not redis.call('GET', KEYS[4]) then
  return 'incompleta'
end
local agregado = cjson.decode(bruto)
if agregado.estado == 'consumida' then
  if agregado.consumoReservaId == ARGV[3] and
     agregado.consumoPropietario == ARGV[4] then return 'ya_consumida' end
  return 'consumida'
end
if agregado.tokenHashSha256 ~= ARGV[2] then return 'token_invalido' end
if agregado.estado ~= 'consumiendo' or not agregado.reserva or
   agregado.reserva.reservaId ~= ARGV[3] or
   agregado.reserva.propietario ~= ARGV[4] then return 'reserva_invalida' end
local frontera = cjson.decode(fronteraBruta)
for id,miembro in pairs(frontera) do miembro.estado = 'retirada' end
agregado.estado = 'consumida'
agregado.presupuestoRestante = 0
agregado.usuarioIdVinculado = cjson.null
agregado.huellaNombreVinculado = cjson.null
agregado.reserva = cjson.null
agregado.consumoReservaId = ARGV[3]
agregado.consumoPropietario = ARGV[4]
redis.call('SET', KEYS[1], cjson.encode(agregado), 'KEEPTTL')
redis.call('SET', KEYS[3], cjson.encode(frontera), 'KEEPTTL')
return 'consumida'
`;

const SCRIPT_RETIRAR_IDENTIDAD = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 'ausente' end
local agregadoBruto = redis.call('GET', KEYS[1])
local fronteraBruta = redis.call('GET', KEYS[3])
if not agregadoBruto or not fronteraBruta or not redis.call('GET', KEYS[4]) then
  return 'incompleta'
end
local agregado = cjson.decode(agregadoBruto)
if agregado.tokenHashSha256 ~= ARGV[2] then return 'token_invalido' end
if agregado.estado ~= 'activa' then return 'no_mutable' end
local frontera = cjson.decode(fronteraBruta)
local miembro = frontera[ARGV[3]]
if not miembro or miembro.generacionRecuperacionObservada ~= ARGV[4] then
  return 'ajena'
end
if miembro.estado == 'retirada' then return 'ya_retirada' end
miembro.estado = 'retirada'
redis.call('SET', KEYS[3], cjson.encode(frontera), 'KEEPTTL')
return 'retirada'
`;

const SCRIPT_DESCARTAR_PREPARACION = `
local bruto = redis.call('GET', KEYS[1])
if not bruto then return 0 end
local agregado = cjson.decode(bruto)
if agregado.estado ~= 'preparada' or agregado.preparacion.operacionId ~= ARGV[1]
   or agregado.preparacion.propietario ~= ARGV[2] then return 0 end
if redis.call('GET', KEYS[2]) == agregado.solicitudId then redis.call('DEL', KEYS[2]) end
redis.call('DEL', KEYS[1], KEYS[3], KEYS[4])
return 1
`;

export class RepositorioSolicitudesRecuperacionPasswordRedis {
  constructor({
    clienteRedis,
    prefijo = 'sentinelia:usuarios:recuperacion-password:v1:'
  } = {}) {
    if (typeof clienteRedis?.eval !== 'function' ||
        typeof clienteRedis?.get !== 'function') {
      throw new Error('La recuperación de contraseña requiere Redis operativo.');
    }
    this.redis = clienteRedis;
    this.prefijo = prefijoSeguro(prefijo);
  }

  generarToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  calcularHuellaToken(token) {
    return crearHuellaRecuperacionPasswordEmail(
      DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL.TOKEN,
      tokenValido(token)
    );
  }

  async preparar({
    solicitudId,
    token,
    buzonCanonico,
    frontera,
    eventoEmisionId,
    eventoConsumoId,
    presupuestoMaximo,
    operacionId,
    propietario,
    leaseSegundos
  } = {}) {
    validarUuidV7Auditoria(solicitudId, 'solicitudId');
    validarUuidV7Auditoria(eventoEmisionId, 'eventoEmisionId');
    validarUuidV7Auditoria(eventoConsumoId, 'eventoConsumoId');
    validarUuidV7Auditoria(operacionId, 'operacionId');
    const fronteraValida = crearFronteraRecuperacionPasswordEmail(frontera);
    const huellaToken = this.calcularHuellaToken(token);
    const presupuesto = entero(presupuestoMaximo, 1, 20, 'presupuestoMaximo');
    const duenio = texto(propietario, 190, 'propietario');
    const lease = entero(leaseSegundos, 1, 3600, 'leaseSegundos');
    const base = {
      perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.SOLICITUD,
      version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
      solicitudId,
      buzonCanonico,
      tokenHashSha256: huellaToken,
      estado: ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.PREPARADA,
      emitidaEnMs: null,
      expiraEnMs: null,
      presupuestoMaximo: presupuesto,
      presupuestoRestante: presupuesto,
      huellasAlegadas: [],
      usuarioIdVinculado: null,
      huellaNombreVinculado: null,
      reserva: null,
      eventoEmisionId,
      eventoConsumoId,
      preparacion: { operacionId, propietario: duenio }
    };
    base.preparacion.huella = sha(canonicalize({ base, frontera: fronteraValida }));
    const resultado = await this.redis.eval(SCRIPT_PREPARAR, {
      keys: this.claves(solicitudId, huellaToken),
      arguments: [base.preparacion.huella, operacionId, solicitudId,
        JSON.stringify(base), serializarFrontera(fronteraValida), duenio,
        String(lease)]
    });
    return proyectarResultado(resultado);
  }

  async activar({ solicitudId, token, operacionId, propietario, vigenciaSegundos }) {
    const huella = this.calcularHuellaToken(token);
    const resultado = await this.redis.eval(SCRIPT_ACTIVAR, {
      keys: this.claves(idSolicitud(solicitudId), huella),
      arguments: [solicitudId, huella, idOperacion(operacionId),
        texto(propietario, 190, 'propietario'),
        String(entero(vigenciaSegundos, 1, 86400, 'vigenciaSegundos'))]
    });
    return proyectarResultado(resultado);
  }

  async inspeccionar(token) {
    const resuelta = await this.#resolverToken(token);
    if (!resuelta) return Object.freeze({ estado: 'ausente', solicitud: null });
    const resultado = await this.redis.eval(SCRIPT_INSPECCIONAR, {
      keys: this.claves(resuelta.solicitudId, resuelta.huella),
      arguments: [resuelta.solicitudId, resuelta.huella]
    });
    const parseado = proyectarResultado(resultado);
    if (!parseado.agregado) return Object.freeze({ ...parseado, solicitud: null });
    return Object.freeze({
      estado: parseado.agregado.estado,
      solicitud: hidratarSolicitud(parseado.agregado, parseado.frontera),
      coordinacion: Object.freeze({
        eventoEmisionId: parseado.agregado.eventoEmisionId,
        eventoConsumoId: parseado.agregado.eventoConsumoId,
        activacionOperacionId: parseado.agregado.activacionOperacionId || null
      })
    });
  }

  async reservarAlegacion({ token, huellaNombreSha256, reservaId,
    propietario, leaseSegundos }) {
    return this.#operarPorToken(token, SCRIPT_RESERVAR_ALEGACION,
      [hash(huellaNombreSha256), idOperacion(reservaId),
        texto(propietario, 190, 'propietario'),
        String(entero(leaseSegundos, 1, 3600, 'leaseSegundos'))]);
  }

  async consolidarAlegacion({ token, huellaNombreSha256, reservaId,
    propietario, resultado, usuarioIdResuelto = null,
    generacionRecuperacionObservada = null }) {
    if (!Object.values(RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL)
      .filter((valor) => valor !== 'presupuesto_agotado').includes(resultado)) {
      throw new Error('El resultado de alegación no es consolidable.');
    }
    return this.#operarPorToken(token, SCRIPT_CONSOLIDAR_ALEGACION,
      [hash(huellaNombreSha256), idOperacion(reservaId),
        texto(propietario, 190, 'propietario'), resultado,
        usuarioIdResuelto == null ? '' : idDecimal(usuarioIdResuelto),
        generacionRecuperacionObservada == null
          ? '' : idDecimal(generacionRecuperacionObservada)]);
  }

  async restaurarAlegacion({ token, huellaNombreSha256, reservaId, propietario }) {
    const resuelta = await this.#resolverToken(token);
    if (!resuelta) return false;
    const claves = this.claves(resuelta.solicitudId, resuelta.huella);
    return Boolean(await this.redis.eval(SCRIPT_RESTAURAR_ALEGACION, {
      keys: claves,
      arguments: [resuelta.solicitudId, hash(huellaNombreSha256),
        idOperacion(reservaId), texto(propietario, 190, 'propietario')]
    }));
  }

  async reservarConsumo({ token, reservaId, propietario, leaseSegundos }) {
    return this.#operarPorToken(token, SCRIPT_RESERVAR_CONSUMO,
      [idOperacion(reservaId), texto(propietario, 190, 'propietario'),
        String(entero(leaseSegundos, 1, 3600, 'leaseSegundos'))]);
  }

  async restaurarConsumo({ token, reservaId, propietario }) {
    const resuelta = await this.#resolverToken(token);
    if (!resuelta) return false;
    const claves = this.claves(resuelta.solicitudId, resuelta.huella);
    return Boolean(await this.redis.eval(SCRIPT_RESTAURAR_CONSUMO, {
      keys: claves,
      arguments: [resuelta.solicitudId, idOperacion(reservaId),
        texto(propietario, 190, 'propietario')]
    }));
  }

  async consumir({ token, reservaId, propietario }) {
    return this.#operarPorToken(token, SCRIPT_CONSUMIR,
      [idOperacion(reservaId), texto(propietario, 190, 'propietario')]);
  }

  async retirarIdentidad({ token, usuarioId, generacionRecuperacionObservada }) {
    return this.#operarPorToken(token, SCRIPT_RETIRAR_IDENTIDAD, [
      idDecimal(usuarioId), idDecimal(generacionRecuperacionObservada)
    ]);
  }

  async descartarPreparacion({ solicitudId, token, operacionId, propietario }) {
    const huella = this.calcularHuellaToken(token);
    return Boolean(await this.redis.eval(SCRIPT_DESCARTAR_PREPARACION, {
      keys: this.claves(idSolicitud(solicitudId), huella),
      arguments: [idOperacion(operacionId), texto(propietario, 190, 'propietario')]
    }));
  }

  async #operarPorToken(token, script, argumentos) {
    const resuelta = await this.#resolverToken(token);
    if (!resuelta) return Object.freeze({ estado: 'ausente' });
    return proyectarResultado(await this.redis.eval(script, {
      keys: this.claves(resuelta.solicitudId, resuelta.huella),
      arguments: [resuelta.solicitudId, resuelta.huella, ...argumentos]
    }));
  }

  async #resolverToken(token) {
    const huella = this.calcularHuellaToken(token);
    const solicitudId = await this.redis.get(this.claveToken(huella));
    return solicitudId ? { solicitudId, huella } : null;
  }

  claves(solicitudId, huellaToken) {
    return [this.claveSolicitud(solicitudId), this.claveToken(huellaToken),
      this.claveFrontera(solicitudId), this.claveAlegaciones(solicitudId)];
  }

  claveSolicitud(id) { return `${this.prefijo}solicitud:${idSolicitud(id)}`; }
  claveToken(huella) { return `${this.prefijo}token:${hash(huella)}`; }
  claveFrontera(id) { return `${this.prefijo}frontera:${idSolicitud(id)}`; }
  claveAlegaciones(id) { return `${this.prefijo}alegaciones:${idSolicitud(id)}`; }
}

function hidratarSolicitud(agregado, fronteraInterna) {
  const miembros = Object.values(fronteraInterna);
  return crearSolicitudRecuperacionPasswordEmail({
    perfil: agregado.perfil,
    version: Number(agregado.version),
    solicitudId: agregado.solicitudId,
    buzonCanonico: agregado.buzonCanonico,
    tokenHashSha256: agregado.tokenHashSha256,
    frontera: crearFronteraRecuperacionPasswordEmail({
      perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.FRONTERA,
      version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
      miembros
    }),
    estado: agregado.estado,
    emitidaEnUtc: fechaUtc(agregado.emitidaEnMs),
    expiraEnUtc: fechaUtc(agregado.expiraEnMs),
    presupuestoMaximo: Number(agregado.presupuestoMaximo),
    presupuestoRestante: Number(agregado.presupuestoRestante),
    huellasAlegadas: Array.isArray(agregado.huellasAlegadas)
      ? agregado.huellasAlegadas
      : Object.values(agregado.huellasAlegadas || {}),
    usuarioIdVinculado: agregado.usuarioIdVinculado ?? null,
    huellaNombreVinculado: agregado.huellaNombreVinculado ?? null,
    reserva: agregado.reserva ? {
      perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.RESERVA,
      version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
      reservaId: agregado.reserva.reservaId,
      tipo: TIPOS_RESERVA_RECUPERACION_PASSWORD_EMAIL.CONSUMO,
      creadaEnUtc: fechaUtc(agregado.reserva.creadaEnMs),
      venceEnUtc: fechaUtc(agregado.reserva.venceEnMs)
    } : null
  });
}

function serializarFrontera(frontera) {
  return JSON.stringify(Object.fromEntries(frontera.miembros.map((miembro) => [
    miembro.usuarioId,
    miembro
  ])));
}

function proyectarResultado(resultado) {
  const textoResultado = String(resultado ?? 'ausente');
  if (!textoResultado.startsWith('{')) return Object.freeze({ estado: textoResultado });
  const valor = JSON.parse(textoResultado);
  for (const clave of ['ahoraMs', 'venceEnMs', 'emitidaEnMs', 'expiraEnMs']) {
    if (valor[clave] != null) valor[clave.replace('Ms', 'Utc')] = fechaUtc(valor[clave]);
  }
  return Object.freeze(valor);
}

function fechaUtc(ms) {
  return ms == null ? null : new Date(Number(ms)).toISOString();
}

function tokenValido(valor) {
  const token = String(valor || '');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new Error('Token bearer inválido.');
  return token;
}

function idSolicitud(valor) {
  return validarUuidV7Auditoria(valor, 'solicitudId');
}

function idOperacion(valor) {
  return validarUuidV7Auditoria(valor, 'identidadOperacion');
}

function idDecimal(valor) {
  const textoId = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(textoId)) throw new Error('Identidad decimal inválida.');
  return textoId;
}

function hash(valor) {
  const textoHash = String(valor || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(textoHash)) throw new Error('Huella SHA-256 inválida.');
  return textoHash;
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} está fuera de rango.`);
  }
  return numero;
}

function texto(valor, maximo, campo) {
  const resultado = String(valor || '');
  if (!resultado || resultado.length > maximo) throw new Error(`${campo} no es válido.`);
  return resultado;
}

function prefijoSeguro(valor) {
  const prefijo = String(valor || '');
  if (!prefijo || /[\s\u0000]/u.test(prefijo)) throw new Error('Prefijo Redis inválido.');
  return prefijo;
}

function sha(valor) {
  return crypto.createHash('sha256').update(valor, 'utf8').digest('hex');
}
