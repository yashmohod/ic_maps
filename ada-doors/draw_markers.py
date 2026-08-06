#!/usr/bin/env python3
"""Mark ADA push buttons with a high-contrast circle (ISA-style blue ring).

ADA/ISO access signage uses a circular International Symbol of Access field;
for photo callouts we ring the push plate rather than using a directional arrow.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
ORIG = ROOT / "original"
ANN = ROOT / "annotated"

# Approximate ADA/ISA field blue + white rim for contrast on photos
ADA_BLUE = (0, 61, 165)
WHITE = (255, 255, 255)


def draw_ada_circle(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float):
    """Concentric white + blue rings so the mark stays visible on any background."""
    for r, fill, width in (
        (radius + 4, WHITE, 5),
        (radius, ADA_BLUE, 6),
        (radius - 5, WHITE, 3),
    ):
        if r <= 2:
            continue
        bbox = [cx - r, cy - r, cx + r, cy + r]
        draw.ellipse(bbox, outline=fill, width=width)


def main():
    entries = json.loads((ROOT / "entrances.json").read_text())
    # Always start from clean originals
    n = 0
    skipped = 0
    for e in entries:
        src = ORIG / e["image"]
        if not src.exists():
            continue
        im = Image.open(src).convert("RGB")
        if e.get("adaButton") and e.get("buttonX") is not None and e.get("buttonY") is not None:
            w, h = im.size
            cx, cy = e["buttonX"] * w, e["buttonY"] * h
            radius = max(18, min(w, h) * 0.045)
            draw_ada_circle(ImageDraw.Draw(im), cx, cy, radius)
            e["annotatedImage"] = f"annotated/{e['image']}"
            n += 1
        else:
            e["annotatedImage"] = None
            skipped += 1
        im.save(ANN / e["image"], quality=92)

    (ROOT / "entrances.json").write_text(json.dumps(entries, indent=2) + "\n")
    print(f"Circled {n} ADA buttons; {skipped} without mark -> {ANN}")


if __name__ == "__main__":
    main()
