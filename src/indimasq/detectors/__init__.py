"""Entity detectors. Each finds and validates one entity type."""

from indimasq.detectors.aadhaar import AadhaarDetector
from indimasq.detectors.bank import BankAccountDetector
from indimasq.detectors.base import Detector
from indimasq.detectors.email import EmailDetector
from indimasq.detectors.gstin import GstinDetector
from indimasq.detectors.ifsc import IfscDetector
from indimasq.detectors.pan import PanDetector
from indimasq.detectors.phone import PhoneDetector
from indimasq.detectors.upi import UpiDetector

ALL_DETECTORS: tuple[type[Detector], ...] = (
    AadhaarDetector,
    PanDetector,
    UpiDetector,
    IfscDetector,
    BankAccountDetector,
    PhoneDetector,
    GstinDetector,
    EmailDetector,
)

__all__ = [
    "ALL_DETECTORS",
    "AadhaarDetector",
    "BankAccountDetector",
    "Detector",
    "EmailDetector",
    "GstinDetector",
    "IfscDetector",
    "PanDetector",
    "PhoneDetector",
    "UpiDetector",
]
