#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--confirmar" ]]; then
    cat >&2 <<'EOF'
Este script modifica la resolución DNS del HOST, no la del contenedor.
Úsalo únicamente si systemd-resolved ocupa el puerto 53 y NetworkManager
gestiona la red de este servidor.

Para confirmar explícitamente: ./disable-systemd-resolved.sh --confirmar
EOF
    exit 64
fi

command -v systemctl >/dev/null || { echo "ERROR: systemctl no está disponible." >&2; exit 69; }
command -v nmcli >/dev/null || { echo "ERROR: NetworkManager no está disponible." >&2; exit 69; }

echo "==> Deshabilitando systemd-resolved..."

sudo systemctl disable --now systemd-resolved || true
sudo systemctl mask systemd-resolved || true

echo "==> Configurando NetworkManager para no usar systemd-resolved..."

sudo mkdir -p /etc/NetworkManager/conf.d

sudo tee /etc/NetworkManager/conf.d/90-dns-none.conf >/dev/null <<'EOF'
[main]
dns=none
systemd-resolved=false
EOF

echo "==> Recreando /etc/resolv.conf..."

sudo rm -f /etc/resolv.conf

sudo tee /etc/resolv.conf >/dev/null <<'EOF'
# Generado manualmente
nameserver 1.1.1.1
nameserver 1.0.0.1
nameserver 8.8.8.8
nameserver 8.8.4.4

options timeout:2 attempts:3 rotate
EOF

echo "==> Reiniciando NetworkManager..."

sudo systemctl restart NetworkManager

echo
echo "==========================================="
echo "Estado del puerto 53:"
sudo ss -lntup '( sport = :53 )' || true

echo
echo "Contenido de /etc/resolv.conf:"
cat /etc/resolv.conf

echo
echo "Prueba de resolución DNS:"
getent hosts google.com || true

echo
echo "Prueba de conectividad:"
ping -c2 1.1.1.1 || true
ping -c2 google.com || true

echo
echo "Hecho."
echo "El puerto 53 debería estar libre para Docker/BIND."
