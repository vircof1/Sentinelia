import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';
import { TIPOS_REGISTRO_AVISOS_FEDERADOS, validarPayloadAvisosFederados } from '../src/PayloadAvisosFederados.js';

export class ErrorAvisosFederadosRemotos extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.name = 'ErrorAvisosFederadosRemotos'; this.codigo = codigo; }
}

export class RepositorioAvisosFederadosRemotoSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') throw new Error('Los avisos federados remotos requieren SQL.');
    this.clienteSql = clienteSql;
  }

  async materializarEnTransaccion({ operacion, payload, contexto } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const trabajo = await trabajoBloqueado(conexion, contexto);
    if (operacion !== trabajo.operacion) fallar('operacion_aviso_remoto_no_corresponde', 'La operación no coincide con el trabajo.');
    if (operacion === 'salidaProyeccion') return Object.freeze({ estado: 'sinCambio', causa: 'salidaGobernadaPorProyeccion' });
    if (operacion === 'retirada' && payload != null) fallar('retirada_aviso_remoto_con_payload', 'Una retirada no transporta payload.');
    const normalizado = operacion === 'actualizacion'
      ? validarPayloadAvisosFederados(payload, { operacion })
      : { perfil: 'sentinelia-federacion-avisos-retirada-v1', version: 1, causa: 'retiradaOrigen' };
    const canonico = canonicalizarJsonFederacion(normalizado);
    const [existentes] = await conexion.execute(
      'SELECT * FROM registros_avisos_federados WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=? FOR UPDATE',
      [trabajo.proyeccion_id, trabajo.generacion_id, String(trabajo.secuencia_elemento)]
    );
    if (existentes[0]) {
      if (existentes[0].trabajo_entrega_id !== trabajo.entrega_id ||
          existentes[0].representacion_canonica !== canonico) {
        fallar('registro_aviso_remoto_divergente', 'La secuencia ya representa otro contenido.');
      }
      return resultado(trabajo, operacion, true);
    }
    const d = operacion === 'actualizacion' ? dimensiones(normalizado) : {};
    const [ahora] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
    await conexion.execute(
      `INSERT INTO registros_avisos_federados (
         proyeccion_id,generacion_id,secuencia_elemento,trabajo_entrega_id,
         inbox_ocurrencia_id,ocurrencia_origen_id,tipo_registro,estado_registro,
         aviso_origen_id,estado_ciclo,gravedad,ordinal_transicion,tiempo_dato_utc,
         representacion_canonica,materializada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [trabajo.proyeccion_id, trabajo.generacion_id, String(trabajo.secuencia_elemento),
        trabajo.entrega_id, String(trabajo.inbox_ocurrencia_id), trabajo.ocurrencia_origen_id,
        d.tipoRegistro ?? null, operacion === 'retirada' ? 'retirado' : 'presente',
        d.avisoOrigenId ?? null, d.estadoCiclo ?? null, d.gravedad ?? null,
        d.ordinal ?? null, d.tiempoDatoUtc ?? null, canonico, ahora[0].ahora]
    );
    return resultado(trabajo, operacion, false);
  }

  listarEstados({ limite = 500, ...filtros } = {}) {
    return this.#consultar({ ...filtros, tipoRegistro: 'estadoActual' }, {
      limite: limiteValido(limite),
      orden: 'r.tiempo_dato_utc DESC,r.aviso_origen_id'
    });
  }
  listarTransiciones({ desdeUtc = null, hastaUtc = null, limite = 200, ...filtros } = {}) {
    const adicionales = [], parametros = [];
    if (desdeUtc !== null) { adicionales.push('r.tiempo_dato_utc>=?'); parametros.push(fecha(desdeUtc)); }
    if (hastaUtc !== null) { adicionales.push('r.tiempo_dato_utc<?'); parametros.push(fecha(hastaUtc)); }
    if (desdeUtc !== null && hastaUtc !== null && fecha(hastaUtc) <= fecha(desdeUtc)) fallar('rango_avisos_remotos_invalido', 'El rango temporal es inválido.');
    return this.#consultar({ ...filtros, tipoRegistro: 'transicion' }, {
      adicionales, parametros, limite: limiteValido(limite),
      orden: 'r.tiempo_dato_utc DESC,r.aviso_origen_id,r.ordinal_transicion'
    });
  }

  async #consultar({ installationOrigenId = null, proyeccionId = null,
    avisoOrigenId = null, scope = null, tipoRegistro }, {
    adicionales = [], parametros = [], limite = null,
    orden = 'r.proyeccion_id'
  } = {}) {
    if (!TIPOS_REGISTRO_AVISOS_FEDERADOS.includes(tipoRegistro)) fallar('tipo_consulta_aviso_remoto_invalido', 'El tipo consultado no existe.');
    const condiciones = [...adicionales], valores = [...parametros];
    if (installationOrigenId !== null) { condiciones.push('p.installation_origen_id=?'); valores.push(id(installationOrigenId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION)); }
    if (proyeccionId !== null) { condiciones.push('p.proyeccion_id=?'); valores.push(id(proyeccionId, TIPOS_IDENTIDAD_FEDERADA.PROYECCION)); }
    if (avisoOrigenId !== null) { condiciones.push('r.aviso_origen_id=?'); valores.push(String(avisoOrigenId)); }
    agregarFiltroScope(condiciones, valores, scope, 'p');
    condiciones.push('r.tipo_registro=?'); valores.push(tipoRegistro);
    const filtro = `AND ${condiciones.join(' AND ')}`;
    const tope = limite === null ? '' : ` LIMIT ${limite}`;
    const filas = await this.clienteSql.consultar(
      `WITH actuales AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,v.ultima_secuencia_evaluada,
                (SELECT MAX(r2.secuencia_elemento) FROM registros_avisos_federados r2
                  WHERE r2.proyeccion_id=p.proyeccion_id
                    AND r2.generacion_id=a.generacion_actual_id
                    AND r2.secuencia_elemento<=v.ultima_secuencia_evaluada) AS secuencia
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id AND v.estado_publicacion='actual'
            AND v.estado_autorizacion='autorizada'
          WHERE p.familia='avisosFederados'
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              a.generacion_actual_id,r.secuencia_elemento,r.ocurrencia_origen_id,
              r.tipo_registro,r.aviso_origen_id,r.estado_ciclo,r.gravedad,
              r.ordinal_transicion,r.tiempo_dato_utc,r.representacion_canonica,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,v.estado_autorizacion
         FROM actuales a
         JOIN proyecciones_federacion p ON p.proyeccion_id=a.proyeccion_id
         JOIN versiones_proyecciones_federacion v ON v.proyeccion_id=a.proyeccion_id AND v.generacion_id=a.generacion_actual_id
         JOIN registros_avisos_federados r ON r.proyeccion_id=a.proyeccion_id
          AND r.generacion_id=a.generacion_actual_id AND r.secuencia_elemento=a.secuencia
          AND r.estado_registro='presente'
        WHERE 1=1 ${filtro} ORDER BY ${orden}${tope}`,
      valores
    );
    return Object.freeze(filas.map(mapear));
  }
}

function dimensiones(p) { return { tipoRegistro: p.tipoRegistro, avisoOrigenId: p.avisoOrigenId, estadoCiclo: p.estadoCiclo ?? p.estadoNuevo, gravedad: p.gravedad ?? p.gravedadNueva, ordinal: p.ordinal ?? null, tiempoDatoUtc: new Date(p.ultimaDeteccionUtc ?? p.efectivoEnUtc) }; }
function mapear(f) { return Object.freeze({ proyeccionId:f.proyeccion_id,installationOrigenId:f.installation_origen_id,elementoOrigenId:f.elemento_origen_id,generacionId:f.generacion_actual_id,secuenciaElemento:String(f.secuencia_elemento),ocurrenciaOrigenId:f.ocurrencia_origen_id,tipoRegistro:f.tipo_registro,avisoOrigenId:f.aviso_origen_id,estadoCiclo:f.estado_ciclo,gravedad:f.gravedad,ordinalTransicion:f.ordinal_transicion===null?null:String(f.ordinal_transicion),tiempoDatoUtc:f.tiempo_dato_utc===null?null:new Date(f.tiempo_dato_utc).toISOString(),scopeRecepcion:Object.freeze({nivel:f.scope_nivel,tenantId:decimal(f.scope_tenant_id),empresaId:decimal(f.scope_empresa_id),sitioId:decimal(f.scope_sitio_id)}),completitud:Object.freeze({interpretable:f.completitud_interpretable,observable:f.completitud_observable,reconstruible:f.completitud_reconstruible}),estadoProyeccion:Object.freeze({vigencia:f.estado_vigencia,soporte:f.estado_soporte,autorizacion:f.estado_autorizacion}),payload:JSON.parse(f.representacion_canonica) }); }
async function trabajoBloqueado(c,x){const entrega=id(x?.entregaId,TIPOS_IDENTIDAD_FEDERADA.ENTREGA),propietario=String(x?.propietario||''),fencing=String(x?.fencingToken||'');const[f]=await c.execute("SELECT t.*,p.familia familia_proyeccion FROM trabajos_materializacion_federacion t JOIN proyecciones_federacion p ON p.proyeccion_id=t.proyeccion_id WHERE t.entrega_id=? AND t.estado='procesando' AND t.propietario_lease=? AND t.fencing_token=? AND t.lease_hasta_utc>UTC_TIMESTAMP(3) FOR UPDATE",[entrega,propietario,fencing]);if(!f[0])fallar('fencing_aviso_remoto_obsoleto','El trabajo no pertenece al materializador.');if(f[0].familia!=='avisosFederados'||f[0].familia_proyeccion!=='avisosFederados')fallar('familia_aviso_remoto_incompatible','El trabajo pertenece a otra familia.');return f[0];}
function resultado(t,o,y){return Object.freeze({estado:o==='retirada'?'retirada':'materializada',yaMaterializada:y,proyeccionId:t.proyeccion_id,generacionId:t.generacion_id,secuenciaElemento:String(t.secuencia_elemento)});}
async function exigirTransaccion(c){if(typeof c?.execute!=='function')fallar('conexion_aviso_remoto_ausente','Se requiere conexión compartida.');const[f]=await c.query('SELECT @@session.in_transaction AS activa');if(!Boolean(f[0]?.activa))fallar('transaccion_aviso_remoto_ausente','Se requiere transacción activa.');}
function id(v,t){try{return String(crearIdentidadFederada({tipo:t,valor:String(v||'')}));}catch{fallar('identidad_aviso_remoto_invalida','La identidad no es válida.');}}
function fecha(v){const d=new Date(v);if(Number.isNaN(d.getTime()))fallar('fecha_consulta_aviso_remoto_invalida','La fecha no es válida.');return d;}
function limiteValido(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>1000)fallar('limite_aviso_remoto_invalido','El límite debe estar entre 1 y 1000.');return n;}
function decimal(v){return v===null?null:String(v);}
function agregarFiltroScope(condiciones, valores, scope, alias) {
  const nivel = String(scope?.nivel || 'portal');
  if (nivel === 'portal') return;
  condiciones.push(`${alias}.scope_tenant_id=?`);
  valores.push(scope?.tenantId);
  if (nivel === 'empresa' || nivel === 'sitio') {
    condiciones.push(`${alias}.scope_empresa_id=?`);
    valores.push(scope?.empresaId);
  }
  if (nivel === 'sitio') {
    condiciones.push(`${alias}.scope_sitio_id=?`);
    valores.push(scope?.sitioId);
  }
}
function fallar(c,m){throw new ErrorAvisosFederadosRemotos(c,m);}
