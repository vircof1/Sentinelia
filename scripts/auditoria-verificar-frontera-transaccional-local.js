import assert from 'node:assert/strict';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';

async function main() {
  await verificarCommitConjuntoYEfectosSeparados();
  await verificarRollbackPorFalloDeNegocio();
  await verificarRollbackPorFalloDeAuditoria();
  await verificarFalloPosteriorAlCommit();
  await verificarContratoDeLaFrontera();
  console.log(
    '[auditoria] OK 5.21.5a: conexion=prestada commit=conjunto rollback=atomico efectos=post_commit externas=durables'
  );
}

async function verificarCommitConjuntoYEfectosSeparados() {
  const fixture = crearFixture();
  const resultado = await fixture.servicio.renombrarUsuario({
    usuarioId: 7,
    nombre: 'Operadora'
  });

  assert.deepEqual(resultado, { usuarioId: 7, nombre: 'Operadora' });
  assert.deepEqual(fixture.clienteSql.estado, {
    usuarios: [{ id: 7, nombre: 'Operadora' }],
    eventosAuditoria: [{ tipo: 'usuario.modificado', sujetoId: 7 }],
    operacionesExternas: [{ tipo: 'sincronizar_directorio', sujetoId: 7 }]
  });
  assert.equal(fixture.efectoPosterior.invocaciones, 1);
  assert.equal(fixture.adaptadorExterno.invocaciones, 0);
  assert.deepEqual(fixture.clienteSql.conexiones[0].traza, [
    'begin',
    'negocio',
    'auditoria',
    'operacion_externa_durable',
    'commit',
    'release',
    'efecto_post_commit'
  ]);
  assert.equal(
    fixture.repositorioUsuarios.conexiones[0],
    fixture.repositorioAuditoria.conexiones[0]
  );
  assert.equal(
    fixture.repositorioUsuarios.conexiones[0],
    fixture.repositorioOperaciones.conexiones[0]
  );

  await fixture.procesarOperacionesExternas();
  assert.equal(fixture.adaptadorExterno.invocaciones, 1);
}

async function verificarRollbackPorFalloDeNegocio() {
  const fixture = crearFixture();
  await assert.rejects(
    () => fixture.servicio.renombrarUsuario({
      usuarioId: 8,
      nombre: 'No persiste',
      falloNegocio: true
    }),
    /fallo de negocio/
  );

  assert.deepEqual(fixture.clienteSql.estado, estadoVacio());
  assert.equal(fixture.repositorioAuditoria.conexiones.length, 0);
  assert.equal(fixture.efectoPosterior.invocaciones, 0);
  assert.deepEqual(fixture.clienteSql.conexiones[0].traza, [
    'begin', 'negocio', 'rollback', 'release'
  ]);
}

async function verificarRollbackPorFalloDeAuditoria() {
  const fixture = crearFixture();
  await assert.rejects(
    () => fixture.servicio.renombrarUsuario({
      usuarioId: 9,
      nombre: 'Tampoco persiste',
      falloAuditoria: true
    }),
    /fallo de auditoría/
  );

  assert.deepEqual(fixture.clienteSql.estado, estadoVacio());
  assert.equal(fixture.efectoPosterior.invocaciones, 0);
  assert.deepEqual(fixture.clienteSql.conexiones[0].traza, [
    'begin', 'negocio', 'auditoria', 'rollback', 'release'
  ]);
}

async function verificarFalloPosteriorAlCommit() {
  const fixture = crearFixture({ falloEfectoPosterior: true });
  await assert.rejects(
    () => fixture.servicio.renombrarUsuario({
      usuarioId: 10,
      nombre: 'Confirmada'
    }),
    /fallo post-commit/
  );

  assert.deepEqual(fixture.clienteSql.estado.usuarios, [
    { id: 10, nombre: 'Confirmada' }
  ]);
  assert.equal(fixture.clienteSql.estado.eventosAuditoria.length, 1);
  assert.equal(fixture.clienteSql.estado.operacionesExternas.length, 1);
  assert.deepEqual(fixture.clienteSql.conexiones[0].traza, [
    'begin',
    'negocio',
    'auditoria',
    'operacion_externa_durable',
    'commit',
    'release',
    'efecto_post_commit'
  ]);
}

async function verificarContratoDeLaFrontera() {
  assert.throws(
    () => new FronteraTransaccionalLocal(null),
    /cliente SQL operativo/
  );
  const frontera = new FronteraTransaccionalLocal(new ClienteSqlFalso());
  await assert.rejects(() => frontera.ejecutar(null), /función de trabajo/);
  await assert.rejects(
    () => new RepositorioUsuariosFixture().modificar({ id: 1 }, {}),
    /conexión SQL explícita/
  );
  await assert.rejects(
    () => new RepositorioAuditoriaFixture().registrar({ sujetoId: 1 }, {}),
    /conexión SQL explícita/
  );
}

