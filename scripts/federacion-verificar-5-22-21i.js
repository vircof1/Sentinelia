import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import { generarUuidV7Auditoria, uuidV7AuditoriaABytes }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioIntercambioConcesionFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioIntercambioConcesionFederacionSql.js';
import { RepositorioRelacionesFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioRelacionesFederacionSql.js';
import { FuenteEntropiaCriptograficaNode }
  from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { ServicioSincronizacionConcesionFederacionPortal }
  from '../paquetes/federacion/aplicacion/ServicioSincronizacionConcesionFederacionPortal.js';
import { canonicalizarJsonFederacion }
  from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import { VERSION_PROTOCOLO_FEDERACION }
  from '../paquetes/federacion/src/CatalogosFederacion.js';
import {
  PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION
} from '../paquetes/federacion/src/IntercambioDeclaracionConcesionFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await verificarRepresentacionProductiva();
await verificarSincronizacionBilateral();
await verificarSalidaDurable();
console.log(
  '[federacion] OK 5.22.21i: login=csrf_publico ' +
  'portal=negociacion+activacion+flujos_reales canal=emisor_sin_inversa ' +
  'secretos=no_expuestos'
);

async function verificarRepresentacionProductiva() {
  const [login, cambioPassword, css, rutas, vista, servicio, repositorio, index,
    openapi, manifiesto] = await Promise.all([
    leer('../apps/sentinelia-web/src/views/login.ejs'),
    leer('../apps/sentinelia-web/src/views/cambio-password-obligatorio.ejs'),
    leer('../apps/sentinelia-web/src/public/css/portal.css'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/views/portal/federacion.ejs'),
    leer('../paquetes/federacion/aplicacion/ServicioAdministracionFederacionPortal.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioRelacionesFederacionSql.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js')
  ]);
  assert.match(login, /name="_csrf" value="<%= tokenCSRFPortal %>"/u);
  assert.match(cambioPassword, /name="_csrf" value="<%= tokenCSRFPortal %>"/u);
  verificarTemaCambioPassword(css);
  assert.match(rutas, /post\(\s*'\/login',\s*validarCsrfPortal/u);
  assert.match(rutas, /concesion\/sincronizar[\s\S]*requerirConfigurarEmisionesFederacion/u);
  assert.doesNotMatch(servicio, /planoDatos:\s*'bloqueado'/u);
  assert.match(servicio, /guardiaActivacion\.estaActiva/u);
  assert.match(repositorio, /FROM flujos_federacion f/u);
  assert.match(repositorio, /cortes_iniciales_generaciones_federacion/u);
  assert.match(vista, /Declaración remota conocida/u);
  assert.match(vista, /Concesión efectiva/u);
  assert.match(vista, /Flujos reconciliados/u);
  assert.match(vista, /Bloqueos actuales/u);
  assert.match(vista, /Sincronizar negociación bilateral/u);
  assert.match(
    vista,
    /data-fecha-utc="<%= previewConcesion\.presentacion\.expiraEnUtc %>"/u
  );
  assert.match(
    vista,
    /data-fecha-utc="<%= relacion\.salud\.ultimoHeartbeatUtc %>"/u
  );
  assert.match(
    vista,
    /data-fecha-utc="<%= conflicto\.ultimaDeteccionEnUtc %>"/u
  );
  assert.doesNotMatch(vista, /plano de datos permanece bloqueado/iu);
  assert.match(index, /new ServicioSincronizacionConcesionFederacionPortal/u);
  assert.match(openapi, /FederationConcessionDeclarationPublicationResult/u);
  assert.match(manifiesto, /concesion\/sincronizar/u);
  ejs.compile(vista, {
    filename: new URL(
      '../apps/sentinelia-web/src/views/portal/federacion.ejs',
      import.meta.url
    ).pathname
  });
}

function verificarTemaCambioPassword(css) {
  const inicio = css.indexOf('.caja-acceso--cambio-password');
  const fin = css.indexOf('.texto-ayuda-acceso', inicio);
  const estilos = css.slice(inicio, fin);

  assert.ok(inicio >= 0 && fin > inicio, 'Faltan los estilos del cambio obligatorio de contraseña.');
  for (const marca of [
    'linear-gradient(180deg, var(--superficie) 0%, var(--superficie-2) 100%)',
    'var(--estado-advertencia)',
    'color-mix(in srgb, var(--estado-positivo)',
    'background: var(--superficie-2)'
  ]) {
    assert.ok(estilos.includes(marca), `El cambio obligatorio no adapta al tema: ${marca}.`);
  }
  assert.doesNotMatch(estilos, /#fff(?:fff|8eb)|#fbfdfc|#f7fbf9|#9cb9b1/iu);
}

async function verificarSincronizacionBilateral() {
  const ids = {
    local: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    remota: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    relacion: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    oferta: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    aceptacion: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
  };
  const seleccion = {
    activa: true,
    nivelesScope: ['empresa'],
    familias: {
      monitores: {
        campos: ['monitores'],
        permiteContenidoSensible: false,
        permiteRefederacion: true
      }
    }
  };
  const oferta = declaracion({
    ids,
    emisora: ids.local,
    receptora: ids.remota,
    papel: 'oferta',
    revisionId: ids.oferta,
    seleccion
  });
  const aceptacion = declaracion({
    ids,
    emisora: ids.remota,
    receptora: ids.local,
    papel: 'aceptacion',
    revisionId: ids.aceptacion,
    seleccion
  });
  const secreto = `sfr1_${'S'.repeat(64)}`;
  const token = `sfop1_${'T'.repeat(64)}`;
  const llamadas = {
    confirmacion: null,
    recepcion: null,
    consolidacion: null,
    sesiones: 0,
    rechazosSesion: 1,
    manifiestos: [],
    manifiestosConfirmados: []
  };
  const activacion = { activa: true, consultas: 0 };
  const servicio = new ServicioSincronizacionConcesionFederacionPortal({
    repositorioIntercambios: {
      async prepararSalida() { return oferta; },
      async confirmarSalida(entrada) { llamadas.confirmacion = entrada; },
      async recibir(entrada) {
        llamadas.recepcion = entrada;
        return { estado: 'persistida' };
      }
    },
    repositorioDestinos: {
      async obtenerAprobadoOperativo() {
        return {
          relacionId: ids.relacion,
          installationRemotaId: ids.remota,
          endpoint: 'https://receptora.example.test'
        };
      }
    },
    custodiaSecretoEmision: {
      async obtenerParaLoginTecnico() { return secreto; }
    },
    clienteHttp: {
      async iniciarSesion({ solicitud }) {
        llamadas.sesiones += 1;
        assert.equal(solicitud.secretoPersistente, secreto);
        assert.equal(solicitud.nombreEmisorDeclarado, 'Emisora portal');
        return {
          ok: true,
          requestId: solicitud.loginRequestId,
          sesion: { sessionId: generarUuidV7Auditoria(), token }
        };
      },
      async publicarDeclaracionConcesion({ token: observado, declaracion: publicada }) {
        assert.equal(observado, token);
        assert.deepEqual(publicada, oferta);
        return {
          ok: true,
          intercambioId: oferta.intercambioId,
          relacionId: ids.relacion,
          revisionId: ids.oferta,
          estado: 'persistida',
          confirmacionId: generarUuidV7Auditoria(),
          recibidaEnUtc: new Date().toISOString(),
          huellaSeleccion: createHash('sha256')
            .update(canonicalizarJsonFederacion(seleccion)).digest('hex'),
          declaracionLocal: aceptacion
        };
      },
      async publicarManifiestoFlujoInicial({ token: observado, manifiesto }) {
        assert.equal(observado, token);
        if (llamadas.rechazosSesion > 0) {
          llamadas.rechazosSesion -= 1;
          const error = new Error('sesión sustituida');
          error.codigoRemoto = 'SESION_FEDERADA_NO_VIVA';
          throw error;
        }
        llamadas.manifiestos.push(manifiesto);
        return { estado: 'reconciliada' };
      }
    },
    servicioConsolidacion: {
      async consolidarRelacion(entrada) { llamadas.consolidacion = entrada; }
    },
    servicioReconciliacion: {
      async listarManifiestosPreparados() {
        return { manifiestos: [{ familia: 'monitores', flujoId: 'flujo-fixture' }] };
      },
      async confirmarManifiestoPublicado({ manifiesto }) {
        llamadas.manifiestosConfirmados.push(manifiesto);
      }
    },
    guardiaActivacion: {
      async exigirActiva() {
        activacion.consultas += 1;
        if (!activacion.activa) throw new Error('desactivada');
      }
    },
    installationLocalId: ids.local,
    bootLocalId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    resolverNombreLocal: async () => 'Emisora portal'
  });
  const resultado = await servicio.sincronizar({ relacionId: ids.relacion });
  assert.equal(resultado.revisionContraparteId, ids.aceptacion);
  assert.equal(llamadas.confirmacion.declaracion.revisionId, ids.oferta);
  assert.equal(llamadas.recepcion.declaracion.revisionId, ids.aceptacion);
  assert.equal(llamadas.consolidacion.actor.real.id, ids.remota);
  assert.equal(llamadas.manifiestos.length, 1);
  assert.deepEqual(llamadas.manifiestosConfirmados, llamadas.manifiestos);
  assert.equal(llamadas.sesiones, 3,
    'La consolidación o el runtime pueden sustituir la sesión antes del manifiesto.');
  assert.equal(resultado.manifiestosPublicados, 1);
  assert.equal(JSON.stringify(resultado).includes(secreto), false);
  assert.equal(JSON.stringify(resultado).includes(token), false);
  activacion.activa = false;
  await assert.rejects(
    servicio.sincronizar({ relacionId: ids.relacion }),
    /desactivada/u
  );
  assert.equal(activacion.consultas, 2);
}

async function verificarSalidaDurable() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.22.21i necesita SQL para verificar la salida durable real.');
  const baseDatos = `sentinelia_fixture_52221i_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const ids = {
      local: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      remota: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      relacion: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
      revision: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
    };
    const usuario = 5_222_109;
    const seleccion = {
      activa: true,
      nivelesScope: ['empresa'],
      familias: {
        monitores: {
          campos: ['monitores'],
          permiteContenidoSensible: false,
          permiteRefederacion: false
        }
      }
    };
    await sql.ejecutar(
      `INSERT INTO usuarios (id,usuario,email,hash_password,activo,
        permiso_configurar_emisiones_federacion)
       VALUES (?, ?, ?, 'fixture-no-login', 1, 1)`,
      [usuario, `fixture-fed-${usuario}`, `fixture-fed-${usuario}@invalid.local`]
    );
    await sql.ejecutar(
      `INSERT INTO relaciones_federacion (
        relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
        estado_compatibilidad,installation_remota_candidata_id,
        installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
        responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
        scope_sitio_id,version_autoridad,corte_autoridad_utc,
        creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
      ) VALUES (?, 'emision', 'vinculada', 'autorizada', 'valida', 'compatible',
        ?, ?, 'remota 21i', ?, ?, NULL, NULL, NULL, 1, NULL, ?,
        UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)`,
      [ids.relacion, ids.remota, ids.remota, usuario, usuario, usuario]
    );
    const canonica = canonicalizarJsonFederacion(seleccion);
    await sql.ejecutar(
      `INSERT INTO revisiones_concesion_federacion (
        revision_id,relacion_id,papel,procedencia,ordinal,estado,
        revision_oferta_id,revision_aceptacion_id,seleccion,huella_seleccion,
        autorizada_por_usuario_id,version_autoridad,version_autoridad_remota,
        creada_en_utc,vigente_desde_utc,evento_auditoria_id,correlacion_id
      ) VALUES (?, ?, 'oferta', 'local', 1, 'vigente', NULL, NULL, ?, ?, ?, 1,
        NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?, ?)`,
      [ids.revision, ids.relacion, canonica,
        createHash('sha256').update(canonica).digest(), usuario,
        uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
        uuidV7AuditoriaABytes(generarUuidV7Auditoria())]
    );
    await sql.ejecutar(
      `INSERT INTO estado_concesion_relaciones_federacion (
        relacion_id,revision_oferta_actual_id,revision,actualizada_en_utc
      ) VALUES (?, ?, 1, UTC_TIMESTAMP(3))`,
      [ids.relacion, ids.revision]
    );
    const relaciones = await new RepositorioRelacionesFederacionSql(sql, {
      adaptadorAuditoria: { async registrarEnTransaccion() {} }
    }).listarVisibles({
      scope: { tenantId: null, empresaId: null, sitioId: null }
    });
    assert.equal(relaciones[0].flujos.length, 0);
    assert.ok(relaciones[0].bloqueos.includes('concesion:declaracionRemotaPendiente'));
    assert.ok(relaciones[0].bloqueos.includes('concesion:efectivaPendiente'));
    const repositorio = new RepositorioIntercambioConcesionFederacionSql(sql);
    const primera = await repositorio.prepararSalida({
      relacionId: ids.relacion,
      installationLocalId: ids.local,
      intercambioId: generarUuidV7Auditoria()
    });
    const repetida = await repositorio.prepararSalida({
      relacionId: ids.relacion,
      installationLocalId: ids.local,
      intercambioId: generarUuidV7Auditoria()
    });
    assert.equal(repetida.intercambioId, primera.intercambioId,
      'Reintentar una revisión debe reutilizar su intercambio durable.');
    assert.equal(Object.hasOwn(primera, 'huellaSeleccion'), false,
      'La envolvente transportable debe conservar claves exactas.');
    const confirmacion = {
      ok: true,
      intercambioId: primera.intercambioId,
      relacionId: ids.relacion,
      revisionId: ids.revision,
      estado: 'persistida',
      confirmacionId: generarUuidV7Auditoria(),
      recibidaEnUtc: new Date().toISOString(),
      huellaSeleccion: createHash('sha256').update(canonica).digest('hex')
    };
    await repositorio.confirmarSalida({ declaracion: primera, confirmacion });
    await repositorio.confirmarSalida({ declaracion: primera, confirmacion });
    const [conteo] = await sql.consultar(
      `SELECT COUNT(*) AS total,MAX(estado) AS estado
         FROM intercambios_declaraciones_concesion_federacion
        WHERE direccion='saliente' AND relacion_id=?`,
      [ids.relacion]
    );
    assert.deepEqual([Number(conteo.total), conteo.estado], [1, 'confirmada']);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function declaracion({ ids, emisora, receptora, papel, revisionId, seleccion }) {
  return Object.freeze({
    perfil: PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION,
    protocoloVersion: VERSION_PROTOCOLO_FEDERACION,
    intercambioId: generarUuidV7Auditoria(),
    relacionId: ids.relacion,
    installationEmisoraId: emisora,
    installationReceptoraId: receptora,
    papel,
    revisionId,
    revisionOrdinal: '1',
    versionAutoridad: '1',
    seleccion,
    emitidaEnUtc: new Date().toISOString()
  });
}

function id(tipo) {
  return String(generador.generar(tipo));
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
