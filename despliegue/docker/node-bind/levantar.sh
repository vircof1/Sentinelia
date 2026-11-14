#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../../../.env"
ENV_TEMPLATE="${SCRIPT_DIR}/../../../.env.ejemplo"
cd "${SCRIPT_DIR}"

echo "==> Preparando garantías de la instalación..."
node "${SCRIPT_DIR}/preparar-entorno.mjs" "${ENV_FILE}" "${ENV_TEMPLATE}"

compose=(docker compose --env-file "${ENV_FILE}" -f docker-compose.productivo.yml)

echo "==> Validando compose..."
"${compose[@]}" config --quiet

echo "==> Construyendo imagen..."
"${compose[@]}" build app

echo "==> Levantando servicios..."
if ! "${compose[@]}" up -d --wait --wait-timeout "${SENTINELIA_ARRANQUE_TIMEOUT:-120}"; then
    echo "ERROR: los servicios no alcanzaron un estado saludable." >&2
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --no-color --tail=120 app >&2 || true
    exit 1
fi

echo
echo "==> Estado:"
"${compose[@]}" ps

echo
echo "==> Arranque verificado. Para seguir los logs: ./logs.sh"
