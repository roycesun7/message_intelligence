"""
Export MobileCLIP-S2 to ONNX format for the Tauri app.

Usage:
    pip install open_clip_torch torch onnx transformers
    python scripts/export_mobileclip.py

Outputs:
    src-tauri/resources/models/mobileclip_s2_text.onnx
    src-tauri/resources/models/mobileclip_s2_vision.onnx
    src-tauri/resources/models/tokenizer.json
"""

import torch
import open_clip
import os

MODEL_NAME = "MobileCLIP-S2"
PRETRAINED = "datacompdr"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "resources", "models")

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Loading {MODEL_NAME}...")
    model, _, preprocess = open_clip.create_model_and_transforms(
        MODEL_NAME, pretrained=PRETRAINED
    )
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    model.eval()

    # Export text encoder
    print("Exporting text encoder...")
    dummy_text = tokenizer(["a photo of a cat"])
    # dummy_text is a tensor of shape [1, 77]

    class TextEncoder(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, input_ids, attention_mask):
            return self.model.encode_text(input_ids)

    text_encoder = TextEncoder(model)
    dummy_mask = torch.ones_like(dummy_text)

    torch.onnx.export(
        text_encoder,
        (dummy_text, dummy_mask),
        os.path.join(OUTPUT_DIR, "mobileclip_s2_text.onnx"),
        input_names=["input_ids", "attention_mask"],
        output_names=["embeddings"],
        dynamic_axes={
            "input_ids": {0: "batch_size"},
            "attention_mask": {0: "batch_size"},
            "embeddings": {0: "batch_size"},
        },
        opset_version=17,
    )
    print("  -> mobileclip_s2_text.onnx")

    # Export vision encoder
    print("Exporting vision encoder...")
    dummy_image = torch.randn(1, 3, 256, 256)

    class VisionEncoder(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, pixel_values):
            return self.model.encode_image(pixel_values)

    vision_encoder = VisionEncoder(model)
    torch.onnx.export(
        vision_encoder,
        (dummy_image,),
        os.path.join(OUTPUT_DIR, "mobileclip_s2_vision.onnx"),
        input_names=["pixel_values"],
        output_names=["embeddings"],
        dynamic_axes={
            "pixel_values": {0: "batch_size"},
            "embeddings": {0: "batch_size"},
        },
        opset_version=17,
    )
    print("  -> mobileclip_s2_vision.onnx")

    # Export tokenizer
    print("Exporting tokenizer...")
    # open_clip uses a SimpleTokenizer; we need to save it in HuggingFace format
    # For MobileCLIP, the tokenizer is CLIP-compatible
    from transformers import CLIPTokenizerFast
    hf_tokenizer = CLIPTokenizerFast.from_pretrained("openai/clip-vit-base-patch32")
    hf_tokenizer.model_max_length = 77
    hf_tokenizer.save_pretrained(OUTPUT_DIR)
    print("  -> tokenizer.json")

    print("Done! Models saved to", OUTPUT_DIR)

if __name__ == "__main__":
    main()
