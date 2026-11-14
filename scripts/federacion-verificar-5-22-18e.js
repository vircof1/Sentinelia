import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { ServicioDiagnosticoFederacionPortal } from '../paquetes/federacion/aplicacion/ServicioDiagnosticoFederacionPortal.js';
import { RepositorioDiagnosticoFederacionPortalSql } from '../paquetes/federacion/adaptadores/RepositorioDiagnosticoFederacionPortalSql.js';

const raiz = new URL('../', import.meta.url);

await verificarAutoridadYScope();
await verificarLecturaDiagnosticaSaneada();
await verificarComposicionPortal();
console.log('5.22.18e verificada: diagnóstico durable, acotado y sin acciones futuras.');

async function verificarAutoridadYScope() {
  const autorizacion = new ServicioAutorizacion();
  const llamadas = [];
  const servicio = new ServicioDiagnosticoFederacionPortal({
    servicioAutorizacion: autorizacion,
    repositorio: {
      async obtener(entrada) {
        llamadas.push(entrada);
        return { relaciones: [], detalle: null };
      }
    }
  });
  const contexto = {
    nivelScope: 'empresa', tenantId: 4, empresaId: 8, sitioId: null,
    impersonacionActiva: true,
    permisos: { verDiagnosticoFederacion: true }
  };
  const salida = await servicio.obtener(contexto, {});
  assert.equal(salida.resumen.generaciones, 0);
  assert.deepEqual(llamadas[0].scope, {
    nivel: 'empresa', tenantId: 4, empresaId: 8, sitioId: null
  });
  assert.equal(autorizacion.puedeVerDiagnosticoFederacion(contexto), true);
  await assert.rejects(
    servicio.obtener({ ...contexto, permisos: {} }, {}),
    (error) => error.statusCode === 403
  );
}

async function verificarLecturaDiagnosticaSaneada() {
  const consultas = [];
  const clienteSql = {
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      if (sql.includes('FROM relaciones_federacion r')) {
        return [{
          relacion_id: 'sfid1.relacion.demo', direccion: 'recepcion',
          estado_ciclo: 'vinculada', estado_autoridad: 'autorizada',
          estado_identidad: 'valida', estado_compatibilidad: 'compatible',
          installation_remota_id: 'sfid1.instalacion.demo',
          nombre_remoto_declarado: 'Instancia A', scope_tenant_id: 4,
          scope_empresa_id: 8, scope_sitio_id: null,
          total_flujos: 0, total_diagnosticos_activos: 0,
          fallos_consecutivos: 0, actualizada_en_utc: new Date()
        }];
      }
      if (sql.includes('FROM flujos_federacion f')) return [];
      if (sql.includes('FROM estados_diagnostico_relaciones_federacion')) return [];
      return [];
    }
  };
  const repositorio = new RepositorioDiagnosticoFederacionPortalSql(clienteSql);
  const salida = await repositorio.obtener({
    scope: { nivel: 'empresa', tenantId: 4, empresaId: 8, sitioId: null }
  });
  assert.equal(salida.detalle.relacion.nombreRemoto, 'Instancia A');
  assert.ok(consultas[0].sql.includes('r.scope_tenant_id=?'));
  assert.ok(consultas[0].sql.includes('r.scope_empresa_id=?'));
  const fuente = await leer('paquetes/federacion/adaptadores/RepositorioDiagnosticoFederacionPortalSql.js');
  for (const tabla of [
    'flujos_federacion', 'generaciones_flujos_federacion',
    'recorrido_contribuciones_federacion',
    'cursores_generaciones_recepcion_federacion',
    'declaraciones_disponibilidad_federacion',
    'divergencias_proyecciones_federacion',
    'resincronizaciones_automaticas_federacion'
  ]) assert.match(fuente, new RegExp(tabla, 'u'));
  assert.doesNotMatch(fuente, /representacion_canonica|declaracion_canonica|detalle_canonico|payload_sha256|credencial|secreto/iu);
  assert.doesNotMatch(fuente, /\b(INSERT|UPDATE|DELETE)\b/u);
}

async function verificarComposicionPortal() {
  const [rutas, controlador, vista, cabecera, index] = await Promise.all([
    leer('apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('apps/sentinelia-web/src/views/portal/federacion-diagnostico.ejs'),
    leer('apps/sentinelia-web/src/views/parciales/cabecera.ejs'),
    leer('apps/sentinelia-web/src/index.js')
  ]);
  assert.match(rutas, /\/federacion\/diagnostico/u);
  assert.match(rutas, /ver_diagnostico_federacion/u);
  assert.match(controlador, /mostrarDiagnostico/u);
  assert.match(controlador, /private, no-store/u);
  assert.match(cabecera, />Diagnóstico</u);
  assert.match(index, /ServicioDiagnosticoFederacionPortal/u);
  for (const concepto of [
    'Flujos', 'Generaciones y cursores', 'Huecos',
    'Recorridos conservados', 'Divergencias', 'Restauración incoherente detenida'
  ]) assert.match(vista, new RegExp(concepto, 'u'));
  assert.doesNotMatch(vista, /method="post"|promover|cancelar|reconstruir ahora|crear candidata/iu);
  assert.doesNotMatch(vista, /alertas remotas|preferenciaMostrarAlertasRemotas/iu);
  ejs.compile(vista, {
    filename: ruta('apps/sentinelia-web/src/views/portal/federacion-diagnostico.ejs')
  });
}

function ruta(relativa) {
  return new URL(relativa, raiz).pathname;
}

function leer(relativa) {
  return readFile(new URL(relativa, raiz), 'utf8');
}
