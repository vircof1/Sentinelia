import { ejecutarGateSqlEfimero } from './soporte/ejecutar-gate-sql-efimero.js';

await ejecutarGateSqlEfimero([
  'usuarios-verificar-autogestion-fase5.js',
  'usuarios-verificar-autogestion-fase9.js'
]);
console.log('[gate:usuarios:perfil-email-ui] OK: persistencia de email y representación del perfil verificadas.');
