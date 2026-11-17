#!/usr/bin/env bash
# Fetch upstream Gen-HVAC code, the Sinergym simulation image and a local LLM.
set -euo pipefail
cd "$(dirname "$0")/.."

OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
SINERGYM_IMAGE="ghcr.io/ugr-sail/sinergym:2.4.0"

echo "==> Cloning Gen-HVAC from Hugging Face into vendor/gen-hvac"
if [ ! -d vendor/gen-hvac ]; then
  mkdir -p vendor
  git lfs install || echo "   (git-lfs not found: large checkpoints may not download)"
  git clone https://huggingface.co/Gen-HVAC/Controller vendor/gen-hvac
else
  echo "   already present, pulling latest"
  git -C vendor/gen-hvac pull --ff-only
fi

echo "==> Pulling Sinergym image ($SINERGYM_IMAGE)"
if command -v docker >/dev/null; then
  docker pull "$SINERGYM_IMAGE"
else
  echo "   Docker not installed - install it, then re-run"
fi

echo "==> Pulling Ollama model ($OLLAMA_MODEL)"
if command -v ollama >/dev/null; then
  ollama pull "$OLLAMA_MODEL"
else
  echo "   Ollama not installed - see https://ollama.com, then re-run"
fi

echo "Done. Next: read vendor/gen-hvac/README.md and update the payload notes in CLAUDE.md."
