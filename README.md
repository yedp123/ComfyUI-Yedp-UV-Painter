<img width="1920" height="1080" alt="f803ca6fe145b4163c52a4410749101a" src="https://github.com/user-attachments/assets/59d778fb-4d2a-40e2-9119-f9929602034b" />
<img width="1006" height="785" alt="image" src="https://github.com/user-attachments/assets/0770f4f5-e715-4c1f-8f9b-cd40812d5cf4" />


[Sample Workflow](https://drive.usercontent.google.com/u/0/uc?id=1q6A9L57v3shlbeKGwOD2DMzarYxlQda-&export=download)


# 🎨 ComfyUI Yedp UV Painter

An experimental, non-destructive 3D-to-2D AI texturing node for ComfyUI. 

This custom node bridges professional 3D pipelines with AI image generation directly inside the ComfyUI browser interface. Built with a focus on layer-based workflows and strict memory management, it allows you to surgically texture complex multi-mesh 3D models using an SDXL stack on a modest 8GB VRAM GPU.

---

## ✨ Features

* **Non-Destructive Generation Stack:** Treat your AI texturing like Photoshop layers. Generate a belt, then a pauldron, then skin, all independently. Toggle visibility, reroll specific parts, and composite the final result.
* **Live 3D Canny Preview:** Switch to the Sketch tool, draw hard-surface details (like armor seams or buckles) directly onto the 2D UV map, and see the lines project onto the 3D geometry in real-time.
* **Multi-Mesh Support:** Accurately hover, select, and isolate specific UV islands or faces with multiple sub-meshes.
* **Automated Regional Prompting:** The built-in `Yedp Auto Conditioner` automatically pairs your text prompts with the correct UV geometry masks, eliminating "spaghetti graph" routing.
* **8GB VRAM Optimized:** Utilizes Just-In-Time (JIT) rendering. Vector strokes and geometry masks are only rasterized into Base64 composites at the exact moment of execution to prevent browser memory crashes.

---

## 🚀 Installation

1. Navigate to your ComfyUI custom nodes folder in your terminal:
   `cd ComfyUI/custom_nodes`

2. Clone this repository:
   `git clone https://github.com/yedp123/ComfyUI-Yedp-UV-Painter.git`

3. Restart ComfyUI. The nodes will be available under the `Yedp/Texture` category.

---

## 📦 Required Models (The 8GB VRAM Stack)

To keep SDXL from crashing consumer GPUs while running this pipeline, the following models are highly recommended:

* **Base Model (GGUF UNet):** [SDXL-juggernautXL-Q5_K_M.gguf](https://huggingface.co/hum-ma/SDXL-models-GGUF/resolve/main/juggernautXL_juggXIByRundiffusion-Q5_K_M.gguf?download=true)
* **ControlNet:** [controlnet++_union_sdxl.safetensors](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/tree/main) (Handles the Canny Sketch routing in one model)
* **VAE (FP16 Fix):** [sdxl_vae_fp16.safetensors](https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/tree/main) (Strictly required to prevent "black image" crashes)
* **Text Encoders:** [clip_g.safetensors](https://huggingface.co/second-state/stable-diffusion-3.5-large-GGUF/blob/dff185441d61601155591a46f691d7f73151acdd/clip_g.safetensors) & [clip_l.safetensors](https://huggingface.co/hum-ma/SDXL-models-GGUF/blob/7e15380138e7069ca3aaef5bf0401c3406e3a593/clip_l.safetensors)

---

## 🛠️ How to Use

1. **Load your Mesh:** Drop the `Yedp UV Painter` node into your graph and load your 3D model (FBX/OBJ/GLTF).
2. **Select UVs:** Use the `Select (Mask)` tool to click UV islands or 3D faces to isolate a specific material zone.
3. **Add a Prompt:** Name the layer (e.g., "Leather Belt") and type your generation prompt.
4. **Draw Details (Optional):** Switch to the `Draw (Canny)` tool to sketch custom structural lines.
5. **Queue Prompt:** Hit generate. The resulting texture will appear in the **Gen Stack** tab.
6. **Composite & Export:** Repeat for other layers, use the Gen Stack to lock or hide layers, and click **Export Final Texture** to download your game-ready PNG.

---

## ⚠️ Current Limitations (Experimental Status)

This is a "lab-built" tool currently in its V1 MVP stage. 
* **UDIMs are not supported:** The system relies on standard 0-1 UV coordinate space.
* **Microscopic UV Islands:** Due to SDXL VAE compression (8x8 blocks), extremely tiny or fragmented UV islands may sometimes be ignored by the AI. Ensure good UV packing practices!
* **Transparent Unpainted Areas:** Areas of the 3D mesh that have not yet been assigned a generation layer will display as a solid gray base-coat in the final composite.

