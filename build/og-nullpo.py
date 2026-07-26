#!/usr/bin/env python3
"""Build img/og-nullpo.png, the site's social-preview card.

The old cat-tile image (img/og-image.png) is laid over a white 1200x630 canvas
at low opacity as a texture, softened further behind the middle of the card so
the nullpo ASCII art (img/nullpo.png) reads clearly. The art itself is scaled
up with nearest-neighbour, keeping the pixel art crisp.

    python3 build/og-nullpo.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "img"

CARD = (1200, 630)
OVERLAY_ALPHA = 0.45  # how strongly the cat tiles show through
VEIL_ALPHA = 0.50     # white wash behind the art, so the thin strokes stay legible
VEIL_PAD = 24         # how far the wash extends past the art, before blurring
NULLPO_SCALE = 3      # integer, so nearest-neighbour stays pixel-exact
INK = (28, 24, 32, 255)


def main() -> None:
    card = Image.new("RGBA", CARD, (255, 255, 255, 255))

    overlay = Image.open(IMG / "og-image.png").convert("RGBA").resize(CARD, Image.LANCZOS)
    overlay.putalpha(overlay.getchannel("A").point(lambda v: int(v * OVERLAY_ALPHA)))
    card.alpha_composite(overlay)

    # nullpo.png is opaque 1-bit art, so key out its white background: the ink
    # becomes the alpha channel and the tiles keep showing through around it.
    art = Image.open(IMG / "nullpo.png").convert("L")
    art = art.resize((art.width * NULLPO_SCALE, art.height * NULLPO_SCALE), Image.NEAREST)
    nullpo = Image.new("RGBA", art.size, INK)
    nullpo.putalpha(art.point(lambda v: 255 - v))
    at = ((CARD[0] - nullpo.width) // 2, (CARD[1] - nullpo.height) // 2)

    veil = Image.new("RGBA", CARD, (255, 255, 255, 0))
    ImageDraw.Draw(veil).rounded_rectangle(
        (at[0] - VEIL_PAD, at[1] - VEIL_PAD,
         at[0] + nullpo.width + VEIL_PAD, at[1] + nullpo.height + VEIL_PAD),
        radius=48,
        fill=(255, 255, 255, int(255 * VEIL_ALPHA)),
    )
    card.alpha_composite(veil.filter(ImageFilter.GaussianBlur(90)))

    card.alpha_composite(nullpo, at)

    out = IMG / "og-nullpo.png"
    card.convert("RGB").save(out, optimize=True)
    print(f"Wrote {out.relative_to(ROOT)} ({card.width}x{card.height})")


if __name__ == "__main__":
    main()
