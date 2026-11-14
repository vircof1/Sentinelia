import { crearCampoPresenteFederado } from '../src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA, crearIdentidadFederada } from '../src/IdentidadFederada.js';
import { PERFIL_PAYLOAD_AVISOS_FEDERADOS, VERSION_PAYLOAD_AVISOS_FEDERADOS, validarPayloadAvisosFederados } from '../src/PayloadAvisosFederados.js';
import { FuenteEntropiaCriptograficaNode } from './FuenteEntropiaCriptograficaNode.js';
import { bytesAIdAvisoPlataforma, idAvisoPlataformaABytes } from '../../avisos-plataforma/src/IdentidadAvisoPlataforma.js';

export class ErrorAvisosFederadosLocal extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.name = 'ErrorAvisosFederadosLocal'; this.codigo = codigo; }
}

export class RepositorioAvisosFederadosLocalSql {
  constructor(clienteSql, {
    installationLocalId,
    generadorIdentidades = new GeneradorIdentidadesFederadas({
      fuenteEntropia: new FuenteEntropiaCriptograficaNode()
    }),
    ahora = () => new Date()
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') throw new Error('Los avisos federables requieren SQL operativo.');
    this.clienteSql = clienteSql;
    this.installationLocalId = identidad(installationLocalId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
    this.generador = generadorIdentidades;
    this.ahora = ahora;
  }

  async prepararCapturaEnTransaccion({
    tipoRegistro = 'estadoActual', avisoId, ordinal = null,
    incluirActorVisible = false, puedeVerActor = false
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    if (incluirActorVisible && !puedeVerActor) {
      fallar('actor_aviso_federado_no_autorizado', 'La fotografía visible del actor exige permiso actual.');
    }
    const aviso = await cargarAviso(conexion, avisoId);
    if (!aviso) fallar('aviso_federable_inexistente', 'El aviso local no existe.');
    const instante = iso(this.ahora());
    if (tipoRegistro === 'estadoActual') {
      const historico = await cargarUltimaTransicion(conexion, aviso.aviso_id);
      const actor = await fotografiaActor(conexion, historico, {
        visible: incluirActorVisible, generador: this.generador, instante
      });
      const elementoOrigenId = await identidadAviso(conexion, {
        tipo: tipoRegistro, clave: bytesAIdAvisoPlataforma(aviso.aviso_id),
        aviso, generador: this.generador, instante
      });
      return captura(this, aviso, tipoRegistro, elementoOrigenId,
        validarPayloadAvisosFederados(payloadEstado(this, aviso, actor)),
        'operativaActual', instante);
    }
    if (tipoRegistro !== 'transicion') fallar('tipo_captura_aviso_invalido', 'El tipo de captura no existe.');
    const historico = await cargarTransicion(conexion, aviso.aviso_id, ordinal);
    if (!historico) fallar('transicion_aviso_federable_inexistente', 'La transición solicitada no existe.');
    const actor = await fotografiaActor(conexion, historico, {
      visible: incluirActorVisible, generador: this.generador, instante
    });
    const clave = `${bytesAIdAvisoPlataforma(aviso.aviso_id)}:${historico.ordinal}`;
    const elementoOrigenId = await identidadAviso(conexion, {
      tipo: tipoRegistro, clave, aviso, generador: this.generador, instante
    });
    return captura(this, aviso, tipoRegistro, elementoOrigenId,
      validarPayloadAvisosFederados(payloadTransicion(aviso, historico, actor)),
      'reconstruccion', instante);
  }

  async listarCapturasEnTransaccion({
    flujoId, generacionId, incluirActorVisible = false, puedeVerActor = false
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const flujo = await cargarFlujo(conexion, flujoId, generacionId);
    const [avisos] = await conexion.execute(
      `SELECT * FROM avisos_plataforma WHERE ${condicionScope(flujo)}
        ORDER BY primera_deteccion_utc,aviso_id FOR UPDATE`,
      parametrosScope(flujo)
    );
    const salida = [];
    for (const aviso of avisos) {
      salida.push(await this.prepararCapturaEnTransaccion({
        tipoRegistro: 'estadoActual', avisoId: bytesAIdAvisoPlataforma(aviso.aviso_id),
        incluirActorVisible, puedeVerActor
      }, { conexion }));
      const [historico] = await conexion.execute(
        'SELECT ordinal FROM historico_avisos_plataforma WHERE aviso_id=? ORDER BY ordinal FOR UPDATE',
        [aviso.aviso_id]
      );
      for (const fila of historico) {
        salida.push(await this.prepararCapturaEnTransaccion({
          tipoRegistro: 'transicion', avisoId: bytesAIdAvisoPlataforma(aviso.aviso_id),
          ordinal: Number(fila.ordinal), incluirActorVisible, puedeVerActor
        }, { conexion }));
      }
    }
    return Object.freeze(salida);
  }

  async prepararCapturasMutacionEnTransaccion({
    avisoId, ordinal, incluirActorVisible = false, puedeVerActor = false
  } = {}, opciones = {}) {
    const estado = await this.prepararCapturaEnTransaccion({
      avisoId, tipoRegistro: 'estadoActual', incluirActorVisible, puedeVerActor
    }, opciones);
    const transicion = await this.prepararCapturaEnTransaccion({
      avisoId, tipoRegistro: 'transicion', ordinal,
      incluirActorVisible, puedeVerActor
    }, opciones);
    return Object.freeze([estado, transicion]);
  }

  async prepararRetiradaEnTransaccion({ avisoId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const aviso = await cargarAviso(conexion, avisoId);
    if (!aviso) fallar('aviso_retirada_inexistente', 'El aviso debe existir durante la retirada.');
    const instante = iso(this.ahora());
    const [identidades] = await conexion.execute(
      "SELECT * FROM identidades_elementos_avisos_federacion WHERE aviso_id=? AND estado='vigente' ORDER BY tipo_elemento,clave_local FOR UPDATE",
      [aviso.aviso_id]
    );
    const salida = [];
    for (const fila of identidades) {
      await conexion.execute(
        "UPDATE identidades_elementos_avisos_federacion SET estado='retirado',retirada_en_utc=?,actualizada_en_utc=? WHERE tipo_elemento=? AND clave_local=?",
        [sqlFecha(instante), sqlFecha(instante), fila.tipo_elemento, fila.clave_local]
      );
      salida.push(captura(this, aviso, fila.tipo_elemento, fila.elemento_origen_id,
        null, fila.tipo_elemento === 'estadoActual' ? 'operativaActual' : 'reconstruccion',
        instante, 'retirada'));
    }
    return Object.freeze(salida);
  }
}

function payloadEstado(repo, a, actor) {
  return {
    perfil: PERFIL_PAYLOAD_AVISOS_FEDERADOS, version: VERSION_PAYLOAD_AVISOS_FEDERADOS,
    tipoRegistro: 'estadoActual', avisoOrigenId: bytesAIdAvisoPlataforma(a.aviso_id),
    installationAfectadaId: repo.installationLocalId, versionCatalogo: Number(a.version_catalogo),
    tipoCodigo: a.tipo_codigo, causaCodigo: a.causa_codigo, estadoCiclo: a.estado_ciclo,
    gravedad: a.gravedad, objetoAfectado: { tipo: a.objeto_tipo, id: a.objeto_id },
    relacionOrigenId: a.relacion_id, flujoOrigenId: a.flujo_id,
    cicloAnteriorOrigenId: a.ciclo_anterior_aviso_id === null ? null : bytesAIdAvisoPlataforma(a.ciclo_anterior_aviso_id),
    primeraDeteccionUtc: iso(a.primera_deteccion_utc), ultimaDeteccionUtc: iso(a.ultima_deteccion_utc),
    resueltoEnUtc: isoOpcional(a.resuelto_en_utc), obsoletoEnUtc: isoOpcional(a.obsoleto_en_utc),
    contadorDetecciones: String(a.contador_detecciones), contextoHumano: json(a.contexto_humano),
    resumen: json(a.resumen), actorUltimaTransicion: actor
  };
}

function payloadTransicion(a, h, actor) {
  return {
    perfil: PERFIL_PAYLOAD_AVISOS_FEDERADOS, version: VERSION_PAYLOAD_AVISOS_FEDERADOS,
    tipoRegistro: 'transicion', avisoOrigenId: bytesAIdAvisoPlataforma(a.aviso_id),
    ordinal: Number(h.ordinal), transicionTipo: h.transicion_tipo,
    estadoAnterior: h.estado_anterior, estadoNuevo: h.estado_nuevo,
    gravedadAnterior: h.gravedad_anterior, gravedadNueva: h.gravedad_nueva,
    contadorDetecciones: String(h.contador_detecciones), efectivoEnUtc: iso(h.efectivo_en_utc),
    registradoEnUtc: iso(h.registrado_en_utc),
    eventoAuditoriaOrigenId: bytesAIdAvisoPlataforma(h.evento_auditoria_id),
    correlacionOrigenId: bytesAIdAvisoPlataforma(h.correlacion_id),
    detalle: json(h.detalle), contextoHumano: json(h.contexto_humano), resumen: json(h.resumen), actor
  };
}

function captura(repo, aviso, tipo, elementoOrigenId, payload, prioridad, instante, operacion = 'actualizacion') {
  return Object.freeze({
    tipoRegistro: tipo, elementoOrigenId, payload, prioridad,
    definicion: Object.freeze({
      familia: 'avisosFederados', familiaVersion: 1,
      installationOrigenId: repo.installationLocalId, elementoOrigenId,
      ocurrenciaOrigenId: String(repo.generador.generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)),
      operacion, tiempoOrigenUtc: instante, scopeOrigenDeclarado: scopeDeclarado(aviso),
      vigenciaRestanteMs: null,
      campos: operacion === 'actualizacion'
        ? {
            avisosFederados: crearCampoPresenteFederado({
              valor: payload,
              sensibilidad: payloadAvisoContieneActorVisible(payload)
                ? 'sensible'
                : 'ordinario'
            })
          }
        : {},
      evidenciaIntegridad: []
    })
  });
}

async function fotografiaActor(c, h, { visible, generador, instante }) {
  if (!h?.actor_real_tipo || !h?.actor_real_id) return { estado: 'omitida' };
  const elementoOrigenId = await identidadActor(c, h.actor_real_tipo, h.actor_real_id, generador, instante);
  if (!visible) return { estado: 'opaca', elementoOrigenId };
  let nombreVisible = etiquetaActor(h.actor_real_tipo, h.actor_real_id);
  if (h.actor_real_tipo === 'usuario') {
    const [usuarios] = await c.execute(
      'SELECT nombre_mostrar,nombre_completo FROM usuarios WHERE id=? LIMIT 1',
      [h.actor_real_id]
    );
    nombreVisible = usuarios[0]?.nombre_mostrar || usuarios[0]?.nombre_completo || 'Usuario';
  }
  return { estado: 'visible', elementoOrigenId, tipo: h.actor_real_tipo, nombreVisible };
}

async function identidadActor(c, tipo, clave, generador, instante) {
  const [f] = await c.execute(
    'SELECT elemento_origen_id FROM identidades_actores_federacion WHERE tipo_actor=? AND clave_actor_local=? FOR UPDATE',
    [tipo, clave]
  );
  if (f[0]) return f[0].elemento_origen_id;
  const id = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN));
  await c.execute(
    'INSERT INTO identidades_actores_federacion (tipo_actor,clave_actor_local,elemento_origen_id,creada_en_utc) VALUES (?,?,?,?)',
    [tipo, clave, id, sqlFecha(instante)]
  );
  return id;
}

async function identidadAviso(c, { tipo, clave, aviso, generador, instante }) {
  const [f] = await c.execute(
    'SELECT elemento_origen_id,estado FROM identidades_elementos_avisos_federacion WHERE tipo_elemento=? AND clave_local=? FOR UPDATE',
    [tipo, clave]
  );
  if (f[0]) { if (f[0].estado !== 'vigente') fallar('identidad_aviso_retirada', 'Una identidad retirada no resucita.'); return f[0].elemento_origen_id; }
  const id = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN));
  await c.execute(
    "INSERT INTO identidades_elementos_avisos_federacion (tipo_elemento,clave_local,aviso_id,elemento_origen_id,scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,creada_en_utc,actualizada_en_utc,retirada_en_utc) VALUES (?,?,?,?,?,?,?,'vigente',?,?,NULL)",
    [tipo, clave, aviso.aviso_id, id, aviso.scope_tenant_id, aviso.scope_empresa_id, aviso.scope_sitio_id, sqlFecha(instante), sqlFecha(instante)]
  );
  return id;
}

