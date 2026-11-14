import assert from 'node:assert/strict';
import { ServicioAdministracionDnsPortal } from '../apps/sentinelia-web/src/servicios/ServicioAdministracionDnsPortal.js';
import { ZonaDns } from '../paquetes/dns/src/ZonaDns.js';
import { RegistroDns } from '../paquetes/dns/src/RegistroDns.js';
import {
  validarEventoAuditableV1,
  validarParMovimientoAuditoriaV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { prepararIntencionAuditoriaV1 } from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';

async function main() {
  await verificarCategoriasZonaPortal();
  await verificarCrudZonaAuditable();
  await verificarCrudRegistroAuditable();
  await verificarImpersonacionRegistroAuditable();

  console.log(
    '[dns] OK 5.21.11b: zonas=crud_auditable registros=crud_auditable noop=sin_ruido scope=movimiento invalidacion=derivada impersonacion=contrato'
  );
}

async function verificarCategoriasZonaPortal() {
  const { servicio } = crearEntorno();
  const contexto = contextoPortal();

  for (const categoriaOrigen of ['normal', 'sistema']) {
    const definicion = await servicio.normalizarDefinicionFormulario(
      contexto,
      datosZona({ categoriaOrigen })
    );
    assert.equal(definicion.categoriaOrigen, categoriaOrigen);
  }

  for (const categoriaOrigen of ['ddns', 'trigger']) {
    await assert.rejects(
      servicio.normalizarDefinicionFormulario(
        contexto,
        datosZona({ categoriaOrigen })
      ),
      /debe ser Normal o Sistema/
    );
  }
}

async function verificarCrudZonaAuditable() {
  const entorno = crearEntorno();

  await entorno.servicio.crearZona(contextoPortal(), datosZona());

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:crear-zona',
    'sql:crear-registro:NS',
    'sql:crear-registro:A',
    'audit:dns.zona_creada:principal',
    'commit',
    'redis:invalidar-dns'
  ]);
  assert.equal(entorno.auditoria.eventos[0].tipo, 'dns.zona_creada');
  assert.equal(entorno.auditoria.eventos[0].payload.despues.nombreZona, 'example.test');

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarZona(contextoPortal(), 10, datosZona({
    nombreZona: 'example.test',
    descripcion: 'Zona principal',
    nivelPertenencia: 'sitio',
    sitioId: 3
  }));

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar-zona',
    'sql:sincronizar-scope-registros',
    'audit:dns.zona_actualizada:principal',
    'audit-mov:scope.entidad_salida/scope.entidad_entrada',
    'commit',
    'redis:invalidar-dns'
  ]);
  const [actualizacion, salida, entrada] = entorno.auditoria.eventos;
  assert.equal(actualizacion.tipo, 'dns.zona_actualizada');
  assert.deepEqual(actualizacion.payload.camposCambiados, [
    'descripcion',
    'sitioId'
  ]);
  assert.equal(salida.tipo, 'scope.entidad_salida');
  assert.equal(entrada.tipo, 'scope.entidad_entrada');

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarZona(contextoPortal(), 10, datosZona({
    nombreZona: 'example.test',
    descripcion: 'Zona principal',
    nivelPertenencia: 'sitio',
    sitioId: 3
  }));
  assert.deepEqual(entorno.traza, []);
  assert.equal(entorno.auditoria.eventos.length, 0);

  entorno.traza.length = 0;
  await entorno.servicio.eliminarZona(contextoPortal(), 10);
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:eliminar-zona',
    'audit:dns.zona_eliminada:principal',
    'commit',
    'redis:invalidar-dns'
  ]);
  const eliminacion = entorno.auditoria.eventos.at(-1);
  assert.equal(eliminacion.tipo, 'dns.zona_eliminada');
  assert.deepEqual(eliminacion.payload.impactoResumen, {
    dependenciasEliminadas: '2',
    referenciasDesacopladas: '0'
  });
}

