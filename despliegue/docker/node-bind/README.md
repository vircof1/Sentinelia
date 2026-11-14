# Despliegue canónico NodeJS + BIND

Este directorio contiene el contrato productivo de despliegue DNS `5.21`.

Puntos normativos:

- la imagen instala código y dependencias con `npm ci --omit=dev`;
- el Compose productivo no monta `/app` ni `/app/node_modules`;
- los artefactos BIND viven fuera de `/app`, bajo `/var/lib/sentinelia/bind`;
- la configuración activa de `named` es `/etc/bind/sentinelia-root.conf`;
- `named` arranca siempre como infraestructura del contenedor; `DNS_ACTIVO`
  solo define el estado funcional inicial cuando todavía no existe un valor
  persistido y la activación posterior se gobierna desde el portal;
- el selector regular `sentinelia-selector.conf` es el único marcador de
  generación activa;
- `named`, `named-checkconf`, `named-checkzone` y `rndc` se invocan como
  ejecutable + argumentos, sin shell;
- las variables legacy `DNS_RUTA_*` y `DNS_COMANDO_*` no forman parte de este
  despliegue.
- la eliminación administrativa directa de agentes permanece apagada en el
  override de desarrollo; la web solo publica ruta y botón después de comprobar
  las migraciones, postcondiciones y todas las presencias runtime vivas contra
  las capacidades empaquetadas en esta instalación;
- para un rollback funcional basta devolver
  `AGENTES_ELIMINACION_ADMINISTRATIVA_HTTP_HABILITADA` a `false`: se cierra la
  superficie HTTP, mientras el runtime compatible conserva el drenado de
  operaciones que ya fueran aceptadas;
- la eliminación organizativa forma parte obligatoria de la plataforma actual:
  no posee perfil de compatibilidad ni feature flag. El arranque exige las
  migraciones, sus postcondiciones y unanimidad de las capacidades web y runtime
  empaquetadas antes de publicar sus rutas.
- DDNS de agentes queda solicitado por defecto en el Compose productivo
  mediante `AGENTES_DDNS_HABILITADO=true`, una vez materializada la serie
  `5.28`. Para una actualización se despliegan primero todos los runtimes y
  webs compatibles y se retiran las webs anteriores del balanceo; la puerta
  efectiva solo se abre después de demostrar la compatibilidad unánime.
  La puerta exige migraciones y postcondiciones, unanimidad runtime del perfil
  DDNS y del publicador BIND coordinado, y reconciliación inicial DNS satisfecha;
  si alguna precondición falla, el resto de Sentinelia arranca con API, UI,
  causas `POL` y capacidad `dynamic_dns` cerradas.
- El rollback funcional se realiza fijando explícitamente
  `AGENTES_DDNS_HABILITADO=false`; no revierte datos ni trabajo ya aceptado.

El override `docker-compose.desarrollo.yml` puede montar `/app` para desarrollo
local. No debe usarse como Compose productivo.

Para desplegar únicamente cambios en los binarios de Sentinelia se utiliza
`./reload.sh`. El script reconstruye la imagen `app` aprovechando la caché de
Docker y sustituye exclusivamente `sentinelia-app`; no recrea MariaDB ni Redis.
`./rebuild.sh` conserva su función de reconstrucción completa sin caché.

La extensión federada `5.22` mantiene el HTTP de Sentinelia fuera de la red
pública y delega TLS en un reverse proxy de confianza. El procedimiento
autodesplegable, la plantilla nginx, el preflight y la recuperación se describen
en [`../../federacion/README.md`](../../federacion/README.md).
