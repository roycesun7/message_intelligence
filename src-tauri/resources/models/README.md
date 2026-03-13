# CLIP Model Files

Place the following MobileCLIP-S2 model files in this directory:

- `mobileclip_s2_text.onnx` — Text encoder ONNX model
- `mobileclip_s2_vision.onnx` — Vision (image) encoder ONNX model
- `tokenizer.json` — HuggingFace tokenizer configuration

These files are loaded at app startup. If any are missing, semantic search
will be disabled (the app still functions normally without them).

See the export script in the project root for instructions on generating
these files from the MobileCLIP-S2 PyTorch model.
