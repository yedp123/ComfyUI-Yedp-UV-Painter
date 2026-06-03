from .uv_painter_node import UVPainterNode, YedpAutoConditioner

NODE_CLASS_MAPPINGS = {
    "YedpUVPainter": UVPainterNode,
    "YedpAutoConditioner": YedpAutoConditioner,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "YedpUVPainter": "💠 Yedp UV Painter",
    "YedpAutoConditioner": "💠 Yedp Auto Conditioner",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]