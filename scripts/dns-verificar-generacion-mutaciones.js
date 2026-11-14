import assert from 'node:assert/strict';
import { ServicioAdministracionDnsPortal } from '../apps/sentinelia-web/src/servicios/ServicioAdministracionDnsPortal.js';
import { EjecutorTriggerDns } from '../paquetes/triggers/src/EjecutorTriggerDns.js';
import { ZonaDns } from '../paquetes/dns/src/ZonaDns.js';
import { RegistroDns } from '../paquetes/dns/src/RegistroDns.js';
import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

async function main() {
  await verificarCrudPublicableCreaGeneracion();
  await verificarNoopNoCreaGeneracion();
  await verificarTriggerPublicableCreaGeneracion();

  console.log(
    '[dns] OK 5.21.11d: mutaciones=generacion_transaccional noop=sin_generacion trigger=integrado sucesion=ultima_pendiente'
  );
}

async function verificarCrudPublicableCreaGeneracion() {
  const entorno = crearEntornoAdministracion();

  await entorno.servicio.crearRegistro(contextoPortal(), 10, datosRegistro({
    hostRelativo: 'api',
    valorPrincipal: '192.0.2.20'
  }));

  await entorno.servicio.actualizarRegistro(contextoPortal(), 10, 20, datosRegistro({
    hostRelativo: 'api',
    valorPrincipal: '192.0.2.30'
  }));

  assert.deepEqual(entorno.traza, [
    'begin',
    'gen:1:pendiente',
    'sql:crear-registro:A',
    'sql:marcar-pendiente-zona',
    'audit:dns.registro_creado:principal',
    'commit',
    'redis:invalidar-dns',
    'begin',
    'gen:1:superada',
    'gen:2:pendiente',
    'sql:actualizar-registro',
    'sql:marcar-pendiente-zona',
    'audit:dns.registro_actualizado:principal',
    'commit',
    'redis:invalidar-dns'
  ]);
  assert.deepEqual(entorno.coordinacion.operaciones, [
    { generacionDns: '1', estado: 'superada' },
    { generacionDns: '2', estado: 'pendiente' }
  ]);
}

async function verificarNoopNoCreaGeneracion() {
  const entorno = crearEntornoAdministracion();
  entorno.registros.set(20, registroFixture({ id: 20 }));

  await entorno.servicio.actualizarRegistro(contextoPortal(), 10, 20, datosRegistro());

  assert.deepEqual(entorno.traza, []);
  assert.deepEqual(entorno.coordinacion.operaciones, []);
}

async function verificarTriggerPublicableCreaGeneracion() {
  const entorno = crearEntornoTrigger();

  const resultado = await entorno.ejecutor.ejecutar({
    ejecucionTriggerId: 900,
    planDisparo: {
      trigger: {
        id: 50,
        tenantId: 1,
        empresaId: 2,
        sitioId: null,
        nivelPertenencia: 'empresa'
      }
    },
    configuracionEfectiva: {
      zonaId: 10,
      registroId: 20,
      operacion: 'editar_valor',
      valorPrincipal: '192.0.2.99',
      rolGobernanza: 'servicio_web'
    },
    eventoDisparo: 'apertura_alerta'
  });

  assert.equal(resultado.estadoEjecucion, 'ok');
  assert.deepEqual(entorno.traza, [
    'begin',
    'gen:1:pendiente',
    'sql:actualizar-registro',
    'sql:marcar-pendiente-zona',
    'audit:dns.registro_actualizado:principal',
    'commit',
    'release',
    'redis:invalidar-dns'
  ]);
  assert.deepEqual(entorno.coordinacion.operaciones, [
    { generacionDns: '1', estado: 'pendiente' }
  ]);
}

