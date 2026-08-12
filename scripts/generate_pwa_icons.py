from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "assets" / "icons"
FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\simhei.ttf"),
    Path(r"C:\Windows\Fonts\msyhbd.ttc"),
    Path(r"C:\Windows\Fonts\simsun.ttc"),
]


def font_for(size: int):
    font_path = next((path for path in FONT_CANDIDATES if path.is_file()), None)
    return ImageFont.truetype(str(font_path), size) if font_path else ImageFont.load_default(size=size)


def create_icon(size: int, filename: str, maskable: bool = False):
    scale = size / 512
    image = Image.new("RGB", (size, size), "#176b63")
    draw = ImageDraw.Draw(image)
    margin = round((92 if maskable else 64) * scale)
    radius = round(44 * scale)
    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=radius,
        fill="#fffaf2",
    )
    inset = round(32 * scale)
    draw.line(
        (margin + inset, margin + round(52 * scale), size - margin - inset, margin + round(52 * scale)),
        fill="#a94f37",
        width=max(3, round(11 * scale)),
    )
    draw.line(
        (margin + inset, size - margin - round(52 * scale), size - margin - inset, size - margin - round(52 * scale)),
        fill="#a94f37",
        width=max(3, round(11 * scale)),
    )
    font = font_for(round((190 if not maskable else 164) * scale))
    box = draw.textbbox((0, 0), "缠", font=font)
    x = (size - (box[2] - box[0])) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), "缠", fill="#a94f37", font=font)
    image.save(ICON_DIR / filename, optimize=True)


def main():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    create_icon(180, "icon-180.png")
    create_icon(192, "icon-192.png")
    create_icon(512, "icon-512.png")
    create_icon(512, "icon-maskable-512.png", maskable=True)


if __name__ == "__main__":
    main()
