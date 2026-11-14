import crypto from 'node:crypto';
import { validarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';

const ESTADO_PREPARADA = 'preparada';
const ESTADO_PENDIENTE_ACEPTACION = 'pendiente_aceptacion_smtp';
const ESTADO_ACTIVA = 'activa';
const ESTADO_CONSUMIENDO = 'consumiendo';

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error(`${campo} debe ser un identificador decimal positivo.`);
  }
  return texto;
}

function exigirOperacionCoordinada(operacion) {
  if (!operacion || operacion.estado !== ESTADO_PREPARADA ||
      operacion.expiraEn !== null || !operacion.emisionInicialId ||
      !operacion.idOperacion || !operacion.huellaToken || !operacion.idUsuario) {
    throw new Error('La operación no es una preparación coordinada válida.');
  }
  validarUuidV7Auditoria(operacion.emisionInicialId, 'emisionInicialId');
  return operacion;
}

function exigirOperacionActivaCoordinada(operacion) {
  if (!operacion || operacion.estado !== ESTADO_ACTIVA ||
      !operacion.expiraEn || !operacion.emisionInicialId ||
      !operacion.salidaInicialId || !operacion.idOperacion ||
      !operacion.huellaToken || !operacion.idUsuario) {
    throw new Error('La operación no es una verificación coordinada activa.');
  }
  validarUuidV7Auditoria(operacion.emisionInicialId, 'emisionInicialId');
  return operacion;
}

const SCRIPT_LIBERAR_BLOQUEO = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const SCRIPT_PREPARAR = `
local anteriorId = redis.call('GET', KEYS[1])
if anteriorId then
  local anteriorClave = ARGV[6] .. anteriorId
  local anteriorBruta = redis.call('GET', anteriorClave)
  if anteriorBruta then
    local anterior = cjson.decode(anteriorBruta)
    local referenciaAnterior = {
      estado = 'sustituida',
      idUsuario = anterior.idUsuario,
      expiraEn = anterior.expiraEn
    }
    redis.call('SET', ARGV[7] .. anterior.huellaToken,
      cjson.encode(referenciaAnterior), 'EX', ARGV[5])
    redis.call('DEL', anteriorClave)
  end
end

redis.call('DEL', KEYS[4])

redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[5])
return anteriorId or ''
`;

const SCRIPT_ACTIVAR = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 'sustituida'
end
local operacionBruta = redis.call('GET', KEYS[2])
local referenciaBruta = redis.call('GET', KEYS[3])
if not operacionBruta or not referenciaBruta then
  return 'ausente'
end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.estado ~= 'preparada' or referencia.estado ~= 'preparada' then
  return 'estado_invalido'
end
operacion.estado = 'activa'
referencia.estado = 'activa'
redis.call('SET', KEYS[2], cjson.encode(operacion), 'KEEPTTL')
redis.call('SET', KEYS[3], cjson.encode(referencia), 'KEEPTTL')
redis.call('SET', KEYS[4], '1', 'EX', ARGV[2])
return 'activada'
`;

const SCRIPT_VINCULAR_SALIDA_INICIAL = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 'sustituida'
end
local operacionBruta = redis.call('GET', KEYS[2])
local referenciaBruta = redis.call('GET', KEYS[3])
if not operacionBruta or not referenciaBruta then
  return 'ausente'
end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.estado ~= 'preparada' or referencia.estado ~= 'preparada' then
  return 'estado_invalido'
end
if operacion.emisionInicialId ~= ARGV[2] then
  return 'emision_incompatible'
end
if operacion.salidaInicialId and operacion.salidaInicialId ~= cjson.null then
  if tostring(operacion.salidaInicialId) == ARGV[3] then
    return 'ya_vinculada'
  end
  return 'salida_incompatible'
end
operacion.salidaInicialId = ARGV[3]
redis.call('SET', KEYS[2], cjson.encode(operacion), 'KEEPTTL')
return 'vinculada'
`;

const SCRIPT_PUBLICAR_SALIDA_INICIAL = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 'sustituida'
end
local operacionBruta = redis.call('GET', KEYS[2])
local referenciaBruta = redis.call('GET', KEYS[3])
if not operacionBruta or not referenciaBruta then
  return 'ausente'
end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.emisionInicialId ~= ARGV[2]
   or tostring(operacion.salidaInicialId or '') ~= ARGV[3] then
  return 'vinculo_incompatible'
