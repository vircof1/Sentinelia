import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ServicioCorreoPortal } from '../paquetes/correo/src/ServicioCorreoPortal.js';
import { EvaluadorAutoridadCorreoSql } from '../paquetes/correo/src/EvaluadorAutoridadCorreoSql.js';
import { PerfilSmtpCorreo } from '../paquetes/correo/src/PerfilSmtpCorreo.js';
import { ValidadorConfiguracionCorreo } from '../paquetes/correo/src/ValidadorConfiguracionCorreo.js';
import { DespachadorCorreoSql } from '../paquetes/correo/src/DespachadorCorreoSql.js';
import { RepositorioColaCorreo } from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const cfg = {activo:true, operativoVerificado:false, smtpHost:'mailpit', smtpPuerto:1025,
  smtpTimeoutConexionMs:1000,smtpTimeoutSaludoMs:1000,smtpTimeoutSocketMs:1000,
  remitenteEmail:'sentinelia@laboratorio.test',remitenteNombre:'Sentinelia',
  maxReintentos:1,reintentoBaseSegundos:15,bloqueoTtlSegundos:90,runtimeLoteMaximo:3};
const configuracion = obtenerConfiguracionAplicacion();
const administrador = new ClienteSql(configuracion.sql);
const nombre = `sentinelia_fixture_prueba_${randomBytes(5).toString('hex')}`;
let sql;
try {
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(nombre)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  sql = new ClienteSql({...configuracion.sql,baseDatos:nombre});
  await new EjecutorMigraciones({clienteSql:sql,repositorioMigraciones:new RepositorioMigraciones(sql),rutaMigraciones:obtenerRutaMigraciones()}).ejecutarPendientes();
  const frontera = new FronteraTransaccionalLocal(sql);
  const cola = new RepositorioColaCorreo(sql);
  let permitido = true;
  const valores = new Map(Object.entries(cfg).map(([key,value]) => [
    'correo.'+key.replace(/[A-Z]/g, c=>'_'+c.toLowerCase()),String(value)
  ]));
  for (const key of ['smtp_usuario','smtp_password','smtp_auth_method']) valores.set('correo.'+key,'');
  for (const key of ['smtp_secure','smtp_tls_permitir_inseguro']) valores.set('correo.'+key,'false');
  const clave = Buffer.alloc(32,7);
  const perfil = new PerfilSmtpCorreo({keyringTecnicoCorreo:{obtenerActiva:()=>({keyId:'fixture',clave}),obtener:()=>clave}});
  const prueba = perfil.crearPrueba(valores);
  const autoridadReal = new EvaluadorAutoridadCorreoSql({
    repositorioConfiguracion:{bloquearAutoridadCorreoEnTransaccion:async()=>({
      valores,versionConfiguracion:'1',
      estadoDespliegue:{verificacion_smtp_autoritativa:1,guard_verificacion_legacy_activo:1},
      estadoVerificacion:{verificado:permitido?1:0,perfil_version:prueba.perfilVersion,
        key_id:prueba.keyId,huella_hmac:prueba.huellaHmac,configuracion_version:'1'}
    })},perfilSmtpCorreo:perfil,validadorConfiguracionCorreo:new ValidadorConfiguracionCorreo()
  });
  const evaluador = autoridadReal;
  const portal = {asegurarActualizada:async()=>{},obtenerEstadoDespliegueCorreoActual:()=>({cola_sql_autoritativa:1,verificacion_smtp_autoritativa:1}),obtenerConfiguracionActual:()=>({obtenerConfiguracionCorreo:()=>cfg})};
  const servicio = new ServicioCorreoPortal({servicioConfiguracionPortal:portal,validadorConfiguracionCorreo:new ValidadorConfiguracionCorreo(),repositorioColaCorreo:cola,evaluadorAutoridadCorreoSql:evaluador,fronteraTransaccional:frontera});
  const entrada = {destinatarioEmail:'prueba@laboratorio.test',asunto:'Prueba SQL',cuerpoTexto:'Mensaje de regresión'};
  valores.set('correo.activo','false');
  await assert.rejects(()=>servicio.encolarCorreoPrueba(entrada),/correo_configuracion_smtp_invalida/);
  valores.set('correo.activo','true');
  valores.set('correo.smtp_host','otra-configuracion');
  await assert.rejects(()=>servicio.encolarCorreoPrueba(entrada),/correo_huella_smtp_no_coincide/);
  valores.set('correo.smtp_host','mailpit');
  const salida = await servicio.encolarCorreoPrueba(entrada);
  assert.equal(salida.productorVersion,'sql@1');
  assert.equal(salida.origenTipo,'prueba');
  assert.ok(salida.smtpMessageId);
  let envios=0;
  const smtp={enviarIntentoTrigger:async()=>assert.fail('No usar envío exclusivo de trigger'),enviarIntentoSql:async(config,s,op)=>{
    assert.equal(op.origenEsperado,'prueba');assert.equal(s.smtpMessageId,salida.smtpMessageId);assert.equal(config.remitenteEmail,cfg.remitenteEmail);envios++;
    return {estado:'aceptado',clasificacion:'aceptacion_demostrada',codigo:'smtp_ok',respuestaSaneada:'250 OK'};
  }};
  const despachador=new DespachadorCorreoSql({fronteraTransaccional:frontera,repositorioColaCorreo:cola,evaluadorAutoridadCorreoSql:evaluador,clienteSmtp:smtp});
  permitido=false;
  cfg.operativoVerificado=true; // La bandera antigua no puede eludir la autoridad SQL.
  await assert.rejects(()=>servicio.encolarCorreoPrueba(entrada),/smtp_no_verificado/);
  assert.equal((await despachador.despacharSiguiente()).despachado,false);
  assert.equal(envios,0);
  cfg.operativoVerificado=false;
  permitido=true;
  const resultado=await despachador.despacharSiguiente();
  assert.equal(resultado.despachado,true);
  assert.equal((await cola.buscarPorId(salida.id)).estado,'enviado');
  assert.equal(envios,1);
  assert.equal((await despachador.despacharSiguiente()).despachado,false);
  assert.equal(envios,1);
  const capacidades=await sql.consultar('SELECT COUNT(*) AS total FROM capacidades_desuscripcion_correo');
  assert.equal(Number(capacidades[0].total),0);
  console.log('CORREO_PRUEBA_SQL_OK: admisión, pausa, despacho único y sin capacidad de baja');
} finally {
  await sql?.cerrar?.();
  await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`);
  await administrador.cerrar();
}
