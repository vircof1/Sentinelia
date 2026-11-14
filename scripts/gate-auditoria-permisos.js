import { ejecutarGateSqlEfimero } from './soporte/ejecutar-gate-sql-efimero.js';

await ejecutarGateSqlEfimero(['auditoria-verificar-permiso.js']);
console.log('[gate:auditoria:permisos] OK: denegación inicial, bootstrap y delegación verificados.');