function crearEntornoAdministracion() {
  const traza = [];
  const auditoria = crearAuditoria(traza);
  const coordinacion = crearCoordinacion(traza);
  const zonas = new Map([[10, zonaFixture()]]);
  const registros = new Map();
  const repositorioZonasDns = {
    clienteSql: {
      async obtenerConexion() {
        throw new Error('La verificación debe usar frontera transaccional.');
      }
    },
    async buscarVisiblePorId(_contexto, id) {
      return zonas.get(Number(id)) || null;
    },
    async buscarPorNombreZona(nombreZona) {
      return [...zonas.values()]
        .find((zona) => zona.nombreZona === String(nombreZona).toLowerCase()) ||
        null;
    },
    async marcarPendientePublicacion(idZona, { conexion } = {}) {
      assert.ok(conexion);
      assert.equal(Number(idZona), 10);
      traza.push('sql:marcar-pendiente-zona');
      return 1;
    },
    async crear(definicion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:crear-zona');
      const zona = zonaFixture({ id: 10, ...definicion });
      zonas.set(10, zona);
      return zona;
    },
    async actualizar({ idZona, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:actualizar-zona');
      const zona = zonaFixture({ id: idZona, ...definicion });
      zonas.set(Number(idZona), zona);
      return zona;
    },
    async eliminar(idZona, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:eliminar-zona');
      return zonas.delete(Number(idZona));
    }
  };
  const repositorioRegistrosDns = {
    async buscarPorId(id) {
      return registros.get(Number(id)) || null;
    },
    async contarPorZonaId(idZona, { conexion } = {}) {
      assert.ok(conexion);
      return [...registros.values()]
        .filter((registro) => Number(registro.zonaId) === Number(idZona))
        .length;
    },
    async crear(definicion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`sql:crear-registro:${definicion.tipoRegistro}`);
      const registro = registroFixture({ id: 20, ...definicion });
      registros.set(20, registro);
      return registro;
    },
    async actualizar({ idRegistro, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:actualizar-registro');
      const registro = registroFixture({ id: idRegistro, ...definicion });
      registros.set(Number(idRegistro), registro);
      return registro;
    },
    async eliminar(idRegistro, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:eliminar-registro');
      return registros.delete(Number(idRegistro));
    },
    async sincronizarScopeDesdeZona() {
      return 0;
    }
  };
  const fronteraTransaccional = {
    async ejecutar(trabajo) {
      traza.push('begin');
      const resultado = await trabajo({ id: 'conexion-fake' });
      traza.push('commit');
      return resultado;
    }
  };

  return {
    traza,
    auditoria,
    coordinacion,
    zonas,
    registros,
    servicio: new ServicioAdministracionDnsPortal({
      repositorioZonasDns,
      repositorioRegistrosDns,
      repositorioTenants: { listarVisibles: async () => [{ id: 1 }] },
      repositorioEmpresas: {
        listarVisibles: async () => [{ id: 2, tenantId: 1 }]
      },
      repositorioSitios: { listarVisibles: async () => [] },
      resolutorScopeUsuario: null,
      servicioLecturaDnsPortal: null,
      servicioDns: {
        async invalidarCatalogoDns() {
          traza.push('redis:invalidar-dns');
        }
      },
      fronteraTransaccional,
      servicioAuditoria: auditoria,
      repositorioCoordinacionGeneracionesDns: coordinacion,
      ahora: () => new Date('2026-07-25T13:00:00.000Z')
    })
  };
}

function crearEntornoTrigger() {
  const traza = [];
  const auditoria = crearAuditoria(traza);
  const coordinacion = crearCoordinacion(traza);
  let registro = registroFixture({
    categoriaOrigen: 'trigger',
    datosAuxiliares: {
      gobernadoPor: 'trigger',
      modoControl: 'valor_y_activo',
      rolAsignado: 'servicio_web'
    }
  });
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
    async buscarPorId(id) {
      assert.equal(Number(id), 20);
      return registro;
    },
    async listarPorZonaId(idZona) {
      assert.equal(Number(idZona), 10);
      return [registro];
    },
    async actualizar({ idRegistro, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      assert.equal(Number(idRegistro), 20);
      traza.push('sql:actualizar-registro');
      registro = registroFixture({ id: idRegistro, ...definicion });
      return registro;
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
    coordinacion,
    ejecutor: new EjecutorTriggerDns({
      repositorioRegistrosDns,
      repositorioZonasDns,
      servicioDns: {
        async invalidarCatalogoDns() {
          traza.push('redis:invalidar-dns');
        }
      },
      servicioAuditoria: auditoria,
      repositorioCoordinacionGeneracionesDns: coordinacion,
      validadorCoherenciaBindDns: {
        validarCoherenciaZona() {}
      },
      ahora: () => new Date('2026-07-25T13:00:00.000Z')
    })
  };
}

function crearAuditoria(traza) {
  return {
    eventos: [],
    async registrarEnTransaccion({ intencion }, { conexion } = {}) {
      assert.ok(conexion);
      validarEventoAuditableV1(intencion);
      traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    },
    async registrarMovimientoEnTransaccion({ salida, entrada }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`audit-mov:${salida.tipo}/${entrada.tipo}`);
      this.eventos.push(salida, entrada);
      return { eventos: [salida, entrada], estado: 'incorporado' };
    }
  };
}

function crearCoordinacion(traza) {
  return {
    operaciones: [],
    async crearGeneracionPorMutacionEnTransaccion({ conexion } = {}) {
      assert.ok(conexion);
      for (const operacion of this.operaciones) {
        if (operacion.estado === 'pendiente') {
          operacion.estado = 'superada';
          traza.push(`gen:${operacion.generacionDns}:superada`);
        }
      }
      const generacionDns = String(this.operaciones.length + 1);
      this.operaciones.push({ generacionDns, estado: 'pendiente' });
      traza.push(`gen:${generacionDns}:pendiente`);
      return { generacionDns, estado: 'pendiente' };
    }
  };
}

function contextoPortal() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    nivelScope: 'portal',
    permisos: {
      editarDns: true,
      publicarDns: true,
      administrarDnsAvanzado: true
    }
  };
}

