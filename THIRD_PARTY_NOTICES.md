# Componentes de terceros

La licencia AGPL-3.0-only de Sentinelia se aplica al código propio del proyecto.
Los componentes de terceros mantienen sus licencias y avisos originales.

- Los iconos Bootstrap Icons incluidos en
  `apps/sentinelia-web/src/public/vendor/bootstrap-icons/` conservan su
  [licencia MIT](apps/sentinelia-web/src/public/vendor/bootstrap-icons/LICENSE).
- Las dependencias npm se declaran en `package.json` y se fijan en
  `package-lock.json`. `npm ci` instala sus licencias y avisos junto a
  cada paquete; deben conservarse al redistribuir las dependencias.
- La imagen de despliegue incorpora Node.js, Debian y BIND; MariaDB y Redis se
  ejecutan en imágenes separadas. Esos componentes conservan sus propias
  condiciones de distribución. El paquete fuente no incluye esas imágenes.

La landing y los instaladores de Attacus quedan fuera de esta distribución.
Attacus tiene licencia privada y su SDK se distribuye bajo MIT, según el
[modelo de licencias del proyecto](https://www.attacus.es/software-libre-autoalojado/).
La licencia de Sentinelia no se extiende a esos productos independientes.
