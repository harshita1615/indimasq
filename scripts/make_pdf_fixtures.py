"""Make the PDF test files for the extension's file checks.

    pip install pillow pypdf   # dev only; not Kavach dependencies
    python scripts/make_pdf_fixtures.py

extension/test/fixtures/sample.pdf is the Word fixture (sample.docx) exported
to PDF by Word. From it this script makes:
- locked.pdf: the same, protected with a password, as UIDAI's e-Aadhaar is;
- scanned.pdf: a page that is only a picture of text, with no text layer.
All values are made up.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter

FIXTURES = Path(__file__).resolve().parent.parent / "extension" / "test" / "fixtures"


def locked() -> None:
    writer = PdfWriter(clone_from=PdfReader(FIXTURES / "sample.pdf"))
    writer.encrypt(user_password="kavach-test", algorithm="AES-128")
    with open(FIXTURES / "locked.pdf", "wb") as f:
        writer.write(f)


def scanned() -> None:
    page = Image.new("RGB", (850, 1100), "white")
    draw = ImageDraw.Draw(page)
    try:
        font = ImageFont.truetype("arial.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    draw.text((60, 80), "SAMPLE scanned page (made-up data)", fill="black", font=font)
    draw.text((60, 140), "PAN ABCPE1234F", fill="black", font=font)
    page.save(FIXTURES / "scanned.pdf", "PDF", resolution=100)


if __name__ == "__main__":
    locked()
    scanned()
    for name in ("locked.pdf", "scanned.pdf"):
        print(f"wrote {(FIXTURES / name).relative_to(FIXTURES.parent.parent.parent)}")