end
if operacion.estado == 'pendiente_aceptacion_smtp'
   and referencia.estado == 'pendiente_aceptacion_smtp' then
  return cjson.encode(operacion)
end
if operacion.estado ~= 'preparada' or referencia.estado ~= 'preparada' then
  return 'estado_invalido'
end
operacion.estado = 'pendiente_aceptacion_smtp'
referencia.estado = 'pendiente_aceptacion_smtp'
redis.call('SET', KEYS[2], cjson.encode(operacion), 'KEEPTTL')
redis.call('SET', KEYS[3], cjson.encode(referencia), 'KEEPTTL')
return cjson.encode(operacion)
`;

const SCRIPT_ACTIVAR_TRAS_ACEPTACION = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 'sustituida' end
local operacionBruta = redis.call('GET', KEYS[2])
local referenciaBruta = redis.call('GET', KEYS[3])
if not operacionBruta or not referenciaBruta then return 'ausente' end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.emisionInicialId ~= ARGV[2]
   or tostring(operacion.salidaInicialId or '') ~= ARGV[3] then
  return 'vinculo_incompatible'
end
if operacion.estado == 'activa' and referencia.estado == 'activa' then
  return cjson.encode(operacion)
end
if operacion.estado ~= 'pendiente_aceptacion_smtp'
   or referencia.estado ~= 'pendiente_aceptacion_smtp' then
  return 'estado_invalido'
end
local reloj = redis.call('TIME')
local ahoraMs = tonumber(reloj[1]) * 1000 + math.floor(tonumber(reloj[2]) / 1000)
if tonumber(ARGV[5]) <= ahoraMs then return 'aceptacion_expirada' end
operacion.estado = 'activa'
operacion.aceptadaSmtpEn = ARGV[4]
operacion.expiraEn = ARGV[6]
referencia.estado = 'activa'
referencia.expiraEn = ARGV[6]
redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[5])
redis.call('SET', KEYS[2], cjson.encode(operacion), 'PXAT', ARGV[5])
redis.call('SET', KEYS[3], cjson.encode(referencia), 'EX', ARGV[7])
redis.call('SET', KEYS[4], '1', 'EX', ARGV[8])
return cjson.encode(operacion)
`;

const SCRIPT_INVALIDAR = `
local actualId = redis.call('GET', KEYS[1])
if not actualId then
  redis.call('DEL', KEYS[2])
  return 0
end
if ARGV[1] ~= '' and actualId ~= ARGV[1] then
  return 0
end
local operacionClave = ARGV[4] .. actualId
local operacionBruta = redis.call('GET', operacionClave)
if operacionBruta then
  local operacion = cjson.decode(operacionBruta)
  local referencia = {
    estado = ARGV[2],
    idUsuario = operacion.idUsuario,
    expiraEn = operacion.expiraEn
  }
  redis.call('SET', ARGV[5] .. operacion.huellaToken,
    cjson.encode(referencia), 'EX', ARGV[3])
  redis.call('DEL', operacionClave)
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return 1
`;

const SCRIPT_RESERVAR = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 'sustituida'
end
local operacionBruta = redis.call('GET', KEYS[2])
local referenciaBruta = redis.call('GET', KEYS[3])
if not operacionBruta or not referenciaBruta then
  return 'ausente'
end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.estado == 'consumiendo' or referencia.estado == 'consumiendo' then
  return 'ocupada'
end
if operacion.estado ~= 'activa' or referencia.estado ~= 'activa' then
  return 'estado_invalido'
end
operacion.estado = 'consumiendo'
operacion.reserva = ARGV[2]
referencia.estado = 'consumiendo'
referencia.reserva = ARGV[2]
redis.call('SET', KEYS[2], cjson.encode(operacion), 'KEEPTTL')
redis.call('SET', KEYS[3], cjson.encode(referencia), 'KEEPTTL')
return operacionBruta
`;

const SCRIPT_RESTAURAR = `
local operacionBruta = redis.call('GET', KEYS[1])
local referenciaBruta = redis.call('GET', KEYS[2])
if not operacionBruta or not referenciaBruta then
  return 0
end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.estado ~= 'consumiendo' or operacion.reserva ~= ARGV[1] then
  return 0
