import { ejecutarGateSqlEfimero } from './soporte/ejecutar-gate-sql-efimero.js';

await ejecutarGateSqlEfimero([
  'usuarios-verificar-fase1-autogestion-perfil.js',
  'usuarios-verificar-autogestion-fase2.js',
  'usuarios-verificar-autogestion-fase3.js'
]);
console.log('[gate:usuarios:perfil-base] OK: configuración, autorización temporal y edición de perfil verificadas.');