async function verificarCrudRegistroAuditable() {
  const entorno = crearEntorno();
  entorno.zonas.set(10, zonaFixture({ id: 10 }));

  await entorno.servicio.crearRegistro(contextoPortal(), 10, datosRegistro());

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:crear-registro:A',
    'sql:marcar-pendiente-zona',
    'audit:dns.registro_creado:principal',
    'commit',
    'redis:invalidar-dns'
  ]);
  assert.equal(entorno.auditoria.eventos[0].tipo, 'dns.registro_creado');
  assert.equal(entorno.auditoria.eventos[0].payload.despues.hostRelativo, 'www');

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarRegistro(contextoPortal(), 10, 20, datosRegistro({
    ttlSegundos: 600,
    descripcion: 'Web principal'
  }));

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar-registro',
    'sql:marcar-pendiente-zona',
    'audit:dns.registro_actualizado:principal',
    'commit',
    'redis:invalidar-dns'
  ]);
  assert.deepEqual(entorno.auditoria.eventos[0].payload.camposCambiados, [
    'descripcion',
    'ttlSegundos'
  ]);

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarRegistro(contextoPortal(), 10, 20, datosRegistro({
    ttlSegundos: 600,
    valorPrincipal: '192.0.2.20',
    descripcion: 'Web principal'
  }));

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar-registro',
    'sql:marcar-pendiente-zona',
    'audit:dns.registro_actualizado:principal',
    'commit',
    'redis:invalidar-dns'
  ]);
  assert.deepEqual(entorno.auditoria.eventos[0].payload.camposCambiados, [
    'valorPrincipal'
  ]);
  assert.deepEqual(entorno.auditoria.eventos[0].payload.antes, {
    valorPrincipal: '192.0.2.10'
  });
  assert.deepEqual(entorno.auditoria.eventos[0].payload.despues, {
    valorPrincipal: '192.0.2.20'
  });

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarRegistro(contextoPortal(), 10, 20, datosRegistro({
    ttlSegundos: 600,
    valorPrincipal: '192.0.2.20',
    descripcion: 'Web principal'
  }));
  assert.deepEqual(entorno.traza, []);
  assert.equal(entorno.auditoria.eventos.length, 0);

  entorno.traza.length = 0;
  await entorno.servicio.eliminarRegistro(contextoPortal(), 10, 20);
  assert.deepEqual(entorno.traza, [
    'begin',
    'triggers:revocar-registro',
    'sql:eliminar-registro',
    'sql:marcar-pendiente-zona',
    'audit:dns.registro_eliminado:principal',
    'commit',
    'redis:invalidar-dns'
  ]);
  assert.equal(entorno.auditoria.eventos.at(-1).tipo, 'dns.registro_eliminado');
}

async function verificarImpersonacionRegistroAuditable() {
  const entorno = crearEntorno();
  entorno.zonas.set(10, zonaFixture({ id: 10 }));

  await entorno.servicio.crearRegistro(contextoPortalImpersonado(), 10, datosRegistro({
    hostRelativo: 'impersonado'
  }));

  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'dns.registro_creado');
  assert.equal(evento.modoActuacion, 'impersonado');
  assert.deepEqual(evento.actorReal, { tipo: 'usuario', id: '7' });
  assert.deepEqual(evento.actorEfectivo, { tipo: 'usuario', id: '11' });
}

