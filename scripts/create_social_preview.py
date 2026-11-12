"""Compose a social card from a credited real photograph; no generative imagery."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
photos = json.loads((ROOT / 'src/data/photos.json').read_text(encoding='utf-8-sig'))
photo = next((p for p in photos if 'hero' in p['id']), next((p for p in photos if 'portrait' in p['id']), photos[0]))
canvas = Image.new('RGB', (1200, 630), '#F4F0E6')
draw = ImageDraw.Draw(canvas)
font_dir = Path('C:/Windows/Fonts')
serif = lambda size: ImageFont.truetype(str(font_dir / 'georgia.ttf'), size)
italic = lambda size: ImageFont.truetype(str(font_dir / 'georgiai.ttf'), size)
sans = lambda size: ImageFont.truetype(str(font_dir / 'segoeui.ttf'), size)
ink, green = '#252B23', '#32642E'
for x, y in [(64, 49), (78, 49), (64, 63)]:
    draw.rectangle((x, y, x + 9, y + 9), fill=green)
draw.rectangle((78, 63, 87, 72), outline=green)
draw.text((105, 46), 'DEAR JENSEN.', font=sans(20), fill=ink)
draw.text((64, 151), 'Thank you,', font=serif(77), fill=ink)
draw.text((62, 234), 'Jensen.', font=italic(103), fill=green)
draw.text((66, 385), 'For the worlds you', font=sans(27), fill=ink)
draw.text((66, 421), 'helped us build.', font=sans(27), fill=ink)
draw.line((64, 535, 535, 535), fill='#CBCDBE', width=1)
draw.text((64, 555), 'A FAREWELL, BUILT TOGETHER.', font=sans(16), fill=green)
image = Image.open(ROOT / 'public' / photo['src'].lstrip('/')).convert('RGB')
image = ImageOps.fit(image, (504, 500), centering=(.5, .35))
image = ImageOps.grayscale(image).convert('RGB')
canvas.paste(image, (632, 55))
draw.rectangle((621, 44, 1146, 566), outline='#D5D5C6', width=1)
credit = f"Photo: {photo['creator']} · {photo['license']}"
while draw.textlength(credit, font=sans(13)) > 505:
    credit = credit.rsplit(' ', 1)[0]
draw.text((632, 581), credit, font=sans(13), fill='#5C6655')
canvas.save(ROOT / 'public/social-preview.jpg', quality=90, optimize=True)
(ROOT / 'docs').mkdir(exist_ok=True)
(ROOT / 'docs/social-preview-credit.md').write_text(
    '# Social preview credit\n\n'
    + f"Photograph: [{photo['title']}]({photo['sourceUrl']}) by {photo['creator']}.\n\n"
    + f"License: [{photo['license']}]({photo['licenseUrl']}).\n\n"
    + 'Changes: cropped, resized, monochrome conversion, combined with original typography and layout. '
    + 'Where ShareAlike applies, this composite is offered under the same license linked above. '
    + 'No endorsement is implied.\n', encoding='utf-8'
)
print('Created public/social-preview.jpg (1200 × 630) and its credit record.')