end
operacion.estado = 'activa'
operacion.reserva = nil
referencia.estado = 'activa'
referencia.reserva = nil
redis.call('SET', KEYS[1], cjson.encode(operacion), 'KEEPTTL')
redis.call('SET', KEYS[2], cjson.encode(referencia), 'KEEPTTL')
return 1
`;

const SCRIPT_FINALIZAR = `
local referenciaBruta = redis.call('GET', KEYS[3])
if referenciaBruta then
  local referencia = cjson.decode(referenciaBruta)
  if referencia.estado == 'consumida' then
    return 'ya_consumida'
  end
end
local operacionBruta = redis.call('GET', KEYS[2])
if not operacionBruta then
  return 'ausente'
end
local operacion = cjson.decode(operacionBruta)
if ARGV[2] ~= '' and operacion.reserva ~= ARGV[2] then
  return 'reserva_invalida'
end
local referencia = {
  estado = 'consumida',
  idUsuario = operacion.idUsuario,
  expiraEn = operacion.expiraEn
}
redis.call('SET', KEYS[3], cjson.encode(referencia), 'EX', ARGV[3])
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[4])
return 'consumida'
`;

const SCRIPT_RENOVAR = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 'sustituida'
end
local operacionBruta = redis.call('GET', KEYS[2])
local referenciaBruta = redis.call('GET', KEYS[3])
if not operacionBruta or not referenciaBruta then
  return 'ausente'
end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.estado ~= 'activa' or referencia.estado ~= 'activa' then
  return 'estado_invalido'
end
operacion.expiraEn = ARGV[2]
operacion.reenviadaEn = ARGV[3]
referencia.expiraEn = ARGV[2]
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
redis.call('SET', KEYS[2], cjson.encode(operacion), 'EX', ARGV[4])
redis.call('SET', KEYS[3], cjson.encode(referencia), 'EX', ARGV[5])
return cjson.encode(operacion)
`;

const SCRIPT_RENOVAR_CON_SALIDA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 'sustituida'
end
local operacionBruta = redis.call('GET', KEYS[2])
local referenciaBruta = redis.call('GET', KEYS[3])
if not operacionBruta or not referenciaBruta then
  return 'ausente'
end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.estado ~= 'activa' or referencia.estado ~= 'activa' then
  return 'estado_invalido'
end
if not operacion.emisionInicialId
   or not operacion.salidaInicialId
   or operacion.salidaInicialId == cjson.null then
  return 'operacion_no_coordinada'
end
local reenvios = operacion.reenvios or {}
for _, reenvio in ipairs(reenvios) do
  if reenvio.emisionId == ARGV[2] then
    if tostring(reenvio.salidaId) ~= ARGV[3] then
      return 'salida_incompatible'
    end
    return cjson.encode(operacion)
  end
end
table.insert(reenvios, {
  emisionId = ARGV[2],
  salidaId = ARGV[3],
  liberadaEn = ARGV[4]
})
operacion.reenvios = reenvios
redis.call('SET', KEYS[2], cjson.encode(operacion), 'KEEPTTL')
return cjson.encode(operacion)
`;

const SCRIPT_RENOVAR_TRAS_ACEPTACION = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 'sustituida' end
local operacionBruta = redis.call('GET', KEYS[2])
local referenciaBruta = redis.call('GET', KEYS[3])
if not operacionBruta or not referenciaBruta then return 'ausente' end
local operacion = cjson.decode(operacionBruta)
local referencia = cjson.decode(referenciaBruta)
if operacion.estado ~= 'activa' or referencia.estado ~= 'activa' then
  return 'estado_invalido'
end
local vinculada = false
for _, reenvio in ipairs(operacion.reenvios or {}) do
  if reenvio.emisionId == ARGV[2] and tostring(reenvio.salidaId) == ARGV[3] then
    vinculada = true
  end
end
if not vinculada then return 'vinculo_incompatible' end
if operacion.aceptadaSmtpEn and operacion.aceptadaSmtpEn >= ARGV[4] then
  return cjson.encode(operacion)
end
local reloj = redis.call('TIME')
local ahoraMs = tonumber(reloj[1]) * 1000 + math.floor(tonumber(reloj[2]) / 1000)
if tonumber(ARGV[5]) <= ahoraMs then return 'aceptacion_expirada' end
operacion.reenviadaEn = ARGV[4]
operacion.aceptadaSmtpEn = ARGV[4]
operacion.expiraEn = ARGV[6]
referencia.expiraEn = ARGV[6]
redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[5])
redis.call('SET', KEYS[2], cjson.encode(operacion), 'PXAT', ARGV[5])
redis.call('SET', KEYS[3], cjson.encode(referencia), 'EX', ARGV[7])
redis.call('SET', KEYS[4], '1', 'EX', ARGV[8])
return cjson.encode(operacion)
`;

