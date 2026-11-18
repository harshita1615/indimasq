"""IndiMasq: detect, mask and restore Indian PII before it reaches an LLM."""

from indimasq.indimasq import SYSTEM_PROMPT, IndiMasq
from indimasq.masking import MaskingSession, StreamUnmasker
from indimasq.types import Detection, EntityType

__all__ = [
    "SYSTEM_PROMPT",
    "Detection",
    "EntityType",
    "IndiMasq",
    "MaskingSession",
    "StreamUnmasker",
]
__version__ = "0.2.0"
