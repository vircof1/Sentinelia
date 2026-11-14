import assert from 'node:assert/strict';
import { EjecutorTriggerDns } from '../paquetes/triggers/src/EjecutorTriggerDns.js';
import { RegistroDns } from '../paquetes/dns/src/RegistroDns.js';
import { ZonaDns } from '../paquetes/dns/src/ZonaDns.js';
import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

async function main() {
  await verificarMutacionDnsAuditable();
  await verificarNoopSinAuditoriaNiInvalidacion();

  console.log(
    '[dns] OK 5.21.11c: trigger_dns=mutacion_auditable causalidad=ejecucion_trigger noop=sin_duplicado payload=sin_tecnico'
  );
}

async function verificarMutacionDnsAuditable() {
  const entorno = crearEntorno();

  const resultado = await entorno.ejecutor.ejecutar({
    ejecucionTriggerId: 900,
    planDisparo: {
      trigger: triggerFixture(),
      triggerId: 50,
      monitorId: 40
    },
    configuracionEfectiva: {
      zonaId: 10,
      registroId: 20,
      operacion: 'editar_valor',
      valorPrincipal: '192.0.2.99',
      rolGobernanza: 'servicio_web'
    },
    eventoDisparo: 'apertura_alerta',
    transicion: { id: 700, tipo: 'apertura_alerta' }
  });

  assert.equal(resultado.estadoEjecucion, 'ok');
  assert.equal(resultado.codigoResultado, 'dns_ok');
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar-registro',
    'sql:marcar-pendiente-zona',
    'audit:dns.registro_actualizado:principal',
    'commit',
    'release',
    'redis:invalidar-dns'
  ]);

  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'dns.registro_actualizado');
  assert.equal(evento.actor, 'runtime');
  assert.deepEqual(evento.actorReal, {
    tipo: 'runtime',
    id: 'sentinelia-runtime'
  });
  assert.deepEqual(evento.causalidad, {
    tipo: 'ejecucion_trigger',
    id: '900'
  });
  assert.equal(evento.productor, 'runtime_automatizacion');
  assert.equal(evento.claveOperacion, 'ejecucion-trigger:900:dns-registro:20');
  assert.deepEqual(evento.payload, {
    resultado: 'actualizado',
    camposCambiados: ['valorPrincipal'],
    antes: { valorPrincipal: '192.0.2.10' },
    despues: { valorPrincipal: '192.0.2.99' }
  });
  assertSinPayloadTecnico(evento);
}

async function verificarNoopSinAuditoriaNiInvalidacion() {
  const entorno = crearEntorno({
    valorPrincipal: '192.0.2.99'
  });

  const resultado = await entorno.ejecutor.ejecutar({
    ejecucionTriggerId: 901,
    planDisparo: {
      trigger: triggerFixture(),
      triggerId: 50,
      monitorId: 40
    },
    configuracionEfectiva: {
      zonaId: 10,
      registroId: 20,
      operacion: 'editar_valor',
      valorPrincipal: '192.0.2.99',
      rolGobernanza: 'servicio_web'
    },
    eventoDisparo: 'apertura_alerta',
    transicion: { id: 701, tipo: 'apertura_alerta' }
  });

  assert.equal(resultado.estadoEjecucion, 'ok');
  assert.equal(resultado.codigoResultado, 'dns_sin_cambios');
  assert.deepEqual(entorno.traza, []);
  assert.equal(entorno.auditoria.eventos.length, 0);
}

