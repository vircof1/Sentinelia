import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO,
  ORDENES_BLOQUEO_TRIGGER_CORREO
} from '../paquetes/correo/src/ContratoTriggerCorreo.js';
import { RepositorioFotografiaAdmisionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioFotografiaAdmisionTriggerCorreoSql.js';
import { ServicioFotografiaAdmisionTriggerCorreo }
  from '../paquetes/correo/src/ServicioFotografiaAdmisionTriggerCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { prepararEntorno } from './correo-verificar-trigger-5-27-6c.js';

const PLAN = Object.freeze({
  eventoDisparo: 'apertura_alerta',
  triggerId: 41,
  asignacionId: 51,
  monitorId: 31,
  tipoTrigger: 'correo',
  transicion: Object.freeze({
    tipoEventoDisparo: 'apertura_alerta',
    alertaAuditoriaId: '0199a9f0-7b5c-7a55-b32a-111111111111',
    monitorId: 31,
    tenantId: 9,
    empresaId: null,
    sitioId: null,
    tipoMonitor: 'ping',
    nombreMonitor: 'Monitor coherente',
    fechaOcurrenciaUtc: '2026-09-03T10:00:00.000Z',
    validoDesdeUtc: '2026-09-03T10:00:00.000Z',
    codigoResultado: 'timeout',
    mensajeResultado: 'Sin respuesta.',
    payloadAlerta: Object.freeze({
      descripcionFallo: 'El servicio no responde.',
      posibleSolucion: 'Comprueba la red.',
      stack: 'no debe proyectarse'
    })
  })
});

await main();

async function main() {
  verificarOrdenContractual();
  await verificarFotografiaCompleta();
  await verificarRechazosYReintento();
  await verificarSqlReal();
  console.log(
    '[correo-trigger] OK 5.27.8a: orden=configuracion_usuarios_trigger_' +
      'vinculo_audiencia fotografia=sql_coherente decisiones=cerradas ' +
      'audiencia=deduplicada contexto=allowlist carrera_usuario=reintento ' +
      'gate=sin_integracion_productiva'
  );
}

function verificarOrdenContractual() {
  assert.deepEqual(ORDENES_BLOQUEO_TRIGGER_CORREO.admision, [
    'configuracion_portal',
    'estado_verificacion_correo',
    'cabecera_configuracion_portal',
    'estado_despliegue_trigger_correo',
    'usuarios',
    'triggers',
    'asignaciones_triggers_monitores',
    'destinatarios_triggers_correo'
  ]);
}

async function verificarFotografiaCompleta() {
  const orden = [];
  const servicio = crearServicio({ orden });
  const decision = await servicio.fotografiarEnTransaccion({
    planDisparo: PLAN,
    conexion: conexionFalsa()
  });
  assert.deepEqual(orden, [
    'descubrimiento', 'configuracion', 'usuarios', 'trigger', 'vinculo',
    'audiencia'
  ]);
  assert.equal(decision.aceptada, true);
  assert.equal(decision.codigoResultado,
    CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_PARCIAL);
  assert.equal(decision.trigger.nombre, 'Trigger SQL autoritativo');
  assert.equal(decision.planDisparo.trigger.nombre, 'Trigger SQL autoritativo');
  assert.equal(decision.versionConfiguracion, '17');
  assert.equal(decision.origenPublico, 'https://sentinelia.example');
  assert.equal(decision.ttlDesuscripcionDias, 30);
  assert.equal(decision.audiencia.totalActivas, 3);
  assert.equal(decision.audiencia.totalEntregables, 2);
  assert.equal(decision.audiencia.totalBuzones, 1,
    'Manual y usuario con el mismo buzón producen una sola salida física.');
  assert.equal(JSON.stringify(decision).includes('no debe proyectarse'), false);
  assert.equal(Object.isFrozen(decision), true);
}

async function verificarRechazosYReintento() {
  const canal = crearServicio({ puedeDespachar: false });
  const sinCanal = await canal.fotografiarEnTransaccion({
    planDisparo: PLAN,
    conexion: conexionFalsa()
  });
  assert.equal(sinCanal.codigoResultado,
    CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.CANAL_NO_OPERATIVO);

  const vinculo = crearServicio({ asignacionActiva: false });
  const sinVinculo = await vinculo.fotografiarEnTransaccion({
    planDisparo: PLAN,
    conexion: conexionFalsa()
  });
  assert.equal(sinVinculo.codigoResultado,
    CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.DECLARACION_INVALIDA);

  const vacia = crearServicio({ audiencia: [] });
  const sinDestinos = await vacia.fotografiarEnTransaccion({
    planDisparo: PLAN,
    conexion: conexionFalsa()
  });
  assert.equal(sinDestinos.codigoResultado,
    CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.SIN_DESTINATARIOS_ADMITIDOS);

  const carrera = crearServicio({ usuarioFantasma: true });
  await assert.rejects(
    carrera.fotografiarEnTransaccion({
      planDisparo: PLAN,
      conexion: conexionFalsa()
    }),
    (error) => error?.codigo === 'fotografia_admision_correo_reintentar' &&
      error?.reintentable === true
  );
}

function crearServicio({
  orden = [],
  puedeDespachar = true,
  asignacionActiva = true,
  audiencia = audienciaFixture(),
  usuarioFantasma = false
} = {}) {
  const repositorio = {
    async descubrirUsuarios() { orden.push('descubrimiento'); return [71, 72]; },
    async bloquearUsuarios() {
      orden.push('usuarios');
      return [
        usuario(71, { activo: 1, email: 'equipo@example.test', validado: 1 }),
        usuario(72, { activo: 0, email: 'dormido@example.test', validado: 1 })
      ];
    },
    async bloquearTrigger() {
      orden.push('trigger');
      return {
        id: 41, nombre: 'Trigger SQL autoritativo', tipo: 'correo', activo: 1,
        revision_declaracion: 8, tenant_id: 9, empresa_id: null, sitio_id: null,
        configuracion: JSON.stringify({
          version: 1, asuntoPlantilla: 'Aviso {{monitor}}',
          textoIntroduccion: null, textoCierre: null
        })
      };
    },
    async bloquearAsignacion() {
      orden.push('vinculo');
      return {
        id: 51, monitor_id: 31, trigger_id: 41,
        activo: asignacionActiva ? 1 : 0, orden_ejecucion: 100,
        eventos_disparo: '["apertura_alerta","cierre_alerta"]',
        configuracion_override: null
      };
    },
    async bloquearAudiencia() {
      orden.push('audiencia');
      return usuarioFantasma
        ? [...audiencia, relacionUsuario(73)]
        : audiencia;
    }
  };
  const valores = new Map([
    ['portal.origen_publico', 'https://sentinelia.example'],
    ['portal.nombre_visible', 'Sentinelia'],
    ['correo.desuscripcion_ttl_dias', '30']
  ]);
  return new ServicioFotografiaAdmisionTriggerCorreo({
    repositorio,
    evaluadorAutoridadCorreoSql: {
      async evaluarEnTransaccion() {
        orden.push('configuracion');
        return {
          puedeDespachar,
          codigo: puedeDespachar ? 'correo_smtp_verificado' : 'correo_no_verificado',
          versionConfiguracion: '17',
          remitenteEmailCanonico: 'avisos@example.test',
          configuracion: { desuscripcionTtlDias: 30 },
          lectura: { valores }
        };
      }
    }
  });
}

function audienciaFixture() {
  return [
    {
      id: 61, trigger_id: 41, tipo: 'manual', usuario_id: null,
      email_manual: 'equipo@example.test',
      email_manual_canonico: 'equipo@example.test',
      normalizacion_buzon_version: 'buzon@1', estado_participacion: 'activa'
    },
    relacionUsuario(71),
    relacionUsuario(72)
  ];
}

function relacionUsuario(usuarioId) {
  return {
    id: usuarioId - 9, trigger_id: 41, tipo: 'usuario', usuario_id: usuarioId,
    email_manual: null, email_manual_canonico: null,
    normalizacion_buzon_version: 'buzon@1', estado_participacion: 'activa'
  };
}

function usuario(id, { activo, email, validado }) {
  return {
    id, usuario: `usuario-${id}`, nombre_mostrar: null, nombre_completo: null,
    activo, email, email_validado: validado,
    tenant_id: 9, empresa_id: null, sitio_id: null
  };
}

async function verificarSqlReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.8a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5278a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await prepararEntorno(sql);
    const [fila] = await sql.consultar(`
      SELECT t.id AS trigger_id,t.nombre AS trigger_nombre,
             a.id AS asignacion_id,a.monitor_id,m.nombre AS monitor_nombre,
             m.tipo AS monitor_tipo,m.tenant_id,m.empresa_id,m.sitio_id
        FROM triggers t
        JOIN asignaciones_triggers_monitores a ON a.trigger_id=t.id
        JOIN monitores m ON m.id=a.monitor_id
       LIMIT 1
    `);
    await sql.ejecutar('UPDATE triggers SET activo=1 WHERE id=?', [fila.trigger_id]);
    await sql.ejecutar(`
      INSERT INTO destinatarios_triggers_correo (
        trigger_id,tipo,email_manual,email_manual_canonico,nombre_manual
      ) VALUES (?,'manual','sql@example.test','sql@example.test','SQL')
    `, [fila.trigger_id]);
    const plan = {
      ...PLAN,
      triggerId: Number(fila.trigger_id),
      asignacionId: Number(fila.asignacion_id),
      monitorId: Number(fila.monitor_id),
      transicion: {
        ...PLAN.transicion,
        monitorId: Number(fila.monitor_id),
        tenantId: Number(fila.tenant_id),
        empresaId: fila.empresa_id == null ? null : Number(fila.empresa_id),
        sitioId: fila.sitio_id == null ? null : Number(fila.sitio_id),
        nombreMonitor: fila.monitor_nombre,
        tipoMonitor: fila.monitor_tipo
      }
    };
    const valores = new Map([
      ['portal.origen_publico', 'https://sentinelia.example'],
      ['portal.nombre_visible', 'Sentinelia']
    ]);
    const servicio = new ServicioFotografiaAdmisionTriggerCorreo({
      repositorio: new RepositorioFotografiaAdmisionTriggerCorreoSql(),
      evaluadorAutoridadCorreoSql: {
        async evaluarEnTransaccion({ conexion }) {
          await conexion.execute(
            'SELECT clave FROM configuracion_portal ORDER BY clave LOCK IN SHARE MODE'
          );
          await conexion.execute(
            'SELECT id FROM estado_verificacion_correo WHERE id=1 LOCK IN SHARE MODE'
          );
          await conexion.execute(
            'SELECT id FROM cabecera_configuracion_portal WHERE id=1 LOCK IN SHARE MODE'
          );
          return {
            puedeDespachar: true,
            codigo: 'fixture_smtp_verificado',
            versionConfiguracion: '1',
            remitenteEmailCanonico: 'avisos@example.test',
            configuracion: { desuscripcionTtlDias: 30 },
            lectura: { valores }
          };
        }
      }
    });
    const conexion = await sql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const decision = await servicio.fotografiarEnTransaccion({
        planDisparo: plan,
        conexion
      });
      assert.equal(decision.aceptada, true, JSON.stringify(decision));
      assert.equal(decision.audiencia.totalBuzones, 1);
      assert.equal(decision.trigger.nombre, fila.trigger_nombre);
      await conexion.rollback();
    } finally {
      conexion.release();
    }
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function conexionFalsa() {
  return { async execute() { throw new Error('El puerto falso no ejecuta SQL.'); } };
}