export class RepositorioOperacionesEmailPerfilRedis {
  constructor({
    clienteRedis,
    prefijoRedis = 'sentinelia:perfil:email:',
    ttlOperacionSegundos = 15 * 60,
    ttlReferenciaSegundos = 30 * 60,
    ttlBloqueoSegundos = 120,
    cadenciaReenvioSegundos = 3 * 60,
    secretoProteccionTokens,
    obtenerAhoraMs = () => Date.now()
  }) {
    this.clienteRedis = clienteRedis;
    this.prefijoRedis = prefijoRedis;
    this.ttlOperacionSegundos = ttlOperacionSegundos;
    this.ttlReferenciaSegundos = ttlReferenciaSegundos;
    this.ttlBloqueoSegundos = ttlBloqueoSegundos;
    this.cadenciaReenvioSegundos = cadenciaReenvioSegundos;
    this.obtenerAhoraMs = obtenerAhoraMs;
    const secreto = String(secretoProteccionTokens || '');
    if (secreto.length < 16) {
      throw new Error(
        'La protección de tokens de email requiere un secreto suficiente.'
      );
    }
    this.claveProteccionTokens = crypto
      .createHash('sha256')
      .update(`sentinelia:perfil:email:${secreto}`)
      .digest();
  }

  generarToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  calcularHuellaToken(token) {
    const normalizado = this.normalizarToken(token);
    return crypto.createHash('sha256').update(normalizado).digest('hex');
  }

  async adquirirBloqueoUsuario(idUsuario) {
    const bloqueo = crypto.randomUUID();
    const resultado = await this.clienteRedis.set(
      this.claveBloqueo(idUsuario),
      bloqueo,
      { NX: true, EX: this.ttlBloqueoSegundos }
    );
    return resultado === 'OK' ? bloqueo : null;
  }

  async liberarBloqueoUsuario(idUsuario, bloqueo) {
    if (!bloqueo) return false;
    const resultado = await this.clienteRedis.eval(SCRIPT_LIBERAR_BLOQUEO, {
      keys: [this.claveBloqueo(idUsuario)],
      arguments: [bloqueo]
    });
    return Number(resultado || 0) > 0;
  }

  async prepararOperacion({
    idUsuario,
    emailOrigen,
    emailCandidato,
    huellaCredencialOrigen,
    token,
    emisionInicialId = null
  }) {
    const idOperacion = crypto.randomUUID();
    const huellaToken = this.calcularHuellaToken(token);
    const ahoraMs = Number(this.obtenerAhoraMs());
    const coordinada = emisionInicialId !== null;
    const operacion = {
      idOperacion,
      idUsuario: this.normalizarIdUsuario(idUsuario),
      emailOrigen,
      emailCandidato,
      huellaCredencialOrigen: this.normalizarHuella(
        huellaCredencialOrigen
      ),
      huellaToken,
      tokenProtegido: this.protegerToken(token),
      estado: ESTADO_PREPARADA,
      creadaEn: new Date(ahoraMs).toISOString(),
      expiraEn: coordinada
        ? null
        : new Date(ahoraMs + this.ttlOperacionSegundos * 1000).toISOString(),
      ...(coordinada ? {
        emisionInicialId: validarUuidV7Auditoria(
          emisionInicialId,
          'emisionInicialId'
        ),
        salidaInicialId: null
      } : {})
    };
    const referencia = this.crearReferencia(operacion);

    const anteriorId = await this.clienteRedis.eval(SCRIPT_PREPARAR, {
      keys: [
        this.claveIndice(idUsuario),
        this.claveOperacion(idOperacion),
        this.claveToken(huellaToken),
        this.claveCadenciaReenvio(idUsuario)
      ],
      arguments: [
        idOperacion,
        JSON.stringify(operacion),
        JSON.stringify(referencia),
        String(this.ttlOperacionSegundos),
        String(this.ttlReferenciaSegundos),
        this.prefijoOperaciones(),
        this.prefijoTokens()
      ]
    });

    return { operacion, anteriorId: anteriorId || null };
  }

  async activarOperacion(operacion) {
    return this.clienteRedis.eval(SCRIPT_ACTIVAR, {
      keys: [
        this.claveIndice(operacion.idUsuario),
        this.claveOperacion(operacion.idOperacion),
        this.claveToken(operacion.huellaToken),
        this.claveCadenciaReenvio(operacion.idUsuario)
      ],
      arguments: [
        operacion.idOperacion,
        String(this.cadenciaReenvioSegundos)
      ]
    });
  }

