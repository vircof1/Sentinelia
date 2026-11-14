#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../../../.env"
cd "${SCRIPT_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERROR: no existe ${ENV_FILE}" >&2
    exit 66
fi

docker compose --env-file "${ENV_FILE}" -f docker-compose.productivo.yml logs -f "$@"
