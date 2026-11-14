import { ejecutarGateSqlEfimero } from './soporte/ejecutar-gate-sql-efimero.js';

await ejecutarGateSqlEfimero([
  'usuarios-verificar-recuperacion-5-30-1c.js',
  'usuarios-verificar-recuperacion-5-30-2a.js',
  'usuarios-verificar-recuperacion-5-30-2b.js'
]);
console.log('[gate:usuarios:recuperacion-auditoria] OK: configuración, contratos y testigo durable verificados.');
