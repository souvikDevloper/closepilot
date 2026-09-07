"""Encode a stepped README tour from actual browser screenshots (requires Pillow)."""
from pathlib import Path
from PIL import Image

media = Path(__file__).resolve().parents[1] / "docs" / "media"
names = ["data-lab", "overview", "decisions", "architecture"]
frames = []
for name in names:
    with Image.open(media / f"{name}.png") as source:
        frame = source.convert("RGB")
        frame.thumbnail((1200, 800), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (1200, 800), "#0b0f14")
        canvas.paste(frame, ((1200-frame.width)//2, (800-frame.height)//2))
        frames.append(canvas.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
frames[0].save(media / "workspace-tour.gif", save_all=True, append_images=frames[1:],
               duration=[2800, 3200, 2800, 3200], loop=0, optimize=False, disposal=2)
with Image.open(media / "workspace-tour.gif") as result:
    assert result.n_frames == 4
    assert result.size == (1200, 800)
print("Verified four-frame README tour; static PNG alternatives are retained.")
