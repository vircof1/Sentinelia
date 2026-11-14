import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';
import { TIPOS_REGISTRO_TRIGGERS_INFORMATIVOS_FEDERACION, validarPayloadTriggersInformativosFederacion } from '../src/PayloadTriggersInformativosFederacion.js';

export class ErrorTriggersInformativosRemotosFederacion extends Error { constructor(c,m){super(m);this.name='ErrorTriggersInformativosRemotosFederacion';this.codigo=c;} }
export class RepositorioTriggersInformativosRemotoSql {
  constructor(clienteSql){if(typeof clienteSql?.obtenerConexion!=='function')throw new Error('Los triggers remotos requieren SQL operativo.');this.clienteSql=clienteSql;}
  async materializarEnTransaccion({operacion,payload,contexto}={}, {conexion}={}){
    await exigirTransaccion(conexion);const trabajo=await trabajoBloqueado(conexion,contexto);if(operacion!==trabajo.operacion)fallar('operacion_trigger_remoto_no_corresponde','La operación no coincide con el trabajo.');if(operacion==='salidaProyeccion')return Object.freeze({estado:'sinCambio',causa:'salidaProyeccionGobernadaPorContribucion',proyeccionId:trabajo.proyeccion_id,secuenciaElemento:String(trabajo.secuencia_elemento)});if(operacion==='retirada'&&payload!==null&&payload!==undefined)fallar('retirada_trigger_remoto_con_payload','Una retirada no transporta payload.');const normalizado=operacion==='actualizacion'?validarPayloadTriggersInformativosFederacion(payload,{operacion}):{perfil:'sentinelia-federacion-triggers-retirada-v1',version:1,causa:'retiradaOrigen'},canonico=canonicalizarJsonFederacion(normalizado);const [existentes]=await conexion.execute('SELECT * FROM registros_triggers_informativos_remotos WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=? FOR UPDATE',[trabajo.proyeccion_id,trabajo.generacion_id,String(trabajo.secuencia_elemento)]);if(existentes[0]){if(existentes[0].trabajo_entrega_id!==trabajo.entrega_id||existentes[0].representacion_canonica!==canonico||existentes[0].estado_registro!==(operacion==='retirada'?'retirado':'presente'))fallar('registro_trigger_remoto_divergente','La secuencia ya contiene otro dato.');return resultado(trabajo,operacion,true);}const d=operacion==='actualizacion'?dimensiones(normalizado,trabajo):{};const [ahora]=await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');await conexion.execute(`INSERT INTO registros_triggers_informativos_remotos (proyeccion_id,generacion_id,secuencia_elemento,trabajo_entrega_id,inbox_ocurrencia_id,ocurrencia_origen_id,tipo_registro,estado_registro,trigger_origen_id,monitor_origen_id,referencia_origen_id,estado_ejecucion,tiempo_dato_utc,causa_retirada,representacion_canonica,materializada_en_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[trabajo.proyeccion_id,trabajo.generacion_id,String(trabajo.secuencia_elemento),trabajo.entrega_id,String(trabajo.inbox_ocurrencia_id),trabajo.ocurrencia_origen_id,d.tipoRegistro??null,operacion==='retirada'?'retirado':'presente',d.triggerOrigenId??null,d.monitorOrigenId??null,d.referenciaOrigenId??null,d.estadoEjecucion??null,d.tiempoDatoUtc??null,operacion==='retirada'?'retiradaOrigen':null,canonico,ahora[0].ahora]);return resultado(trabajo,operacion,false);
  }
  listarDefiniciones(f={}){return this.#consultar({...f,tipoRegistro:'definicion'});}
  listarAsignaciones(f={}){return this.#consultar({...f,tipoRegistro:'asignacionMonitor'});}
  listarEjecucionesTerminadas({desdeUtc=null,hastaUtc=null,limite=200,...f}={}){const c=[],p=[];if(desdeUtc!==null){c.push('r.tiempo_dato_utc>=?');p.push(fecha(desdeUtc));}if(hastaUtc!==null){c.push('r.tiempo_dato_utc<?');p.push(fecha(hastaUtc));}if(desdeUtc!==null&&hastaUtc!==null&&fecha(hastaUtc)<=fecha(desdeUtc))fallar('rango_consulta_triggers_invalido','El rango histórico es inválido.');return this.#consultar({...f,tipoRegistro:'ejecucionTerminada'},{adicionales:c,parametrosAdicionales:p,limite:limiteValido(limite),orden:'r.tiempo_dato_utc DESC,r.proyeccion_id'});}
  async crearBorradorPlantillaLocal({proyeccionId}={}){
    const [registro]=await this.listarDefiniciones({proyeccionId});
    if(!registro)fallar('trigger_remoto_plantilla_inexistente','No existe la definición remota.');
    if(registro.completitud.interpretable!=='completa'||registro.estadoProyeccion.autorizacion!=='autorizada'||registro.estadoProyeccion.vigencia!=='vigente')fallar('trigger_remoto_plantilla_no_interpretable','La definición remota no está vigente, autorizada e interpretable.');
    const p=registro.payload;
    const correo=p.tipo==='correo';
    const definicionCorreo=correo&&p.contenidoSensible?.estado==='presente'
      ? p.contenidoSensible.contenido?.definicionMensaje??null
      : null;
    const configuracion=correo
      ? (definicionCorreo===null?null:sanearConfiguracionPlantilla(definicionCorreo))
      : sanearConfiguracionPlantilla(p.configuracionOperativa);
    return Object.freeze({
      nombre:`Copia de ${p.nombre}`,
      tipo:p.tipo,
      descripcion:p.descripcion,
      activo:false,
      configuracion,
      audiencia:Object.freeze([]),
      soloPrevisualizacion:correo&&definicionCorreo===null,
      definicionReusableDisponible:!correo||definicionCorreo!==null,
      previsualizacionFederada:correo?Object.freeze({
        forma:sanearConfiguracionPlantilla(p.configuracionOperativa),
        definicionReusableDisponible:definicionCorreo!==null
      }):null,
      requiereCredencialLocal:correo
        ? false
        : p.contenidoSensible?.estado==='presente'||p.contenidoSensible?.causa!=='ausenteEnOrigen',
      procedenciaFederada:Object.freeze({installationOrigenId:registro.installationOrigenId,elementoOrigenId:registro.elementoOrigenId,proyeccionId:registro.proyeccionId,generacionId:registro.generacionId,secuenciaElemento:registro.secuenciaElemento}),
      persistida:false
    });
  }
  async #consultar({installationOrigenId=null,proyeccionId=null,triggerOrigenId=null,monitorOrigenId=null,tipoRegistro=null}={}, {adicionales=[],parametrosAdicionales=[],limite=null,orden='r.proyeccion_id'}={}){const c=[...adicionales],p=[...parametrosAdicionales];if(installationOrigenId!==null){c.push('p.installation_origen_id=?');p.push(id(installationOrigenId,TIPOS_IDENTIDAD_FEDERADA.INSTALACION));}if(proyeccionId!==null){c.push('p.proyeccion_id=?');p.push(id(proyeccionId,TIPOS_IDENTIDAD_FEDERADA.PROYECCION));}if(triggerOrigenId!==null){c.push('r.trigger_origen_id=?');p.push(elemento(triggerOrigenId));}if(monitorOrigenId!==null){c.push('r.monitor_origen_id=?');p.push(elemento(monitorOrigenId));}if(tipoRegistro!==null){if(!TIPOS_REGISTRO_TRIGGERS_INFORMATIVOS_FEDERACION.includes(tipoRegistro))fallar('tipo_consulta_triggers_invalido','Tipo de consulta inválido.');c.push('r.tipo_registro=?');p.push(tipoRegistro);}const filtroTipo=tipoRegistro===null?'':`AND (r2.tipo_registro='${tipoRegistro}' OR r2.estado_registro='retirado')`,filtro=c.length?`AND ${c.join(' AND ')}`:'',tope=limite===null?'':` LIMIT ${limite}`;const filas=await this.clienteSql.consultar(`WITH actuales AS (SELECT p.proyeccion_id,a.generacion_actual_id,v.ultima_secuencia_evaluada,(SELECT MAX(r2.secuencia_elemento) FROM registros_triggers_informativos_remotos r2 WHERE r2.proyeccion_id=p.proyeccion_id AND r2.generacion_id=a.generacion_actual_id AND r2.secuencia_elemento<=v.ultima_secuencia_evaluada ${filtroTipo}) secuencia FROM proyecciones_federacion p JOIN estados_actuales_proyecciones_federacion a ON a.proyeccion_id=p.proyeccion_id JOIN versiones_proyecciones_federacion v ON v.proyeccion_id=a.proyeccion_id AND v.generacion_id=a.generacion_actual_id AND v.estado_publicacion='actual' WHERE p.familia='triggersInformativos') SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,a.generacion_actual_id,r.secuencia_elemento,r.ocurrencia_origen_id,r.tipo_registro,r.trigger_origen_id,r.monitor_origen_id,r.referencia_origen_id,r.estado_ejecucion,r.tiempo_dato_utc,r.representacion_canonica,v.completitud_interpretable,v.completitud_observable,v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,v.estado_autorizacion FROM actuales a JOIN proyecciones_federacion p ON p.proyeccion_id=a.proyeccion_id JOIN versiones_proyecciones_federacion v ON v.proyeccion_id=a.proyeccion_id AND v.generacion_id=a.generacion_actual_id JOIN registros_triggers_informativos_remotos r ON r.proyeccion_id=a.proyeccion_id AND r.generacion_id=a.generacion_actual_id AND r.secuencia_elemento=a.secuencia AND r.estado_registro='presente' WHERE 1=1 ${filtro} ORDER BY ${orden}${tope}`,p);return Object.freeze(filas.map(mapear));}
}
function sanearConfiguracionPlantilla(v){
  const sensibles=/password|passwd|contrasena|secret|secreto|token|api[_-]?key|authorization|credential|credencial/iu;
  if(Array.isArray(v))return v.map(sanearConfiguracionPlantilla);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.entries(v)
    .filter(([k])=>!sensibles.test(k))
    .map(([k,x])=>[
      k,
      /^(?:url|uri|endpoint)$/iu.test(k)&&typeof x==='string'
        ? sanearUrlPlantilla(x,sensibles)
        : sanearConfiguracionPlantilla(x)
    ]));
}
function sanearUrlPlantilla(valor,sensibles){
  try{
    const url=new URL(valor);
    if(!['http:','https:'].includes(url.protocol))return '';
    url.username='';
    url.password='';
    for(const clave of [...url.searchParams.keys()]){
      if(sensibles.test(clave))url.searchParams.delete(clave);
    }
    return url.toString();
  }catch{return '';}
}
async function trabajoBloqueado(c,x){const entrega=id(x?.entregaId,TIPOS_IDENTIDAD_FEDERADA.ENTREGA),propietario=String(x?.propietario||''),fencing=String(x?.fencingToken||'');const[f]=await c.execute("SELECT t.*,p.familia familia_proyeccion FROM trabajos_materializacion_federacion t JOIN proyecciones_federacion p ON p.proyeccion_id=t.proyeccion_id WHERE t.entrega_id=? AND t.estado='procesando' AND t.propietario_lease=? AND t.fencing_token=? AND t.lease_hasta_utc>UTC_TIMESTAMP(3) FOR UPDATE",[entrega,propietario,fencing]);if(!f[0])fallar('fencing_materializacion_trigger_obsoleto','El trabajo no está gobernado por este materializador.');if(f[0].familia!=='triggersInformativos'||f[0].familia_proyeccion!=='triggersInformativos')fallar('familia_materializacion_trigger_incompatible','El trabajo pertenece a otra familia.');return f[0];}
function dimensiones(p,t){const ref=p.tipoRegistro==='asignacionMonitor'?p.monitorReferencia:p.tipoRegistro==='ejecucionTerminada'?p.asignacionReferencia:null;return{tipoRegistro:p.tipoRegistro,triggerOrigenId:p.tipoRegistro==='definicion'?t.elemento_origen_id:p.triggerOrigenId,monitorOrigenId:p.monitorReferencia?.elementoOrigenId??null,referenciaOrigenId:ref?.elementoOrigenId??null,estadoEjecucion:p.estadoEjecucion??null,tiempoDatoUtc:p.tipoRegistro==='ejecucionTerminada'?new Date(p.finalizadoEnUtc):null};}
function mapear(f){return Object.freeze({proyeccionId:f.proyeccion_id,installationOrigenId:f.installation_origen_id,elementoOrigenId:f.elemento_origen_id,generacionId:f.generacion_actual_id,secuenciaElemento:String(f.secuencia_elemento),ocurrenciaOrigenId:f.ocurrencia_origen_id,tipoRegistro:f.tipo_registro,triggerOrigenId:f.trigger_origen_id,monitorOrigenId:f.monitor_origen_id,referenciaOrigenId:f.referencia_origen_id,estadoEjecucion:f.estado_ejecucion,tiempoDatoUtc:f.tiempo_dato_utc===null?null:new Date(f.tiempo_dato_utc).toISOString(),scopeRecepcion:Object.freeze({nivel:f.scope_nivel,tenantId:f.scope_tenant_id===null?null:String(f.scope_tenant_id),empresaId:f.scope_empresa_id===null?null:String(f.scope_empresa_id),sitioId:f.scope_sitio_id===null?null:String(f.scope_sitio_id)}),completitud:Object.freeze({interpretable:f.completitud_interpretable,observable:f.completitud_observable,reconstruible:f.completitud_reconstruible}),estadoProyeccion:Object.freeze({vigencia:f.estado_vigencia,soporte:f.estado_soporte,autorizacion:f.estado_autorizacion}),payload:JSON.parse(f.representacion_canonica)});}
function resultado(t,o,y){return Object.freeze({estado:o==='retirada'?'retirada':'materializada',yaMaterializada:y,proyeccionId:t.proyeccion_id,generacionId:t.generacion_id,secuenciaElemento:String(t.secuencia_elemento)});}
async function exigirTransaccion(c){if(typeof c?.execute!=='function')fallar('conexion_trigger_remoto_ausente','Se requiere conexión compartida.');const[f]=await c.query('SELECT @@session.in_transaction AS activa');if(!Boolean(f[0]?.activa))fallar('transaccion_trigger_remoto_ausente','Se requiere transacción activa.');}
function id(v,t){try{return String(crearIdentidadFederada({tipo:t,valor:String(v||'')}));}catch{fallar('identidad_trigger_remoto_invalida','Identidad federada inválida.');}}
function elemento(v){return id(v,TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);}
function fecha(v){const d=new Date(v);if(Number.isNaN(d.getTime()))fallar('fecha_consulta_triggers_invalida','Fecha de consulta inválida.');return d;}
function limiteValido(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>1000)fallar('limite_consulta_triggers_invalido','El límite debe estar entre 1 y 1000.');return n;}
function fallar(c,m){throw new ErrorTriggersInformativosRemotosFederacion(c,m);}