  async vincularSalidaInicial({ operacion, salidaId, emisionInicialId } = {}) {
    const operacionValida = exigirOperacionCoordinada(operacion);
    const salida = idDecimal(salidaId, 'salidaId');
    const emision = validarUuidV7Auditoria(
      emisionInicialId,
      'emisionInicialId'
    );
    return this.clienteRedis.eval(SCRIPT_VINCULAR_SALIDA_INICIAL, {
      keys: [
        this.claveIndice(operacionValida.idUsuario),
        this.claveOperacion(operacionValida.idOperacion),
        this.claveToken(operacionValida.huellaToken)
      ],
      arguments: [operacionValida.idOperacion, emision, salida]
    });
  }

  async activarOperacionConSalidaInicialPendiente({
    operacion,
    salidaId,
    emisionInicialId
  } = {}) {
    const operacionValida = exigirOperacionCoordinada(operacion);
    const salida = idDecimal(salidaId, 'salidaId');
    const emision = validarUuidV7Auditoria(
      emisionInicialId,
      'emisionInicialId'
    );
    const resultado = await this.clienteRedis.eval(
      SCRIPT_PUBLICAR_SALIDA_INICIAL,
      {
        keys: [
          this.claveIndice(operacionValida.idUsuario),
          this.claveOperacion(operacionValida.idOperacion),
          this.claveToken(operacionValida.huellaToken),
          this.claveCadenciaReenvio(operacionValida.idUsuario)
        ],
        arguments: [
          operacionValida.idOperacion,
          emision,
          salida
        ]
      }
    );
    if (!String(resultado || '').startsWith('{')) {
      return Object.freeze({ estado: resultado || 'ausente', operacion: null });
    }
    return Object.freeze({
      estado: 'publicada',
      operacion: Object.freeze(JSON.parse(resultado))
    });
  }

  async activarOperacionTrasAceptacionSmtp({
    operacionEmailPerfilId,
    emisionEmailPerfilId,
    salidaId,
    aceptadaEnUtc
  } = {}) {
    const idOperacion = this.normalizarIdOperacion(operacionEmailPerfilId);
    const localizada = await this.leerJson(this.claveOperacion(idOperacion));
    if (!localizada) return Object.freeze({ estado: 'ausente', operacion: null });
    const emision = validarUuidV7Auditoria(emisionEmailPerfilId, 'emisionEmailPerfilId');
    const salida = idDecimal(salidaId, 'salidaId');
    const aceptadaMs = Date.parse(String(aceptadaEnUtc || ''));
    if (!Number.isFinite(aceptadaMs)) throw new Error('aceptadaEnUtc no es válida.');
    const expiraEnMs = aceptadaMs + this.ttlOperacionSegundos * 1000;
    const expiraEn = new Date(expiraEnMs).toISOString();
    const resultado = await this.clienteRedis.eval(SCRIPT_ACTIVAR_TRAS_ACEPTACION, {
      keys: [
        this.claveIndice(localizada.idUsuario),
        this.claveOperacion(idOperacion),
        this.claveToken(localizada.huellaToken),
        this.claveCadenciaReenvio(localizada.idUsuario)
      ],
      arguments: [idOperacion, emision, salida, new Date(aceptadaMs).toISOString(),
        String(expiraEnMs), expiraEn, String(this.ttlReferenciaSegundos),
        String(this.cadenciaReenvioSegundos)]
    });
    if (!String(resultado || '').startsWith('{')) {
      return Object.freeze({ estado: resultado || 'ausente', operacion: null });
    }
    return Object.freeze({ estado: 'activada', operacion: Object.freeze(JSON.parse(resultado)) });
  }

