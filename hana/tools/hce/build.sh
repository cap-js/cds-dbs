#!/bin/bash
set -euo pipefail

# Resolve script directory so this works regardless of the caller's CWD
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

IMAGE=ghcr.io/cap-js/hana:latest

( cd "$SCRIPT_DIR" && ./update.sh )

docker build -t "$IMAGE" "$SCRIPT_DIR"
docker push "$IMAGE"

echo "$IMAGE"