async function cargarAviso(c, id) { const [f] = await c.execute('SELECT * FROM avisos_plataforma WHERE aviso_id=? LIMIT 1 FOR UPDATE',[idAvisoPlataformaABytes(id)]); return f[0] || null; }
async function cargarTransicion(c, avisoId, ordinal) { const [f] = await c.execute(`SELECT h.*,e.actor_real_tipo,e.actor_real_id FROM historico_avisos_plataforma h LEFT JOIN eventos_auditoria e ON e.evento_id=h.evento_auditoria_id WHERE h.aviso_id=? AND h.ordinal=? LIMIT 1 FOR UPDATE`,[avisoId,ordinal]); return f[0] || null; }
async function cargarUltimaTransicion(c, avisoId) { const [f] = await c.execute(`SELECT h.*,e.actor_real_tipo,e.actor_real_id FROM historico_avisos_plataforma h LEFT JOIN eventos_auditoria e ON e.evento_id=h.evento_auditoria_id WHERE h.aviso_id=? ORDER BY h.ordinal DESC LIMIT 1 FOR UPDATE`,[avisoId]); return f[0] || null; }
async function cargarFlujo(c, flujoId, generacionId) { const [f] = await c.execute("SELECT f.scope_nivel,f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id FROM flujos_federacion f JOIN generaciones_flujos_federacion g ON g.flujo_id=f.flujo_id AND g.generacion_id=? WHERE f.flujo_id=? AND f.direccion='emision' AND f.familia='avisosFederados' AND g.estado NOT IN ('cancelada','sustituida') LIMIT 1 FOR UPDATE",[generacionId,flujoId]); if(!f[0])fallar('flujo_avisos_federados_invalido','No existe una generación emisora vigente para la fotografía solicitada.'); return f[0]; }
function condicionScope(f){if(f.scope_nivel==='portal')return'1=1';if(f.scope_nivel==='tenant')return'scope_tenant_id=?';if(f.scope_nivel==='empresa')return'scope_empresa_id=?';return'scope_sitio_id=?';}
function parametrosScope(f){if(f.scope_nivel==='portal')return[];if(f.scope_nivel==='tenant')return[f.scope_tenant_id];if(f.scope_nivel==='empresa')return[f.scope_empresa_id];return[f.scope_sitio_id];}
function scopeDeclarado(a){if(a.scope_sitio_id!==null)return{nivel:'sitio',tenantId:String(a.scope_tenant_id),empresaId:String(a.scope_empresa_id),sitioId:String(a.scope_sitio_id)};if(a.scope_empresa_id!==null)return{nivel:'empresa',tenantId:String(a.scope_tenant_id),empresaId:String(a.scope_empresa_id),sitioId:null};if(a.scope_tenant_id!==null)return{nivel:'tenant',tenantId:String(a.scope_tenant_id),empresaId:null,sitioId:null};return{nivel:'portal',tenantId:null,empresaId:null,sitioId:null};}
function etiquetaActor(t,id){if(t==='runtime')return'Runtime Sentinelia';if(t==='sistema')return'Sistema Sentinelia';if(t==='instancia_remota')return'Instancia remota';if(t==='agente')return'Agente';return String(id);}
function payloadAvisoContieneActorVisible(payload){return [payload?.actor,payload?.actorUltimaTransicion].some((actor)=>actor?.estado==='visible');}
function json(v){if(v===null||v===undefined)return{};return typeof v==='string'?JSON.parse(v):v;}
function iso(v){const d=v instanceof Date?v:new Date(String(v).includes('T')?v:`${String(v).replace(' ','T')}Z`);if(Number.isNaN(d.getTime()))fallar('fecha_aviso_local_invalida','La fecha no es válida.');return d.toISOString();}
function isoOpcional(v){return v===null||v===undefined?null:iso(v);}
function sqlFecha(v){return v.slice(0,23).replace('T',' ').replace('Z','');}
async function exigirTransaccion(c){if(typeof c?.execute!=='function')fallar('conexion_aviso_local_ausente','Se requiere conexión compartida.');const[f]=await c.query('SELECT @@session.in_transaction AS activa');if(!Boolean(f[0]?.activa))fallar('transaccion_aviso_local_ausente','Se requiere transacción activa.');}
function identidad(v,t){try{return String(crearIdentidadFederada({tipo:t,valor:String(v||'')}));}catch{fallar('identidad_aviso_local_invalida','La identidad no es válida.');}}
function fallar(c,m){throw new ErrorAvisosFederadosLocal(c,m);}