  async renovarOperacionTrasAceptacionSmtp({
    operacionEmailPerfilId,
    emisionEmailPerfilId,
    salidaId,
    aceptadaEnUtc
  } = {}) {
    const idOperacion = this.normalizarIdOperacion(operacionEmailPerfilId);
    const localizada = await this.leerJson(this.claveOperacion(idOperacion));
    if (!localizada) return Object.freeze({ estado: 'ausente', operacion: null });
    const emision = validarUuidV7Auditoria(emisionEmailPerfilId, 'emisionEmailPerfilId');
    const salida = idDecimal(salidaId, 'salidaId');
    const aceptadaMs = Date.parse(String(aceptadaEnUtc || ''));
    if (!Number.isFinite(aceptadaMs)) throw new Error('aceptadaEnUtc no es válida.');
    const expiraEnMs = aceptadaMs + this.ttlOperacionSegundos * 1000;
    const expiraEn = new Date(expiraEnMs).toISOString();
    const resultado = await this.clienteRedis.eval(SCRIPT_RENOVAR_TRAS_ACEPTACION, {
      keys: [this.claveIndice(localizada.idUsuario), this.claveOperacion(idOperacion),
        this.claveToken(localizada.huellaToken),
        this.claveCadenciaReenvio(localizada.idUsuario)],
      arguments: [idOperacion, emision, salida, new Date(aceptadaMs).toISOString(),
        String(expiraEnMs), expiraEn, String(this.ttlReferenciaSegundos),
        String(this.cadenciaReenvioSegundos)]
    });
    if (!String(resultado || '').startsWith('{')) {
      return Object.freeze({ estado: resultado || 'ausente', operacion: null });
    }
    return Object.freeze({ estado: 'renovada', operacion: Object.freeze(JSON.parse(resultado)) });
  }

  async invalidarOperacionUsuario(idUsuario, {
    idOperacion = null,
    estado = 'sustituida'
  } = {}) {
    return this.clienteRedis.eval(SCRIPT_INVALIDAR, {
      keys: [
        this.claveIndice(idUsuario),
        this.claveCadenciaReenvio(idUsuario)
      ],
      arguments: [
        idOperacion || '',
        estado,
        String(this.ttlReferenciaSegundos),
        this.prefijoOperaciones(),
        this.prefijoTokens()
      ]
    });
  }

  async diagnosticarTokenOhuella(valor, { esHuella = false } = {}) {
    let huellaToken;
    try {
      huellaToken = esHuella
        ? this.normalizarHuella(valor)
        : this.calcularHuellaToken(valor);
    } catch (_error) {
      return { estado: 'invalida', operacion: null, huellaToken: null };
    }

    const referencia = await this.leerJson(this.claveToken(huellaToken));
    if (!referencia) {
      return { estado: 'invalida', operacion: null, huellaToken };
    }

    if (referencia.estado === ESTADO_PENDIENTE_ACEPTACION) {
      const operacion = await this.leerJson(this.claveOperacion(referencia.idOperacion));
      return { estado: ESTADO_PENDIENTE_ACEPTACION, operacion, huellaToken };
    }
    if (!['activa', 'consumiendo'].includes(referencia.estado)) {
      return { estado: this.traducirEstadoReferencia(referencia.estado), operacion: null, huellaToken };
    }

    if (!referencia.expiraEn ||
        Date.parse(referencia.expiraEn) <= Number(this.obtenerAhoraMs())) {
      return { estado: 'expirada', operacion: null, huellaToken };
    }

    const operacion = await this.leerJson(
      this.claveOperacion(referencia.idOperacion)
    );
    if (!operacion || operacion.huellaToken !== huellaToken) {
      return { estado: 'invalida', operacion: null, huellaToken };
    }

    return { estado: referencia.estado, operacion, huellaToken };
  }

  async obtenerOperacionActual(idUsuario) {
    const idOperacion = await this.clienteRedis.get(
      this.claveIndice(idUsuario)
    );
    if (!idOperacion) {
      return { estado: 'ausente', operacion: null, huellaToken: null };
    }

    const operacion = await this.leerJson(this.claveOperacion(idOperacion));
    if (!operacion || Number(operacion.idUsuario) !== Number(idUsuario)) {
      return { estado: 'invalida', operacion: null, huellaToken: null };
    }

    return this.diagnosticarTokenOhuella(operacion.huellaToken, {
      esHuella: true
    });
  }

  async obtenerOperacionPorId(idOperacion) {
    const id = this.normalizarIdOperacion(idOperacion);
    const operacion = await this.leerJson(this.claveOperacion(id));
    if (!operacion || operacion.idOperacion !== id) {
      return { estado: 'ausente', operacion: null };
    }
    if (operacion.estado === ESTADO_PENDIENTE_ACEPTACION && !operacion.expiraEn) {
      return { estado: ESTADO_PENDIENTE_ACEPTACION, operacion };
    }
    if (!operacion.expiraEn ||
        Date.parse(operacion.expiraEn) <= Number(this.obtenerAhoraMs())) {
      return { estado: 'expirada', operacion: null };
    }
    return { estado: operacion.estado, operacion };
  }

