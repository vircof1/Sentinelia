import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { ValidadorMonitor } from '../paquetes/monitores/src/ValidadorMonitor.js';
import { RepositorioTenants } from '../paquetes/jerarquia-organizativa/src/RepositorioTenants.js';
import { RepositorioEmpresas } from '../paquetes/jerarquia-organizativa/src/RepositorioEmpresas.js';
import { RepositorioSitios } from '../paquetes/jerarquia-organizativa/src/RepositorioSitios.js';
import { ResolutorScopeUsuario } from '../paquetes/contexto-usuario/src/ResolutorScopeUsuario.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();

  if (!configuracion.sql.estaCompleta) {
    throw new Error(
      'Configuracion SQL incompleta. Revisa SQL_HOST, SQL_USUARIO y SQL_BASE_DATOS.'
    );
  }

  const clienteSql = new ClienteSql(configuracion.sql);
  const servicioMonitores = new ServicioMonitores({
    repositorioMonitores: new RepositorioMonitores(clienteSql),
    repositorioTenants: new RepositorioTenants(clienteSql),
    repositorioEmpresas: new RepositorioEmpresas(clienteSql),
    repositorioSitios: new RepositorioSitios(clienteSql),
    resolutorScopeUsuario: new ResolutorScopeUsuario(),
    validadorMonitor: new ValidadorMonitor()
  });

  try {
    const exportacion = await servicioMonitores.exportarDefinicionesRuntime();
    console.log(JSON.stringify(exportacion, null, 2));
  } finally {
    await clienteSql.cerrar();
  }
}

main().catch((error) => {
  console.error('[monitores-runtime] Error fatal');
  console.error(error);
  process.exit(1);
});
