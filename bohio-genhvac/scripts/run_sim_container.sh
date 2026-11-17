#!/usr/bin/env bash
# Open a shell in the Sinergym/EnergyPlus container with this repo mounted at /workspace.
set -euo pipefail
cd "$(dirname "$0")/.."
docker run -it --rm \
  --name genhvac_container \
  -v "$(pwd)":/workspace \
  -w /workspace/vendor/gen-hvac \
  ghcr.io/ugr-sail/sinergym:2.4.0 \
  /bin/bash