function crearEntorno() {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }, { conexion } = {}) {
      assert.ok(conexion);
      validarEventoAuditableV1(intencion);
      prepararIntencionAuditoriaV1(intencion);
      assert.ok(!intencion.tipo.startsWith('dns.publicacion_'));
      traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    },
    async registrarMovimientoEnTransaccion({ salida, entrada }, { conexion } = {}) {
      assert.ok(conexion);
      validarParMovimientoAuditoriaV1(salida, entrada);
      prepararIntencionAuditoriaV1(salida);
      prepararIntencionAuditoriaV1(entrada);
      traza.push(`audit-mov:${salida.tipo}/${entrada.tipo}`);
      this.eventos.push(salida, entrada);
      return { eventos: [salida, entrada], estado: 'incorporado' };
    }
  };
  const entorno = {
    traza,
    auditoria,
    zonas: new Map(),
    registros: new Map()
  };
  const repositorioZonasDns = {
    clienteSql: {
      async obtenerConexion() {
        throw new Error('El smoke debe usar la frontera transaccional inyectada.');
      }
    },
    async buscarVisiblePorId(_contexto, id) {
      return entorno.zonas.get(Number(id)) || null;
    },
    async buscarPorNombreZona(nombreZona) {
      const normalizado = String(nombreZona || '').trim().toLowerCase();
      return [...entorno.zonas.values()]
        .find((zona) => zona.nombreZona === normalizado) || null;
    },
    async crear(definicion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:crear-zona');
      const zona = zonaFixture({ id: 10, ...definicion });
      entorno.zonas.set(10, zona);
      return zona;
    },
    async actualizar({ idZona, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:actualizar-zona');
      const zona = zonaFixture({ id: idZona, ...definicion });
      entorno.zonas.set(Number(idZona), zona);
      return zona;
    },
    async eliminar(idZona, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:eliminar-zona');
      return entorno.zonas.delete(Number(idZona));
    },
    async marcarPendientePublicacion(_idZona, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:marcar-pendiente-zona');
      return 1;
    }
  };
  const repositorioRegistrosDns = {
    async buscarPorId(id) {
      return entorno.registros.get(Number(id)) || null;
    },
    async contarPorZonaId(idZona, { conexion } = {}) {
      assert.ok(conexion);
      return [...entorno.registros.values()]
        .filter((registro) => Number(registro.zonaId) === Number(idZona))
        .length;
    },
    async crear(definicion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`sql:crear-registro:${definicion.tipoRegistro}`);
      const id = entorno.registros.has(20) ? 30 + entorno.registros.size : 20;
      const zona = entorno.zonas.get(Number(definicion.zonaId)) || zonaFixture();
      const registro = registroFixture({
        id,
        tenantId: zona.tenantId,
        empresaId: zona.empresaId,
        sitioId: zona.sitioId,
        ...definicion
      });
      entorno.registros.set(id, registro);
      return registro;
    },
    async actualizar({ idRegistro, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:actualizar-registro');
      const actual = entorno.registros.get(Number(idRegistro));
      const registro = registroFixture({
        id: idRegistro,
        tenantId: actual.tenantId,
        empresaId: actual.empresaId,
        sitioId: actual.sitioId,
        ...definicion
      });
      entorno.registros.set(Number(idRegistro), registro);
      return registro;
    },
    async eliminar(idRegistro, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:eliminar-registro');
      return entorno.registros.delete(Number(idRegistro));
    },
    async sincronizarScopeDesdeZona({ zonaId, tenantId, empresaId, sitioId }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:sincronizar-scope-registros');
      for (const [id, registro] of entorno.registros) {
        if (Number(registro.zonaId) === Number(zonaId)) {
          entorno.registros.set(id, registroFixture({
            ...registro.serializarPersistencia(),
            id,
            tenantId,
            empresaId,
            sitioId
          }));
        }
      }
      return entorno.registros.size;
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

  entorno.servicio = new ServicioAdministracionDnsPortal({
    servicioTriggers: {
      revocarObjetivosDnsZonaEnTransaccion: async () => ({
        accionesDeshabilitadas: 0, ejecucionesCanceladas: 0
      }),
      async revocarObjetivosDnsRegistroEnTransaccion({ registroId }, { conexion }) {
        assert.equal(registroId, 20);
        assert.ok(conexion);
        traza.push('triggers:revocar-registro');
        return { accionesDeshabilitadas: 0, ejecucionesCanceladas: 0 };
      }
    },
    repositorioZonasDns,
    repositorioRegistrosDns,
    repositorioTenants: { listarVisibles: async () => [{ id: 1, nombre: 'Tenant' }] },
    repositorioEmpresas: {
      listarVisibles: async () => [{ id: 2, tenantId: 1, nombre: 'Empresa' }]
    },
    repositorioSitios: {
      listarVisibles: async () => [{ id: 3, tenantId: 1, empresaId: 2, nombre: 'Sitio' }]
    },
    resolutorScopeUsuario: null,
    servicioLecturaDnsPortal: null,
    servicioDns: {
      async invalidarCatalogoDns() {
        traza.push('redis:invalidar-dns');
      }
    },
    fronteraTransaccional,
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-07-25T11:00:00.000Z')
  });

  return entorno;
}

function datosZona(sobrescritura = {}) {
  return {
    nivelPertenencia: 'empresa',
    tenantId: 1,
    empresaId: 2,
    sitioId: null,
    nombreZona: 'example.test',
    categoriaOrigen: 'normal',
    publicarEnBind: '1',
    descripcion: '',
    ttlDefectoSegundos: '3600',
    soaMname: 'ns1.example.test',
    soaRname: 'hostmaster.example.test',
    soaRefreshSegundos: '3600',
    soaRetrySegundos: '600',
    soaExpireSegundos: '1209600',
    soaMinimumSegundos: '300',
    activo: '1',
    ...sobrescritura
  };
}

function datosRegistro(sobrescritura = {}) {
  return {
    hostRelativo: 'www',
    tipoRegistro: 'A',
    valorPrincipal: '192.0.2.10',
    ttlSegundos: '300',
    prioridad: '',
    peso: '',
    puerto: '',
    flags: '',
    tag: '',
    categoriaOrigen: 'normal',
    publicarEnBind: '1',
    descripcion: '',
    activo: '1',
    ...sobrescritura
  };
}

function contextoPortal() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    nivelScope: 'portal',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: {
      editarDns: true,
      publicarDns: true,
      administrarDnsAvanzado: true
    }
  };
}

function contextoPortalImpersonado() {
  return {
    ...contextoPortal(),
    idUsuario: 11,
    idUsuarioReal: 7,
    impersonacionActiva: true
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
    ...aFilaZona(datos)
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
    prioridad: null,
    peso: null,
    puerto: null,
    flags: null,
    tag: null,
    categoria_origen: 'normal',
    publicar_en_bind: 1,
    datos_auxiliares: null,
    descripcion: null,
    activo: 1,
    ...aFilaRegistro(datos)
  });
}

function aFilaZona(datos) {
  return limpiarIndefinidos({
    id: datos.id,
    tenant_id: datos.tenantId,
    empresa_id: datos.empresaId,
    sitio_id: datos.sitioId,
    nombre_zona: datos.nombreZona,
    tipo_zona: datos.tipoZona,
    categoria_origen: datos.categoriaOrigen,
    publicar_en_bind: datos.publicarEnBind,
    descripcion: datos.descripcion,
    ttl_defecto_segundos: datos.ttlDefectoSegundos,
    soa_mname: datos.soaMname,
    soa_rname: datos.soaRname,
    soa_refresh_segundos: datos.soaRefreshSegundos,
    soa_retry_segundos: datos.soaRetrySegundos,
    soa_expire_segundos: datos.soaExpireSegundos,
    soa_minimum_segundos: datos.soaMinimumSegundos,
    activo: datos.activo
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
      ? null
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

main().catch((error) => {
  console.error('[dns] Error verificando administración auditable 5.21.11b');
  console.error(error);
  process.exit(1);
});
