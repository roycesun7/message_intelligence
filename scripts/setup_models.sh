#!/usr/bin/env bash
# Download MobileCLIP-S2 model files required for semantic search.
#
# Usage:
#   ./scripts/setup_models.sh
#
# This downloads:
#   1. Tokenizer files from HuggingFace (openai/clip-vit-base-patch32)
#   2. ONNX models via the Python export script (requires torch + open_clip)
#
# If you only need the tokenizer (e.g. already have the ONNX files),
# run with: ./scripts/setup_models.sh --tokenizer-only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODEL_DIR="$PROJECT_ROOT/src-tauri/resources/models"

HF_BASE="https://huggingface.co/openai/clip-vit-base-patch32/resolve/main"

TOKENIZER_FILES=(
  "tokenizer.json"
  "tokenizer_config.json"
  "vocab.json"
  "merges.txt"
  "special_tokens_map.json"
)

mkdir -p "$MODEL_DIR"

# ── Download tokenizer files ────────────────────────────────────────
echo "Downloading tokenizer files from HuggingFace..."
for file in "${TOKENIZER_FILES[@]}"; do
  if [ -f "$MODEL_DIR/$file" ]; then
    echo "  ✓ $file (already exists)"
  else
    echo "  ↓ $file"
    curl -sL "$HF_BASE/$file" -o "$MODEL_DIR/$file"
  fi
done

# ── Check / export ONNX models ─────────────────────────────────────
if [ "${1:-}" = "--tokenizer-only" ]; then
  echo ""
  echo "Done (tokenizer only). To generate ONNX models, run:"
  echo "  python scripts/export_mobileclip.py"
  exit 0
fi

TEXT_ONNX="$MODEL_DIR/mobileclip_s2_text.onnx"
VISION_ONNX="$MODEL_DIR/mobileclip_s2_vision.onnx"

if [ -f "$TEXT_ONNX" ] && [ -f "$VISION_ONNX" ]; then
  echo ""
  echo "✓ ONNX models already exist:"
  echo "  - mobileclip_s2_text.onnx ($(du -h "$TEXT_ONNX" | cut -f1))"
  echo "  - mobileclip_s2_vision.onnx ($(du -h "$VISION_ONNX" | cut -f1))"
else
  echo ""
  echo "ONNX models not found. Exporting from PyTorch..."
  echo "(Requires: pip install open_clip_torch torch onnx transformers)"
  echo ""
  python3 "$SCRIPT_DIR/export_mobileclip.py"
fi

echo ""
echo "All model files ready in $MODEL_DIR"
