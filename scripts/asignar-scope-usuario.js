import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { ResolutorScopeUsuario } from '../paquetes/contexto-usuario/src/ResolutorScopeUsuario.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();

  const usuario = process.env.USUARIO_OBJETIVO || '';
  const tenantId = normalizarNullable(process.env.SCOPE_TENANT_ID);
  const empresaId = normalizarNullable(process.env.SCOPE_EMPRESA_ID);
  const sitioId = normalizarNullable(process.env.SCOPE_SITIO_ID);

  if (!usuario) {
    throw new Error('Debes definir USUARIO_OBJETIVO.');
  }

  const resolutor = new ResolutorScopeUsuario();

  if (
    !resolutor.esJerarquiaValida({
      tenantId,
      empresaId,
      sitioId
    })
  ) {
    throw new Error('La combinación tenant/empresa/sitio no representa un scope válido.');
  }

  const clienteSql = new ClienteSql(configuracion.sql);

  await clienteSql.ejecutar(
    `
      UPDATE usuarios
      SET
        tenant_id = ?,
        empresa_id = ?,
        sitio_id = ?
      WHERE usuario = ?
    `,
    [tenantId, empresaId, sitioId, usuario]
  );

  await clienteSql.cerrar();

  console.log(
    `[usuarios] Scope actualizado para ${usuario}: tenant=${tenantId ?? 'null'}, empresa=${empresaId ?? 'null'}, sitio=${sitioId ?? 'null'}`
  );
}

function normalizarNullable(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }

  const numero = Number.parseInt(valor, 10);

  if (Number.isNaN(numero)) {
    throw new Error(`Valor de scope no válido: ${valor}`);
  }

  return numero;
}

main().catch((error) => {
  console.error('[usuarios] Error fatal');
  console.error(error);
  process.exit(1);
});
