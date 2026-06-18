import os
import torch
import numpy as np
import json
from PIL import Image

class UVPainterNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "painter_data": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
            }
        }

    RETURN_TYPES = ("MASK", "STRING", "IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("MASK_BATCH", "PROMPT_LIST", "CAVITY_MAP", "NORMAL_MAP", "CANNY_SKETCH")
    FUNCTION = "process_uv_data"
    CATEGORY = "Yedp/Texture" 

    def process_uv_data(self, painter_data, image=None):
        import base64
        import io
        from PIL import Image

        try:
            data = json.loads(painter_data)
        except Exception:
            data = {}

        width, height = 1024, 1024
        
        # Default empty tensors
        mask_tensor = torch.zeros((1, height, width), dtype=torch.float32)
        sketch_tensor = torch.zeros((1, height, width, 3), dtype=torch.float32)
        cavity_tensor = torch.zeros((1, height, width, 3), dtype=torch.float32)
        combined_prompts = ""

        layers = data.get("layers", [])
        if layers:
            mask_list = []
            sketch_list = []
            prompt_list = []
            
            for layer in layers:
                # 1. Decode Mask (Grayscale)
                if "mask" in layer and layer["mask"]:
                    try:
                        img_data = base64.b64decode(layer["mask"].split(",")[1])
                        img = Image.open(io.BytesIO(img_data)).convert("L")
                        img = img.resize((width, height))
                        m_tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0).unsqueeze(0)
                        mask_list.append(m_tensor)
                        
                        prompt_text = layer.get("prompt", "").strip()
                        prompt_list.append(prompt_text)
                    except Exception as e:
                        print(f"Error decoding mask: {e}")

                # 2. Decode Sketch (RGB for ControlNet)
                if "sketch" in layer and layer["sketch"]:
                    try:
                        img_data = base64.b64decode(layer["sketch"].split(",")[1])
                        img = Image.open(io.BytesIO(img_data)).convert("RGB")
                        img = img.resize((width, height))
                        s_tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0).unsqueeze(0)
                        sketch_list.append(s_tensor)
                    except Exception as e:
                        print(f"Error decoding sketch: {e}")


            
            # Batch the lists into multi-dimensional tensors
            if mask_list:
                mask_tensor = torch.cat(mask_list, dim=0)
            if sketch_list:
                sketch_tensor = torch.cat(sketch_list, dim=0)
            
            if prompt_list:
                combined_prompts = "\n---\n".join(prompt_list)

        import torch.nn.functional as F

        # Apply dilation filter to pad mask edges
        mask_tensor = F.max_pool2d(mask_tensor.unsqueeze(1), kernel_size=5, stride=1, padding=2).squeeze(1)

        normal_tensor = torch.zeros((1, height, width, 3), dtype=torch.float32)
        normal_tensor[..., 0] = 0.5
        normal_tensor[..., 1] = 0.5
        normal_tensor[..., 2] = 1.0

        # Process Cavity Map
        if "cavity" in data and data["cavity"]:
            try:
                img_data = base64.b64decode(data["cavity"].split(",")[1])
                img = Image.open(io.BytesIO(img_data)).convert("RGB")
                img = img.resize((width, height))
                cavity_tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0).unsqueeze(0)
                
                # --- Normal Generation Math ---
                gray = cavity_tensor.mean(dim=-1, keepdim=True).permute(0, 3, 1, 2)
                
                sobel_x = torch.tensor([[-1.0, 0.0, 1.0],
                                        [-2.0, 0.0, 2.0],
                                        [-1.0, 0.0, 1.0]], dtype=torch.float32).view(1, 1, 3, 3)
                
                sobel_y = torch.tensor([[-1.0, -2.0, -1.0],
                                        [ 0.0,  0.0,  0.0],
                                        [ 1.0,  2.0,  1.0]], dtype=torch.float32).view(1, 1, 3, 3)
                
                gray_padded = F.pad(gray, (1, 1, 1, 1), mode='replicate')
                grad_x = F.conv2d(gray_padded, sobel_x).permute(0, 2, 3, 1)
                grad_y = F.conv2d(gray_padded, sobel_y).permute(0, 2, 3, 1)
                
                grad_z = torch.ones_like(grad_x)
                
                normals = torch.cat([grad_x, grad_y, grad_z], dim=-1)
                normals = F.normalize(normals, p=2, dim=-1)
                
                normal_tensor = (normals + 1.0) * 0.5
                
            except Exception as e:
                print(f"Error decoding cavity map or generating normal map: {e}")

        # CRITICAL FIX: Return all 5 variables exactly matching RETURN_NAMES order
        return (mask_tensor, combined_prompts, cavity_tensor, normal_tensor, sketch_tensor)

class YedpAutoConditioner:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "clip": ("CLIP", ),
                "batched_masks": ("MASK", ),
                "prompt_list": ("STRING", {"forceInput": True}),
            }
        }
    
    RETURN_TYPES = ("CONDITIONING", )
    RETURN_NAMES = ("COMBINED_CONDITIONING", )
    FUNCTION = "process"
    CATEGORY = "Yedp/Texture"

    def process(self, clip, batched_masks, prompt_list):
        prompts = prompt_list.split("\n---\n")
        
        master_conditioning = []
        
        for i, prompt in enumerate(prompts):
            prompt = prompt.strip()
            if not prompt:
                continue
            
            tokens = clip.tokenize(prompt)
            cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)
            
            if i < batched_masks.shape[0]:
                mask = batched_masks[i:i+1]
            else:
                mask = torch.zeros_like(batched_masks[0:1])
                
            cond_dict = {
                "pooled_output": pooled,
                "mask": mask,
                "set_area_to_bounds": False
            }
            
            master_conditioning.append([cond, cond_dict])
            
        return (master_conditioning, )
