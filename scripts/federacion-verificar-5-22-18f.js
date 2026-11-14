import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { ServicioPresentacionAvisosPlataforma } from '../apps/sentinelia-web/src/servicios/ServicioPresentacionAvisosPlataforma.js';
import { validarPayloadAuditoriaV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { obtenerDefinicionTipoEventoAuditoria } from '../paquetes/auditoria/src/CatalogoAuditoria.js';
import { AdaptadorAuditoriaAvisosPlataforma } from '../paquetes/avisos-plataforma/src/AdaptadorAuditoriaAvisosPlataforma.js';

const raiz = new URL('../', import.meta.url);

await verificarPresentacionPersonalSaneada();
await verificarScopePersistenciaYAuditoria();
await verificarTopBarYTiempoReal();
console.log('5.22.18f verificada: topBar autorizada, overlays personales auditables y WebSocket saneado.');

async function verificarPresentacionPersonalSaneada() {
  const cambios = [];
  const servicio = new ServicioPresentacionAvisosPlataforma({
    servicioAutorizacion: new ServicioAutorizacion(),
    repositorio: {
      async resumirActivosVisibles() {
        return { totalActivosVisibles: 81, noReconocidos: 79, gravedadMaxima: 'critica' };
      },
      async listarActivosVisibles() {
        return [{
          avisoId: '01987f20-1234-7abc-8abc-1234567890ab',
          gravedad: 'critica', estadoPersonal: 'sin_reconocer',
          contextoHumano: { detalle: 'visible', tokenApi: 'no debe salir' },
          resumen: { mensaje: 'Incidencia' }
        }];
      },
      async cambiarEstadoPersonal(entrada) { cambios.push(entrada); return { estado: entrada.estado }; }
    }
  });
  const contexto = {
    idUsuario: 7, nivelScope: 'empresa', tenantId: 2, empresaId: 3,
    sitioId: null, impersonacionActiva: false,
    permisos: { verAvisosPlataforma: true }
  };
  const salida = await servicio.obtenerResumen(contexto);
  assert.equal(salida.totalActivosVisibles, 81);
  assert.equal(salida.noReconocidos, 79);
  assert.equal(salida.gravedadMaxima, 'critica');
  assert.equal(salida.puedeGestionarOverlays, true);
  assert.equal('tokenApi' in salida.avisos[0].contextoHumano, false);
  const impersonada = await servicio.obtenerResumen({
    ...contexto,
    impersonacionActiva: true
  });
  assert.equal(impersonada.puedeGestionarOverlays, false);
  await servicio.reconocer(contexto, salida.avisos[0].avisoId);
  assert.equal(cambios[0].estado, 'reconocido');
  await assert.rejects(
    servicio.ocultar({ ...contexto, impersonacionActiva: true }, salida.avisos[0].avisoId),
    /impersonada/u
  );
  await assert.rejects(servicio.obtenerResumen({ ...contexto, permisos: {} }), /permiso/u);
}

async function verificarScopePersistenciaYAuditoria() {
  const [repositorio, adaptador, rutas, manifiesto] = await Promise.all([
    leer('paquetes/avisos-plataforma/src/RepositorioPresentacionAvisosPlataformaSql.js'),
    leer('paquetes/avisos-plataforma/src/AdaptadorAuditoriaAvisosPlataforma.js'),
    leer('apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js')
  ]);
  assert.match(repositorio, /scope_tenant_id = \?/u);
  assert.match(repositorio, /scope_empresa_id = \?/u);
  assert.match(repositorio, /scope_sitio_id = \?/u);
  assert.match(repositorio, /estado_ciclo = 'pendiente'/u);
  assert.match(repositorio, /o\.estado <> 'oculto'/u);
  assert.match(repositorio, /COUNT\(\*\) AS total/u);
  assert.match(repositorio, /SUM\(o\.estado IS NULL\)/u);
  assert.match(repositorio, /rf\.nombre_remoto_declarado/u);
  assert.match(adaptador, /plataforma\.aviso_reconocido/u);
  assert.match(adaptador, /plataforma\.aviso_ocultado/u);
  const intenciones = [];
  const adaptadorReal = new AdaptadorAuditoriaAvisosPlataforma({
    repositorioAuditoria: {
      async incorporarEnTransaccion(entradas) {
        intenciones.push(...entradas);
        return { eventos: [{ estado: 'incorporado' }] };
      }
    }
  });
  for (const [estado, eventoId] of [
    ['reconocido', '01987f20-5678-7abc-8abc-1234567890ab'],
    ['oculto', '01987f20-5679-7abc-8abc-1234567890ab']
  ]) {
    await adaptadorReal.registrarOverlayEnTransaccion({
      avisoId: '01987f20-1234-7abc-8abc-1234567890ab',
      causaCodigo: 'estado_remoto_vencido',
      estado,
      eventoId,
      scope: { tenantId: null, empresaId: null, sitioId: null },
      contextoUsuarioActual: { idUsuario: 7 }
    }, { conexion: { execute() {} } });
  }
  assert.equal(intenciones.length, 2);
  for (const intencion of intenciones) {
    const definicion = obtenerDefinicionTipoEventoAuditoria(intencion.tipo);
    assert.ok(definicion.emisionesPermitidas.some((emision) =>
      emision.actor === intencion.actorReal.tipo &&
      emision.origen === intencion.origen &&
      emision.productor === intencion.productor
    ), 'El overlay debe usar una frontera de emisión admitida por el catálogo.');
    assert.doesNotThrow(() => validarPayloadAuditoriaV1({
      tipo: intencion.tipo,
      perfil: 'aviso_plataforma_v1', actor: 'usuario', origen: 'web',
      payload: intencion.payload
    }));
  }
  assert.equal(intenciones[0].payload.operacion, 'reconocido');
  assert.equal(intenciones[1].payload.operacion, 'ocultado');
  assert.match(rutas, /ver_avisos_plataforma/u);
  assert.match(manifiesto, /avisos-plataforma\/api\/:avisoId\/reconocer/u);
  assert.match(manifiesto, /avisos-plataforma\/api\/:avisoId\/ocultar/u);
}

async function verificarTopBarYTiempoReal() {
  const [cabecera, portal, panel, css, difusor, observador, index] = await Promise.all([
    leer('apps/sentinelia-web/src/views/parciales/cabecera.ejs'),
    leer('apps/sentinelia-web/src/public/js/portal.js'),
    leer('apps/sentinelia-web/src/public/js/panel-dashboard.js'),
    leer('apps/sentinelia-web/src/public/css/portal.css'),
    leer('apps/sentinelia-web/src/realtime/DifusorWebSocketPortal.js'),
    leer('apps/sentinelia-web/src/realtime/ObservadorAvisosPlataformaSql.js'),
    leer('apps/sentinelia-web/src/index.js')
  ]);
  assert.match(cabecera, /permisos\?\.verAvisosPlataforma/u);
  assert.match(cabecera, /data-avisos-plataforma-contador/u);
  for (const gravedad of ['informativa', 'advertencia', 'critica']) {
    assert.match(css, new RegExp(`data-gravedad="${gravedad}"`, 'u'));
  }
  assert.match(portal, /avisos_plataforma_actualizados/u);
  assert.match(portal, /portal:avisos-plataforma-actualizados/u);
  assert.match(panel, /portal:avisos-plataforma-actualizados/u);
  assert.match(portal, /Reconocer/u);
  assert.match(portal, /Ocultar/u);
  assert.match(portal, /totalActivosVisibles/u);
  assert.match(portal, /puedeGestionarOverlays/u);
  assert.match(portal, /Solo lectura en modo de verificación/u);
  assert.match(portal, /Instalación remota/u);
  assert.match(portal, /Identidad de instalación/u);
  assert.match(portal, /Primera detección/u);
  assert.match(portal, /Última detección/u);
  assert.match(portal, /Detalle técnico/u);
  assert.match(difusor, /tipo: 'avisos_plataforma_actualizados'/u);
  const metodo = difusor.slice(difusor.indexOf('emitirAvisosPlataformaActualizados()'));
  assert.doesNotMatch(metodo.slice(0, metodo.indexOf('\n  sincronizarVencimiento')), /avisoId|gravedad|contador/u);
  assert.match(observador, /obtenerFirmaGlobal/u);
  assert.match(index, /observadorAvisosPlataformaSql\.arrancar/u);
}

function leer(relativa) {
  return readFile(new URL(relativa, raiz), 'utf8');
}
