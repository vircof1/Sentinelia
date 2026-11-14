#!/bin/sh
set -eu

for legacy in \
  DNS_RUTA_INCLUDE_GESTIONADO \
  DNS_DIRECTORIO_ZONAS \
  DNS_COMANDO_RECARGA \
  DNS_COMANDO_CHECKCONF \
  DNS_COMANDO_CHECKZONE
do
  eval "valor=\${$legacy-}"
  if [ -n "$valor" ]; then
    printf 'Variable obsoleta %s detectada. El despliegue DNS 5.21 usa BIND_*.\n' "$legacy" >&2
    exit 64
  fi
done

mkdir -p /var/lib/sentinelia/bind/artefactos
mkdir -p /etc/bind/sentinelia-zonas
mkdir -p "$(dirname "${BIND_SELECTOR_ACTIVO:-/etc/bind/sentinelia-selector.conf}")"
mkdir -p "$(dirname "${BIND_LOCK_FILE:-/var/lib/sentinelia/bind/publicacion.lock}")"
mkdir -p "$(dirname "${BIND_NAMED_CONF_ACTIVO:-/etc/bind/sentinelia-root.conf}")"

touch "${BIND_LOCK_FILE:-/var/lib/sentinelia/bind/publicacion.lock}"
chmod 0640 "${BIND_LOCK_FILE:-/var/lib/sentinelia/bind/publicacion.lock}"

if [ ! -f "${BIND_NAMED_CONF_ACTIVO:-/etc/bind/sentinelia-root.conf}" ]; then
  {
    printf '// sentinelia-bind-root-v1\n'
    printf 'include "%s";\n' "${BIND_SELECTOR_ACTIVO:-/etc/bind/sentinelia-selector.conf}"
  } > "${BIND_NAMED_CONF_ACTIVO:-/etc/bind/sentinelia-root.conf}"
fi

mkdir -p /run/named
RNDC_KEY=/etc/bind/rndc.key
RNDC_BOOTSTRAP=/etc/bind/.sentinelia-rndc-bootstrap-v1
# Una interrupción abrupta (por ejemplo, SIGKILL) puede impedir que el trap
# elimine el temporal. Solo se purgan temporales creados por este bootstrap.
find /etc/bind -maxdepth 1 -type f -name '.rndc.key.*' -exec rm -f -- {} +
if [ ! -f "$RNDC_BOOTSTRAP" ]; then
  RNDC_TEMP="$(mktemp /etc/bind/.rndc.key.XXXXXX)"
  limpiar_rndc_temporal() {
    rm -f "$RNDC_TEMP"
  }
  trap limpiar_rndc_temporal EXIT HUP INT TERM
  rndc-confgen -a -A hmac-sha256 -b 256 -c "$RNDC_TEMP" -k rndc-key
  chown root:root "$RNDC_TEMP"
  chmod 0600 "$RNDC_TEMP"
  mv -f "$RNDC_TEMP" "$RNDC_KEY"
  : > "$RNDC_BOOTSTRAP"
  chmod 0600 "$RNDC_BOOTSTRAP"
  trap - EXIT HUP INT TERM
  printf 'Clave RNDC propia de la instalación materializada.\n'
fi
install -o root -g root -m 0600 /etc/bind/rndc.key /run/named/sentinelia-rndc.key

CONTROL_RNDC=/etc/bind/sentinelia-rndc-controls.conf
{
  printf '// Control local autenticado para el publicador Sentinelia.\n'
  printf 'include "/run/named/sentinelia-rndc.key";\n'
  printf 'controls { inet 127.0.0.1 port 953 allow { 127.0.0.1; } keys { "rndc-key"; }; };\n'
} > "$CONTROL_RNDC"

# Migra únicamente el root gestionado por Sentinelia; una configuración
# personalizada nunca se modifica implícitamente.
if grep -q '^// sentinelia-bind-root-v1$' "${BIND_NAMED_CONF_ACTIVO:-/etc/bind/sentinelia-root.conf}" \
  && ! grep -q 'sentinelia-rndc-controls.conf' "${BIND_NAMED_CONF_ACTIVO:-/etc/bind/sentinelia-root.conf}"; then
  printf 'include "%s";\n' "$CONTROL_RNDC" >> "${BIND_NAMED_CONF_ACTIVO:-/etc/bind/sentinelia-root.conf}"
fi

if [ ! -f /etc/bind/sentinelia-zonas/sentinelia-zones.conf ]; then
  {
    printf '// Archivo gestionado por Sentinelia. No editar manualmente.\n'
    printf '\n'
  } > /etc/bind/sentinelia-zonas/sentinelia-zones.conf
fi

if [ ! -f /etc/bind/sentinelia.named.conf ]; then
  {
    printf '// Archivo gestionado por Sentinelia. No editar manualmente.\n'
    printf 'include "/etc/bind/sentinelia-zonas/sentinelia-zones.conf";\n'
  } > /etc/bind/sentinelia.named.conf
fi

if [ ! -f "${BIND_SELECTOR_ACTIVO:-/etc/bind/sentinelia-selector.conf}" ]; then
  {
    printf '// sentinelia-bind-selector-bootstrap-v1\n'
    printf 'include "/etc/bind/sentinelia.named.conf";\n'
  } > "${BIND_SELECTOR_ACTIVO:-/etc/bind/sentinelia-selector.conf}"
fi

named-checkconf "${BIND_NAMED_CONF_ACTIVO:-/etc/bind/sentinelia-root.conf}"

exec "$@"
