import { ejecutarGateSqlEfimero } from './soporte/ejecutar-gate-sql-efimero.js';

await ejecutarGateSqlEfimero([
  'usuarios-verificar-sesiones-web-durables.js',
  'usuarios-verificar-websocket-sesiones-durables.js'
]);
console.log('[gate:usuarios:sesiones-portal] OK: sesiones durables y revalidación WebSocket verificadas.');
