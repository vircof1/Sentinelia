import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const portal = readFileSync(
  resolve(raiz, 'apps/sentinelia-web/src/public/js/portal.js'),
  'utf8'
);
const estilos = readFileSync(
  resolve(raiz, 'apps/sentinelia-web/src/public/css/portal.css'),
  'utf8'
);
const inicioDropdowns = portal.indexOf('function inicializarDropdownsAccionesEnTablas()');
const finDropdowns = portal.indexOf('function inicializarSelectorTema()', inicioDropdowns);
assert.ok(inicioDropdowns >= 0 && finDropdowns > inicioDropdowns, 'Debe localizarse la implementación de dropdowns.');
const dropdowns = portal.slice(inicioDropdowns, finDropdowns);

assert.match(
  portal,
  /\.table-responsive \[data-bs-toggle="dropdown"\]/u,
  'Las tablas responsive deben participar en el portal móvil de dropdowns.'
);
assert.match(
  portal,
  /strategy: 'fixed'/u,
  'Popper debe posicionar los menús respecto al viewport.'
);
assert.match(
  portal,
  /document\.body\.appendChild\(menu\)/u,
  'El menú abierto debe salir temporalmente del contenedor con overflow.'
);
assert.match(
  portal,
  /window\.bootstrap\.Dropdown\.getInstance\(boton\)\?\.update\(\)/u,
  'Popper debe recalcular la posición después de mover o desplazar el menú.'
);
assert.doesNotMatch(
  dropdowns,
  /posicionarDropdownFlotante|getBoundingClientRect\(\)/u,
  'El portal no debe competir con Popper mediante una geometría manual.'
);

const reglaFlotante = estilos.match(
  /\.dropdown-menu--flotante-tabla\s*\{(?<contenido>[^}]*)\}/u
);
assert.ok(reglaFlotante, 'Debe existir la capa visual del menú extraído.');
assert.match(reglaFlotante.groups.contenido, /z-index:\s*1080/u);
assert.doesNotMatch(
  reglaFlotante.groups.contenido,
  /position|inset|transform|\bleft\b|\btop\b|\bright\b|\bbottom\b/u,
  'La capa visual no debe sobrescribir la geometría autoritativa de Popper.'
);

console.log(
  '[ux] OK dropdowns móviles: portal fuera de overflow y geometría gobernada por Popper.'
);
