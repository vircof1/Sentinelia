import { ejecutarGateSqlEfimero } from './soporte/ejecutar-gate-sql-efimero.js';

await ejecutarGateSqlEfimero([
  'auditoria-verificar-sesiones-web-durables.js',
  'auditoria-verificar-soporte-sesiones-web.js'
]);
console.log('[gate:auditoria:sesiones-web] OK: autoridad durable y proyecciones de sesiones verificadas.');
