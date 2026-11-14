import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gates = [
  'gate-usuarios-perfil-base.js',
  'gate-usuarios-estado-sensible.js',
  'gate-usuarios-perfil-email-ui.js',
  'usuarios-verificar-autogestion-fase10.js',
  'gate-usuarios-email-cola.js',
  'gate-usuarios-email-emision.js',
  'gate-usuarios-email-despacho.js',
  'gate-usuarios-email-api.js',
  'usuarios-verificar-email-perfil-5-30b-7.js'
];
const rutaNodeJs = fileURLToPath(new URL('..', import.meta.url));

for (const gate of gates) {
  const archivo = `scripts/${gate}`;
  console.log(`\n[usuarios:autogestion] Ejecutando ${gate}...`);
  const resultado = spawnSync(process.execPath, [archivo], {
    cwd: rutaNodeJs,
    env: process.env,
    stdio: 'inherit'
  });
  if (resultado.error) throw resultado.error;
  if (resultado.status !== 0) {
    process.exit(resultado.status || 1);
  }
}

console.log(
  '\n[usuarios:autogestion] OK: perfil, estado sensible y verificación coordinada de correo verificados.'
);
