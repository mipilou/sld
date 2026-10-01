from PIL import Image, ImageDraw, ImageFont
import os
os.makedirs("icons", exist_ok=True)
BG, GOLD, INK = (15, 61, 62), (240, 199, 94), (22, 54, 55)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def icon(size, full_bleed, badge):
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if full_bleed: d.rectangle([0, 0, S, S], fill=BG)
    else: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * .22), fill=BG)
    b = int(S * badge); x = (S - b) // 2
    d.rounded_rectangle([x, x, x + b, x + b], radius=int(b * .26), fill=GOLD)
    try: f = ImageFont.truetype(FONT, int(b * .52))
    except OSError: f = ImageFont.load_default()
    d.text((S / 2, S / 2), "GD", font=f, fill=INK, anchor="mm")
    return im.resize((size, size), Image.LANCZOS)

icon(192, False, .62).save("icons/icon-192.png")
icon(512, False, .62).save("icons/icon-512.png")
icon(512, True, .50).save("icons/icon-maskable-512.png")
icon(180, True, .60).convert("RGB").save("icons/apple-touch-icon.png")
icon(32, False, .70).save("icons/favicon-32.png")
