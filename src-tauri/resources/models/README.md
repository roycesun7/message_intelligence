# CLIP Model Files

This directory holds MobileCLIP-S2 model files for semantic search.
These files are **not checked into git** — run the setup script to download them:

```bash
./scripts/setup_models.sh
```

Expected files after setup:
- `mobileclip_s2_text.onnx` — Text encoder (~242 MB)
- `mobileclip_s2_vision.onnx` — Vision encoder (~137 MB)
- `tokenizer.json`, `vocab.json`, `merges.txt` — Tokenizer files

If any are missing, semantic search is disabled (the app still works normally).
