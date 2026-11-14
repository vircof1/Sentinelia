import assert from 'node:assert/strict';

import { ServicioResolucionAgnosticaRecuperacionPasswordEmail }
  from '../paquetes/usuarios/src/ServicioResolucionAgnosticaRecuperacionPasswordEmail.js';

await main();

async function main() {
  await verificarResolucionYEquivalencia();
  await verificarFronteraYGeneracion();
  await verificarPresupuestoYFalloTecnico();
  console.log('[usuarios] OK 5.30.6a: alegacion=reserva_lua equivalencia=login_sql frontera=revalidada presupuesto=idempotente vinculo=irreversible fallos_tecnicos=restaurados');
}

async function verificarResolucionYEquivalencia() {
  const fixture = crearFixture();
  const resuelta = await fixture.servicio.resolver({
    token: 'bearer_fixture', usuario: '  JAVIER  ', leaseSegundos: 30
  });
  assert.equal(resuelta.estado, 'resuelta');
  assert.equal(resuelta.alegacion.usuarioIdResuelto, '7');
  assert.equal(fixture.usuarios.consultas[0].usuario, 'JAVIER');

  const repetida = await fixture.servicio.resolver({
    token: 'bearer_fixture', usuario: 'javier', leaseSegundos: 30
  });
  assert.equal(repetida.estado, 'resuelta');
  assert.equal(repetida.alegacion.repetida, true);
  assert.equal(repetida.alegacion.consumePresupuesto, false);
  assert.equal(fixture.usuarios.consultas.length, 1,
    'la misma clase SQL no vuelve a consultar ni cobra presupuesto');

  const otro = await fixture.servicio.resolver({
    token: 'bearer_fixture', usuario: 'alberto', leaseSegundos: 30
  });
  assert.equal(otro.estado, 'vinculada');
  assert.equal(fixture.usuarios.consultas.length, 1,
    'el primer éxito impide intentar elegir otra identidad');
}

async function verificarFronteraYGeneracion() {
  const fuera = crearFixture({ usuarioId: '9' });
  const noMiembro = await fuera.servicio.resolver({
    token: 'bearer_fixture', usuario: 'javier', leaseSegundos: 30
  });
  assert.equal(noMiembro.estado, 'no_resuelta');
  assert.equal(noMiembro.alegacion.consumePresupuesto, true);

  const rezagada = crearFixture({ generacion: '4' });
  const noVigente = await rezagada.servicio.resolver({
    token: 'bearer_fixture', usuario: 'javier', leaseSegundos: 30
  });
  assert.equal(noVigente.estado, 'no_resuelta');

  const inexistente = crearFixture({ identidad: null });
  const falloUniforme = await inexistente.servicio.resolver({
    token: 'bearer_fixture', usuario: 'nadie', leaseSegundos: 30
  });
  assert.equal(falloUniforme.estado, 'no_resuelta');
  assert.equal(falloUniforme.alegacion.usuarioIdResuelto, null);
}

async function verificarPresupuestoYFalloTecnico() {
  const agotada = crearFixture({ presupuesto: 0 });
  const resultado = await agotada.servicio.resolver({
    token: 'bearer_fixture', usuario: 'javier', leaseSegundos: 30
  });
  assert.equal(resultado.estado, 'presupuesto_agotado');
  assert.equal(agotada.usuarios.consultas.length, 0);

  const averia = crearFixture({ falloSql: true });
  await assert.rejects(() => averia.servicio.resolver({
    token: 'bearer_fixture', usuario: 'javier', leaseSegundos: 30
  }), /sql temporal/u);
  assert.equal(averia.solicitudes.restauraciones, 1);
  assert.equal(averia.solicitudes.presupuesto, 2,
    'un fallo técnico no consume la alegación');
}

function crearFixture({ identidad = undefined, usuarioId = '7', generacion = '3',
  presupuesto = 2, falloSql = false } = {}) {
  const miembro = {
    usuarioId: '7', generacionRecuperacionObservada: '3', estado: 'utilizable'
  };
  const solicitudes = crearSolicitudes({ miembro, presupuesto });
  const identidadSql = identidad === undefined ? {
    id: usuarioId,
    generacionRecuperacion: generacion,
    activo: true,
    emailValidado: true,
    email: 'compartido@example.test'
  } : identidad;
  const usuarios = {
    consultas: [],
    async buscarIdentidadElegibleRecuperacionPorUsuarioEnTransaccion(entrada) {
      this.consultas.push(entrada);
      if (falloSql) throw new Error('sql temporal');
      return identidadSql;
    }
  };
  return {
    solicitudes,
    usuarios,
    servicio: new ServicioResolucionAgnosticaRecuperacionPasswordEmail({
      repositorioSolicitudes: solicitudes,
      repositorioUsuarios: usuarios,
      fronteraTransaccional: { ejecutar: (trabajo) => trabajo({ execute() {} }) },
      propietario: 'fixture-5.30.6a'
    })
  };
}

function crearSolicitudes({ miembro, presupuesto }) {
  const resultados = new Map();
  return {
    presupuesto,
    vinculada: false,
    restauraciones: 0,
    async reservarAlegacion({ huellaNombreSha256, reservaId, propietario }) {
      if (resultados.has(huellaNombreSha256)) {
        return { estado: 'repetida', alegacion: resultados.get(huellaNombreSha256) };
      }
      if (this.vinculada) return { estado: 'vinculada' };
      if (this.presupuesto === 0) return { estado: 'presupuesto_agotado' };
      this.reserva = { huellaNombreSha256, reservaId, propietario };
      return { estado: 'reservada' };
    },
    async inspeccionar() {
      return {
        estado: 'activa',
        solicitud: {
          buzonCanonico: 'compartido@example.test',
          frontera: { miembros: [miembro] }
        }
      };
    },
    async consolidarAlegacion(entrada) {
      this.presupuesto -= 1;
      const alegacion = {
        resultado: entrada.resultado,
        usuarioIdResuelto: entrada.usuarioIdResuelto
      };
      resultados.set(entrada.huellaNombreSha256, alegacion);
      if (entrada.resultado === 'resuelta') this.vinculada = true;
      delete this.reserva;
      return { estado: 'consolidada', alegacion };
    },
    async restaurarAlegacion() {
      this.restauraciones += 1;
      delete this.reserva;
      return true;
    }
  };
}