  async intentarRegistrarReenvio(idUsuario) {
    const clave = this.claveCadenciaReenvio(idUsuario);
    const resultado = await this.clienteRedis.set(clave, '1', {
      NX: true,
      EX: this.cadenciaReenvioSegundos
    });
    if (resultado === 'OK') {
      return { permitido: true, reintentarEnSegundos: 0 };
    }
    const ttl = await this.clienteRedis.ttl(clave);
    return {
      permitido: false,
      reintentarEnSegundos: Math.max(
        1,
        Number(ttl) > 0 ? Number(ttl) : this.cadenciaReenvioSegundos
      )
    };
  }

  recuperarTokenOperacion(operacion) {
    try {
      const protegido = operacion?.tokenProtegido;
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.claveProteccionTokens,
        Buffer.from(protegido.iv, 'base64url')
      );
      decipher.setAuthTag(Buffer.from(protegido.tag, 'base64url'));
      const token = Buffer.concat([
        decipher.update(Buffer.from(protegido.ciphertext, 'base64url')),
        decipher.final()
      ]).toString('utf8');
      const huellaRecuperada = this.calcularHuellaToken(token);
      const esperada = Buffer.from(operacion.huellaToken, 'hex');
      const recuperada = Buffer.from(huellaRecuperada, 'hex');
      if (
        esperada.length !== recuperada.length ||
        !crypto.timingSafeEqual(esperada, recuperada)
      ) {
        return null;
      }
      return token;
    } catch (_error) {
      return null;
    }
  }

  calcularHuellaCredencial(hashPassword) {
    const material = String(hashPassword || '');
    if (!material) {
      throw new Error('No existe una credencial vigente para proteger la operación.');
    }
    return crypto.createHash('sha256').update(material).digest('hex');
  }

  coincideHuellaCredencial(operacion, hashPassword) {
    try {
      const esperada = Buffer.from(
        this.normalizarHuella(operacion.huellaCredencialOrigen),
        'hex'
      );
      const actual = Buffer.from(
        this.calcularHuellaCredencial(hashPassword),
        'hex'
      );
      return esperada.length === actual.length &&
        crypto.timingSafeEqual(esperada, actual);
    } catch (_error) {
      return false;
    }
  }

  async renovarOperacion(operacion, vinculacion = null) {
    if (vinculacion !== null) {
      return this.renovarOperacionConSalidaPendiente(operacion, vinculacion);
    }
    const ahoraMs = Number(this.obtenerAhoraMs());
    const reenviadaEn = new Date(ahoraMs).toISOString();
    const expiraEn = new Date(
      ahoraMs + this.ttlOperacionSegundos * 1000
    ).toISOString();
    const resultado = await this.clienteRedis.eval(SCRIPT_RENOVAR, {
      keys: [
        this.claveIndice(operacion.idUsuario),
        this.claveOperacion(operacion.idOperacion),
        this.claveToken(operacion.huellaToken)
      ],
      arguments: [
        operacion.idOperacion,
        expiraEn,
        reenviadaEn,
        String(this.ttlOperacionSegundos),
        String(this.ttlReferenciaSegundos)
      ]
    });
    if (!String(resultado || '').startsWith('{')) {
      return { estado: resultado || 'ausente', operacion: null };
    }
    return { estado: 'renovada', operacion: JSON.parse(resultado) };
  }

  async renovarOperacionConSalidaPendiente(operacion, {
    salidaId,
    emisionReenvioId
  } = {}) {
    const operacionValida = exigirOperacionActivaCoordinada(operacion);
    const salida = idDecimal(salidaId, 'salidaId');
    const emision = validarUuidV7Auditoria(
      emisionReenvioId,
      'emisionReenvioId'
    );
    const ahoraMs = Number(this.obtenerAhoraMs());
    const reenviadaEn = new Date(ahoraMs).toISOString();
    const resultado = await this.clienteRedis.eval(SCRIPT_RENOVAR_CON_SALIDA, {
      keys: [
        this.claveIndice(operacionValida.idUsuario),
        this.claveOperacion(operacionValida.idOperacion),
        this.claveToken(operacionValida.huellaToken)
      ],
      arguments: [
        operacionValida.idOperacion,
        emision,
        salida,
        reenviadaEn
      ]
    });
    if (!String(resultado || '').startsWith('{')) {
      return Object.freeze({ estado: resultado || 'ausente', operacion: null });
    }
    return Object.freeze({
      estado: 'renovada',
      operacion: Object.freeze(JSON.parse(resultado))
    });
  }

  async reservarConsumo({ operacion, huellaToken }) {
    const reserva = crypto.randomUUID();
    const resultado = await this.clienteRedis.eval(SCRIPT_RESERVAR, {
      keys: [
        this.claveIndice(operacion.idUsuario),
        this.claveOperacion(operacion.idOperacion),
        this.claveToken(huellaToken)
      ],
      arguments: [operacion.idOperacion, reserva]
    });
    if (!String(resultado || '').startsWith('{')) {
      return { estado: resultado || 'ausente', reserva: null, operacion: null };
    }
    return { estado: 'reservada', reserva, operacion: JSON.parse(resultado) };
  }

  async restaurarConsumo({ operacion, reserva }) {
    return this.clienteRedis.eval(SCRIPT_RESTAURAR, {
      keys: [
        this.claveOperacion(operacion.idOperacion),
        this.claveToken(operacion.huellaToken)
      ],
      arguments: [reserva]
    });
  }

  async finalizarConsumo({ operacion, reserva = null }) {
    return this.clienteRedis.eval(SCRIPT_FINALIZAR, {
      keys: [
        this.claveIndice(operacion.idUsuario),
        this.claveOperacion(operacion.idOperacion),
        this.claveToken(operacion.huellaToken),
        this.claveCadenciaReenvio(operacion.idUsuario)
      ],
      arguments: [
        operacion.idOperacion,
        reserva || '',
        String(this.ttlReferenciaSegundos)
      ]
    });
  }

  crearReferencia(operacion) {
    return {
      idOperacion: operacion.idOperacion,
      idUsuario: operacion.idUsuario,
      estado: operacion.estado,
      expiraEn: operacion.expiraEn
    };
  }

  protegerToken(token) {
    const normalizado = this.normalizarToken(token);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.claveProteccionTokens,
      iv
    );
    const ciphertext = Buffer.concat([
      cipher.update(normalizado, 'utf8'),
      cipher.final()
    ]);
    return {
      algoritmo: 'aes-256-gcm',
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url')
    };
  }

  async leerJson(clave) {
    const bruto = await this.clienteRedis.get(clave);
    if (!bruto) return null;
    try {
      return JSON.parse(bruto);
    } catch (_error) {
      await this.clienteRedis.del(clave);
      return null;
    }
  }

  traducirEstadoReferencia(estado) {
    return {
      sustituida: 'sustituida',
      consumida: 'consumida',
      invalidada: 'invalida',
      preparada: 'invalida'
    }[estado] || 'invalida';
  }

  normalizarToken(token) {
    const normalizado = String(token || '').trim();
    if (!/^[A-Za-z0-9_-]{43}$/u.test(normalizado)) {
      throw new Error('Token de verificación inválido.');
    }
    return normalizado;
  }


  normalizarIdOperacion(idOperacion) {
    const id = String(idOperacion ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(id)) {
      throw new Error('La identidad de operación de email no es válida.');
    }
    return id;
  }

  normalizarHuella(huella) {
    const normalizada = String(huella || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(normalizada)) {
      throw new Error('Huella de verificación inválida.');
    }
    return normalizada;
  }

  normalizarIdUsuario(idUsuario) {
    const id = Number(idUsuario);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('La operación de email requiere un usuario válido.');
    }
    return id;
  }

  claveIndice(idUsuario) {
    return `${this.prefijoRedis}usuario:${this.normalizarIdUsuario(idUsuario)}:actual`;
  }

  claveBloqueo(idUsuario) {
    return `${this.prefijoRedis}usuario:${this.normalizarIdUsuario(idUsuario)}:bloqueo`;
  }

  claveCadenciaReenvio(idUsuario) {
    return `${this.prefijoRedis}usuario:${this.normalizarIdUsuario(idUsuario)}:cadencia_reenvio`;
  }

  claveOperacion(idOperacion) {
    return `${this.prefijoOperaciones()}${idOperacion}`;
  }

  claveToken(huellaToken) {
    return `${this.prefijoTokens()}${huellaToken}`;
  }

  prefijoOperaciones() {
    return `${this.prefijoRedis}operacion:`;
  }

  prefijoTokens() {
    return `${this.prefijoRedis}token:`;
  }
}
