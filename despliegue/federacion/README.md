# Despliegue federado autogestionado

Sentinelia sirve HTTP y no termina TLS. El dueño del portal debe colocar delante
un reverse proxy HTTPS no comprometido y comunicarlo con Sentinelia mediante una
red privada de confianza. Esa frontera es una invariante operativa del
despliegue, no una propiedad que Sentinelia pueda supervisar.

El Compose canónico publica el portal en `127.0.0.1:3001` por defecto. No cambies
`WEB_BIND_ADDRESS` a una interfaz pública. La plantilla
[`nginx/sentinelia.conf.example`](nginx/sentinelia.conf.example) corresponde a
nginx ejecutado en el mismo host. Si nginx vive en otro contenedor o salto, debe
existir una red privada equivalente y `PORTAL_PROXIES_REVERSOS_CONFIABLES` debe
contener la dirección o CIDR del salto inmediato que Sentinelia observa, no un
nombre DNS ni la dirección pública del usuario.

## Preparación

1. Copia `.env.ejemplo` a un archivo no versionado y completa SQL, Redis, sesión
   y administrador. El Compose recibe el archivo mediante
   `SENTINELIA_ENV_FILE` y conserva MariaDB y Redis en volúmenes persistentes.
2. Mantén `FEDERACION_ACTIVA=false` durante el primer arranque. Define el origen
   HTTPS canónico y el proxy inicial mediante el entorno; esas entradas solo
   siembran SQL cuando todavía no existen. Después se administran de forma
   auditable desde `/configuracion` y SQL pasa a ser la autoridad.
3. Genera fuera del repositorio una clave aleatoria de 256 bits, por ejemplo con
   `openssl rand -base64 32`, y construye un keyring JSON. Configura juntos
   `FEDERACION_KEYRING`, `FEDERACION_KEY_ID_ACTIVA` y
   `FEDERACION_KEYRING_REFERENCIA`. El material secreto nunca se guarda en SQL
   ni se introduce en `/configuracion`; allí solo vive su referencia opaca.
4. Adapta la plantilla nginx, instala el certificado y valida la configuración
   con `nginx -t`. Nginx debe reemplazar las cabeceras reenviadas recibidas del
   cliente. Sentinelia solo acepta el protocolo exterior declarado cuando toda
   la cadena intermedia pertenece a la lista persistida de proxies confiables.
   El `map` incluido conserva únicamente el upgrade WebSocket necesario para el
   portal y el plano federado; la plantilla debe incluirse en el contexto
   `http` de nginx.
5. Arranca `docker compose -f despliegue/docker/node-bind/docker-compose.productivo.yml up -d`.
   Tras el primer bootstrap, ejecuta `npm run federacion:diagnosticar-despliegue`
   dentro de la misma versión y entorno que web/runtime. El comando es de solo
   lectura sobre el dominio ya instalado y no imprime orígenes, identificadores,
   referencias ni ids de clave.
6. Revisa `/configuracion`, activa federación de forma deliberada y repite el
   diagnóstico. La activación exige origen HTTPS, al menos un proxy aplicable,
   SQL en UTC, Redis operativo y el keyring desplegado.

El diagnóstico termina con `DIAGNOSTICO_DESPLIEGUE_OK` y un resumen saneado. Un
fallo solo publica un código de etapa estable; los detalles se investigan en el
subsistema indicado sin volcar variables de entorno o causas potencialmente
sensibles al log.

## Copias y recuperación

- Respalda conjuntamente SQL y el keyring externo, pero almacénalos y controla
  su acceso por separado. Conserva todas las claves que todavía aparezcan en el
  inventario de sobres; cambiar la clave activa no autoriza retirar las antiguas.
- Una restauración legítima conserva el `installationId` de SQL. Redis puede
  reconstruir coordinación, presencia y sesiones efímeras, por lo que su pérdida
  no autoriza recrear ni copiar la identidad durable. Después de restaurar,
  arranca una sola réplica, ejecuta el diagnóstico y solo entonces reincorpora
  web/runtime y las relaciones.
- Restaurar la misma copia SQL en dos instalaciones simultáneas crea un posible
  clon. No se resuelve modificando ids a mano: deben detenerse las instancias,
  decidir cuál conserva la identidad y aplicar el flujo explícito de recuperación
  o resincronización en la otra.
- Perder una clave histórica mientras quedan sobres cifrados es un fallo
  terminal de despliegue. El bootstrap también lo rechaza con federación
  desactivada; desactivar no convierte datos cifrados en prescindibles.
- Los enlaces de recuperación federada renuevan autoridad entre dos instancias;
  no sustituyen la copia de SQL, la custodia del keyring ni el aislamiento de la
  red privada.

El operador es responsable de certificados, nginx, firewall, red privada,
permisos del archivo de entorno, copias y custodia externa. Sentinelia valida la
configuración que puede observar y rechaza una frontera incoherente, pero no
promete detectar un proxy o una red ya comprometidos.
