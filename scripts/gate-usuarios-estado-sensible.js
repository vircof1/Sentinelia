import { ejecutarGateSqlEfimero } from './soporte/ejecutar-gate-sql-efimero.js';

await ejecutarGateSqlEfimero([
  'usuarios-verificar-autogestion-fase4.js',
  'usuarios-verificar-autogestion-fase8.js'
]);
console.log('[gate:usuarios:estado-sensible] OK: contraseña e invalidaciones coordinadas verificadas.');