function crearEntorno({ valorPrincipal = '192.0.2.10' } = {}) {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }, { conexion } = {}) {
      assert.ok(conexion);
      validarEventoAuditableV1(intencion);
      traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    }
  };
  const estado = {
    registro: registroFixture({ valorPrincipal })
  };
  const conexion = {
    async beginTransaction() {
      traza.push('begin');
    },
    async commit() {
      traza.push('commit');
    },
    async rollback() {
      traza.push('rollback');
    },
    release() {
      traza.push('release');
    }
  };
  const repositorioRegistrosDns = {
    clienteSql: {
      async obtenerConexion() {
        return conexion;
      }
    },
    async buscarPorId(idRegistro) {
      assert.equal(Number(idRegistro), 20);
      return estado.registro;
    },
    async listarPorZonaId(idZona) {
      assert.equal(Number(idZona), 10);
      return [estado.registro];
    },
    async actualizar({ idRegistro, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      assert.equal(Number(idRegistro), 20);
      traza.push('sql:actualizar-registro');
      estado.registro = registroFixture({
        id: idRegistro,
        ...definicion
      });
      return estado.registro;
    }
  };
  const repositorioZonasDns = {
    async buscarPorId(idZona) {
      assert.equal(Number(idZona), 10);
      return zonaFixture();
    },
    async marcarPendientePublicacion(idZona, { conexion } = {}) {
      assert.ok(conexion);
      assert.equal(Number(idZona), 10);
      traza.push('sql:marcar-pendiente-zona');
      return 1;
    }
  };

  return {
    traza,
    auditoria,
    ejecutor: new EjecutorTriggerDns({
      repositorioRegistrosDns,
      repositorioZonasDns,
      servicioDns: {
        async invalidarCatalogoDns() {
          traza.push('redis:invalidar-dns');
        }
      },
      servicioAuditoria: auditoria,
      validadorCoherenciaBindDns: {
        validarCoherenciaZona({ zona, registros }) {
          assert.equal(zona.nombreZona, 'example.test');
          assert.equal(registros.length, 1);
        }
      },
      ahora: () => new Date('2026-07-25T12:00:00.000Z')
    })
  };
}

function triggerFixture() {
  return {
    id: 50,
    tenantId: 1,
    empresaId: 2,
    sitioId: null,
    nivelPertenencia: 'empresa'
  };
}

function zonaFixture() {
  return new ZonaDns({
    id: 10,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: null,
    nombre_zona: 'example.test',
    tipo_zona: 'master',
    categoria_origen: 'normal',
    publicar_en_bind: 1,
    ttl_defecto_segundos: 3600,
    soa_mname: 'ns1.example.test',
    soa_rname: 'hostmaster.example.test',
    soa_serial: 1,
    soa_refresh_segundos: 3600,
    soa_retry_segundos: 600,
    soa_expire_segundos: 1209600,
    soa_minimum_segundos: 300,
    estado_publicacion: 'pendiente',
    activo: 1
  });
}

function registroFixture(datos = {}) {
  return new RegistroDns({
    id: 20,
    zona_id: 10,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: null,
    nombre_zona: 'example.test',
    host_relativo: 'www',
    tipo_registro: 'A',
    valor_principal: '192.0.2.10',
    ttl_segundos: 300,
    categoria_origen: 'trigger',
    publicar_en_bind: 1,
    datos_auxiliares: JSON.stringify({
      gobernadoPor: 'trigger',
      modoControl: 'valor_y_activo',
      rolAsignado: 'servicio_web'
    }),
    descripcion: null,
    activo: 1,
    ...aFilaRegistro(datos)
  });
}

function aFilaRegistro(datos) {
  return limpiarIndefinidos({
    id: datos.id,
    zona_id: datos.zonaId,
    tenant_id: datos.tenantId,
    empresa_id: datos.empresaId,
    sitio_id: datos.sitioId,
    host_relativo: datos.hostRelativo,
    tipo_registro: datos.tipoRegistro,
    valor_principal: datos.valorPrincipal,
    ttl_segundos: datos.ttlSegundos,
    prioridad: datos.prioridad,
    peso: datos.peso,
    puerto: datos.puerto,
    flags: datos.flags,
    tag: datos.tag,
    categoria_origen: datos.categoriaOrigen,
    publicar_en_bind: datos.publicarEnBind,
    datos_auxiliares: datos.datosAuxiliares == null
      ? undefined
      : JSON.stringify(datos.datosAuxiliares),
    descripcion: datos.descripcion,
    activo: datos.activo
  });
}

function limpiarIndefinidos(objeto) {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, valor]) => valor !== undefined)
  );
}

function assertSinPayloadTecnico(evento) {
  const serializado = JSON.stringify(evento);
  for (const prohibido of [
    'payloadSolicitud',
    'payloadRespuesta',
    'payloadError',
    'mensajeResultado',
    'codigoResultado',
    'stack'
  ]) {
    assert.equal(
      serializado.includes(prohibido),
      false,
      `El evento auditable no debe copiar ${prohibido}.`
    );
  }
}

main().catch((error) => {
  console.error('[dns] Error verificando mutación DNS auditable por trigger 5.21.11c');
  console.error(error);
  process.exit(1);
});