function crearFixture({ falloEfectoPosterior = false } = {}) {
  const clienteSql = new ClienteSqlFalso();
  const repositorioUsuarios = new RepositorioUsuariosFixture();
  const repositorioAuditoria = new RepositorioAuditoriaFixture();
  const repositorioOperaciones = new RepositorioOperacionesExternasFixture();
  const efectoPosterior = new EfectoPosteriorFixture({ fallo: falloEfectoPosterior });
  const adaptadorExterno = { invocaciones: 0 };
  const servicio = new ServicioUsuariosFixture({
    frontera: new FronteraTransaccionalLocal(clienteSql),
    repositorioUsuarios,
    repositorioAuditoria,
    repositorioOperaciones,
    efectoPosterior
  });

  return {
    clienteSql,
    repositorioUsuarios,
    repositorioAuditoria,
    repositorioOperaciones,
    efectoPosterior,
    adaptadorExterno,
    servicio,
    async procesarOperacionesExternas() {
      for (const operacion of clienteSql.estado.operacionesExternas) {
        assert.equal(operacion.tipo, 'sincronizar_directorio');
        adaptadorExterno.invocaciones += 1;
      }
    }
  };
}

class ServicioUsuariosFixture {
  constructor({
    frontera,
    repositorioUsuarios,
    repositorioAuditoria,
    repositorioOperaciones,
    efectoPosterior
  }) {
    this.frontera = frontera;
    this.repositorioUsuarios = repositorioUsuarios;
    this.repositorioAuditoria = repositorioAuditoria;
    this.repositorioOperaciones = repositorioOperaciones;
    this.efectoPosterior = efectoPosterior;
  }

  async renombrarUsuario({
    usuarioId,
    nombre,
    falloNegocio = false,
    falloAuditoria = false
  }) {
    const resultado = await this.frontera.ejecutar(async (conexion) => {
      await this.repositorioUsuarios.modificar(
        { id: usuarioId, nombre, fallo: falloNegocio },
        { conexion }
      );
      await this.repositorioAuditoria.registrar(
        { sujetoId: usuarioId, fallo: falloAuditoria },
        { conexion }
      );
      await this.repositorioOperaciones.reservar(
        { sujetoId: usuarioId },
        { conexion }
      );
      return Object.freeze({ usuarioId, nombre });
    });

    await this.efectoPosterior.ejecutar(resultado, {
      conexionFinalizada: this.repositorioUsuarios.conexiones.at(-1)
    });
    return resultado;
  }
}

class RepositorioUsuariosFixture {
  constructor() {
    this.conexiones = [];
  }

  async modificar({ id, nombre, fallo }, { conexion } = {}) {
    validarConexionPrestada(conexion);
    this.conexiones.push(conexion);
    conexion.traza.push('negocio');
    conexion.estadoTrabajo.usuarios.push({ id, nombre });
    if (fallo) throw new Error('fallo de negocio');
  }
}

class RepositorioAuditoriaFixture {
  constructor() {
    this.conexiones = [];
  }

  async registrar({ sujetoId, fallo }, { conexion } = {}) {
    validarConexionPrestada(conexion);
    this.conexiones.push(conexion);
    conexion.traza.push('auditoria');
    if (fallo) throw new Error('fallo de auditoría');
    conexion.estadoTrabajo.eventosAuditoria.push({
      tipo: 'usuario.modificado',
      sujetoId
    });
  }
}

class RepositorioOperacionesExternasFixture {
  constructor() {
    this.conexiones = [];
  }

  async reservar({ sujetoId }, { conexion } = {}) {
    validarConexionPrestada(conexion);
    this.conexiones.push(conexion);
    conexion.traza.push('operacion_externa_durable');
    conexion.estadoTrabajo.operacionesExternas.push({
      tipo: 'sincronizar_directorio',
      sujetoId
    });
  }
}

class EfectoPosteriorFixture {
  constructor({ fallo = false } = {}) {
    this.fallo = fallo;
    this.invocaciones = 0;
  }

  async ejecutar(_resultado, { conexionFinalizada }) {
    assert.equal(conexionFinalizada.liberada, true);
    conexionFinalizada.traza.push('efecto_post_commit');
    this.invocaciones += 1;
    if (this.fallo) throw new Error('fallo post-commit');
  }
}

class ClienteSqlFalso {
  constructor() {
    this.estado = estadoVacio();
    this.conexiones = [];
  }

  async obtenerConexion() {
    const conexion = new ConexionSqlFalsa(this);
    this.conexiones.push(conexion);
    return conexion;
  }
}

class ConexionSqlFalsa {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
    this.estadoTrabajo = null;
    this.liberada = false;
    this.traza = [];
  }

  async beginTransaction() {
    assert.equal(this.estadoTrabajo, null);
    this.traza.push('begin');
    this.estadoTrabajo = structuredClone(this.clienteSql.estado);
  }

  async commit() {
    assert.notEqual(this.estadoTrabajo, null);
    this.traza.push('commit');
    this.clienteSql.estado = this.estadoTrabajo;
    this.estadoTrabajo = null;
  }

  async rollback() {
    this.traza.push('rollback');
    this.estadoTrabajo = null;
  }

  async release() {
    this.traza.push('release');
    this.liberada = true;
  }
}

function validarConexionPrestada(conexion) {
  if (!conexion || conexion.estadoTrabajo === null) {
    throw new Error('El repositorio requiere una conexión SQL explícita y transaccional.');
  }
}

function estadoVacio() {
  return {
    usuarios: [],
    eventosAuditoria: [],
    operacionesExternas: []
  };
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación de la frontera transaccional local.');
  console.error(error);
  process.exitCode = 1;
});
