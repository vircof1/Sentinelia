import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { RepositorioCoordinacionVerificacionAuditoriaSql } from '../paquetes/auditoria/src/RepositorioCoordinacionVerificacionAuditoriaSql.js';
import { RepositorioDiagnosticosIntegridadAuditoriaSql } from '../paquetes/auditoria/src/RepositorioDiagnosticosIntegridadAuditoriaSql.js';
import { RepositorioVerificacionAuditoriaSql } from '../paquetes/auditoria/src/RepositorioVerificacionAuditoriaSql.js';
import { ServicioAuditoriaOperativa } from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { ServicioDiagnosticosIntegridadAuditoria } from '../paquetes/auditoria/src/ServicioDiagnosticosIntegridadAuditoria.js';
import { ServicioEjecucionVerificacionAuditoria } from '../paquetes/auditoria/src/ServicioEjecucionVerificacionAuditoria.js';
import { VerificadorCadenaAuditoria } from '../paquetes/auditoria/src/VerificadorCadenaAuditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main(argumentos = process.argv.slice(2)) {
  const opciones = parsearArgumentos(argumentos);
  const { servicio, cerrar } = await construirServicio();
  try {
    let resultado;
    if (opciones.accion === 'bootstrap') {
      resultado = await servicio.comprobarBootstrap({ limite: opciones.limite });
    } else if (opciones.accion === 'diaria') {
      resultado = await servicio.ejecutarDiaria({
        instanciaId: opciones.instanciaId,
        limiteCadenas: opciones.limite,
        presupuestoMs: opciones.presupuestoMs
      });
    } else {
      resultado = await servicio.verificarCadena({ claveCadena: opciones.claveCadena });
    }
    process.stdout.write(servicio.formatearSalida(resultado, { json: opciones.json }));
  } finally {
    await cerrar();
  }
}

async function construirServicio() {
  const configuracion = obtenerConfiguracionAplicacion();
  if (!configuracion.sql.estaCompleta) {
    throw new Error('La CLI de integridad de auditoría requiere configuración SQL completa.');
  }
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorioAuditoria = new RepositorioAuditoria(clienteSql);
  const repositorioDiagnosticos = new RepositorioDiagnosticosIntegridadAuditoriaSql({ clienteSql });
  const servicioDiagnosticos = new ServicioDiagnosticosIntegridadAuditoria({
    repositorioDiagnosticos,
    servicioAuditoria: new ServicioAuditoriaOperativa({ repositorioAuditoria })
  });
  const servicio = new ServicioEjecucionVerificacionAuditoria({
    repositorioCoordinacion: new RepositorioCoordinacionVerificacionAuditoriaSql({ clienteSql }),
    verificadorCadena: new VerificadorCadenaAuditoria({
      repositorio: new RepositorioVerificacionAuditoriaSql({ clienteSql })
    }),
    servicioDiagnosticos
  });
  return {
    servicio,
    cerrar: () => clienteSql.cerrar()
  };
}

function parsearArgumentos(argumentos) {
  const accion = argumentos.find((arg) => !arg.startsWith('--')) ?? 'bootstrap';
  const json = argumentos.includes('--json');
  const claveCadena = valorOpcion(argumentos, '--cadena') ?? null;
  const instanciaId = valorOpcion(argumentos, '--instancia') ??
    `cli-auditoria-${process.pid}`;
  const limite = entero(valorOpcion(argumentos, '--limite') ?? '25', 'limite');
  const presupuestoMs = entero(valorOpcion(argumentos, '--presupuesto-ms') ?? '30000', 'presupuestoMs');

  if (!['bootstrap', 'diaria', 'cadena'].includes(accion)) {
    throw new Error('Uso: auditoria-integridad-operar.js [bootstrap|diaria|cadena] [--json] [--cadena clave] [--limite n] [--presupuesto-ms n]');
  }
  if (accion === 'cadena' && !claveCadena) {
    throw new Error('La acción cadena requiere --cadena.');
  }
  return Object.freeze({
    accion,
    json,
    claveCadena,
    instanciaId,
    limite,
    presupuestoMs
  });
}

function valorOpcion(argumentos, nombre) {
  const indice = argumentos.indexOf(nombre);
  if (indice === -1) return null;
  return argumentos[indice + 1] ?? null;
}

function entero(valor, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) {
    throw new Error(`${nombre} debe ser entero positivo.`);
  }
  return numero;
}

main().catch((error) => {
  process.stderr.write(`[auditoria-integridad] ${error.message}\n`);
  process.exitCode = 1;
});