function datosRegistro(sobrescritura = {}) {
  return {
    hostRelativo: 'api',
    tipoRegistro: 'A',
    valorPrincipal: '192.0.2.10',
    ttlSegundos: '300',
    categoriaOrigen: 'normal',
    publicarEnBind: '1',
    descripcion: '',
    activo: '1',
    ...sobrescritura
  };
}

function zonaFixture(datos = {}) {
  return new ZonaDns({
    id: 10,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: null,
    nombre_zona: 'example.test',
    tipo_zona: 'master',
    categoria_origen: 'normal',
    publicar_en_bind: 1,
    descripcion: null,
    ttl_defecto_segundos: 3600,
    soa_mname: 'ns1.example.test',
    soa_rname: 'hostmaster.example.test',
    soa_serial: 1,
    soa_refresh_segundos: 3600,
    soa_retry_segundos: 600,
    soa_expire_segundos: 1209600,
    soa_minimum_segundos: 300,
    version_modelo: 1,
    estado_publicacion: 'pendiente',
    activo: 1,
    ...limpiarIndefinidos({
      id: datos.id,
      tenant_id: datos.tenantId,
      empresa_id: datos.empresaId,
      sitio_id: datos.sitioId,
      nombre_zona: datos.nombreZona,
      publicar_en_bind: datos.publicarEnBind,
      activo: datos.activo
    })
  });
}

function registroFixture(datos = {}) {
  const datosAuxiliares = Object.hasOwn(datos, 'datosAuxiliares')
    ? datos.datosAuxiliares
    : null;
  return new RegistroDns({
    id: 20,
    zona_id: 10,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: null,
    nombre_zona: 'example.test',
    host_relativo: 'api',
    tipo_registro: 'A',
    valor_principal: '192.0.2.10',
    ttl_segundos: 300,
    categoria_origen: 'normal',
    publicar_en_bind: 1,
    datos_auxiliares: datosAuxiliares == null ? null : JSON.stringify(datosAuxiliares),
    descripcion: null,
    activo: 1,
    ...limpiarIndefinidos({
      id: datos.id,
      zona_id: datos.zonaId,
      tenant_id: datos.tenantId,
      empresa_id: datos.empresaId,
      sitio_id: datos.sitioId,
      host_relativo: datos.hostRelativo,
      tipo_registro: datos.tipoRegistro,
      valor_principal: datos.valorPrincipal,
      ttl_segundos: datos.ttlSegundos,
      categoria_origen: datos.categoriaOrigen,
      publicar_en_bind: datos.publicarEnBind,
      datos_auxiliares: datosAuxiliares == null ? null : JSON.stringify(datosAuxiliares),
      descripcion: datos.descripcion,
      activo: datos.activo
    })
  });
}

function limpiarIndefinidos(objeto) {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, valor]) => valor !== undefined)
  );
}

main().catch((error) => {
  console.error('[dns] Error verificando generación por mutaciones 5.21.11d');
  console.error(error);
  process.exit(1);
});
