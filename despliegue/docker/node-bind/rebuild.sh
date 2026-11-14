#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../../../.env"
ENV_TEMPLATE="${SCRIPT_DIR}/../../../.env.ejemplo"
cd "${SCRIPT_DIR}"

echo "==> Preparando garantías de la instalación..."
node "${SCRIPT_DIR}/preparar-entorno.mjs" "${ENV_FILE}" "${ENV_TEMPLATE}"

compose=(docker compose --env-file "${ENV_FILE}" -f docker-compose.productivo.yml)

"${compose[@]}" config --quiet

echo "==> Construyendo antes de sustituir el contenedor activo..."
"${compose[@]}" build --no-cache app

echo "==> Recreando y esperando salud; los volúmenes no se eliminan..."
if ! "${compose[@]}" up -d --force-recreate --wait --wait-timeout "${SENTINELIA_ARRANQUE_TIMEOUT:-120}"; then
    echo "ERROR: el despliegue reconstruido no quedó saludable." >&2
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --no-color --tail=120 app >&2 || true
    exit 1
fi

"${compose[@]}" ps
