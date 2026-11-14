import { RepositorioOutboxAuditoriaRuntime } from '../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main(argumentos = process.argv.slice(2)) {
  const [accion, valor] = argumentos;
  if (!['listar', 'rehabilitar'].includes(accion)) {
    throw new Error(
      'Uso: npm run auditoria:outbox -- listar [limite] | rehabilitar <obligacionId>'
    );
  }
  const configuracion = obtenerConfiguracionAplicacion();
  if (!configuracion.sql.estaCompleta) {
    throw new Error('La operación outbox requiere configuración SQL completa.');
  }
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioOutboxAuditoriaRuntime(clienteSql);
  try {
    const resultado = accion === 'listar'
      ? await repositorio.listarBloqueadas({
          limite: valor === undefined ? 100 : enteroDecimal(valor, 'límite')
        })
      : await repositorio.rehabilitarBloqueada(
          enteroDecimal(valor, 'obligacionId')
        );
    process.stdout.write(`${JSON.stringify({ accion, resultado }, null, 2)}\n`);
  } finally {
    await clienteSql.cerrar();
  }
}

function enteroDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) {
    throw new Error(`${nombre} debe ser un entero decimal positivo.`);
  }
  return texto;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    error: 'operacion_outbox_fallida',
    mensaje: error?.message || 'Error operativo no identificado.'
  })}\n`);
  process.exit(1);
});
