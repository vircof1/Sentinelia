import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioAutenticacion } from '../paquetes/usuarios/src/ServicioAutenticacion.js';
import { ControladorBootstrapUsuarioInicial } from '../paquetes/usuarios/src/ControladorBootstrapUsuarioInicial.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa } from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();

  if (!configuracion.sql.estaCompleta) {
    throw new Error(
      'Configuracion SQL incompleta. Revisa SQL_HOST, SQL_USUARIO y SQL_BASE_DATOS.'
    );
  }

  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorioUsuarios = new RepositorioUsuarios(clienteSql);
  const servicioAutenticacion = new ServicioAutenticacion({
    repositorioUsuarios
  });

  try {
    const controladorBootstrapUsuarioInicial =
      new ControladorBootstrapUsuarioInicial({
        repositorioUsuarios,
        servicioAutenticacion,
        configuracionUsuarioInicial: configuracion.usuarioInicial,
        fronteraTransaccional: new FronteraTransaccionalLocal(clienteSql),
        servicioAuditoria: new ServicioAuditoriaOperativa({
          repositorioAuditoria: new RepositorioAuditoria(clienteSql)
        })
      });
    const resultadoBootstrap =
      await controladorBootstrapUsuarioInicial.arrancarSiProcede();

    if (!resultadoBootstrap.creado) {
      throw new Error(resultadoBootstrap.mensaje);
    }

    console.log(`[usuarios] ${resultadoBootstrap.mensaje}`);
  } finally {
    await clienteSql.cerrar();
  }
}

main().catch((error) => {
  console.error('[usuarios] Error fatal');
  console.error(error);
  process.exit(1);
});
