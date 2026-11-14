import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { ControladorBootstrapMigraciones } from '../paquetes/persistencia-sql/src/ControladorBootstrapMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();

  if (!configuracion.sql.estaCompleta) {
    throw new Error(
      'Configuracion SQL incompleta. Revisa SQL_HOST, SQL_USUARIO y SQL_BASE_DATOS.'
    );
  }

  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorioMigraciones = new RepositorioMigraciones(clienteSql);
  const ejecutorMigraciones = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones,
    rutaMigraciones: obtenerRutaMigraciones()
  });

  const controladorBootstrapMigraciones = new ControladorBootstrapMigraciones({
    habilitado: configuracion.sql.bootstrapMigraciones,
    ejecutorMigraciones,
    clienteSql
  });

  const usoHorarioUtc = await clienteSql.verificarUsoHorarioUtc();
  const resultado = configuracion.sql.bootstrapMigraciones
    ? await controladorBootstrapMigraciones.arrancarSiProcede()
    : await ejecutorMigraciones.ejecutarPendientes();

  console.log(`[migraciones] ${resultado.mensaje}`);
  console.log(
    `[migraciones] SQL UTC verificado. session=${usoHorarioUtc.sessionTimeZone} global=${usoHorarioUtc.globalTimeZone} diferencia=${usoHorarioUtc.diferenciaSegundos}s`
  );

  await clienteSql.cerrar();
}

main().catch((error) => {
  console.error('[migraciones] Error fatal');
  console.error(error);
  process.exit(1);
});
