from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

root = Path(__file__).resolve().parents[1] / 'docs/screenshots'
views = [
    ('01-album-cover.jpg', '01  The album cover'),
    ('02-early-chapters.jpg', '02  The earlier pages'),
    ('03-remembered-moments.jpg', '03  Moments we remember'),
    ('04-through-the-years.jpg', '04  Through the years'),
    ('05-collective-portrait.jpg', '05  Built together'),
    ('06-your-piece-is-in.jpg', '06  Your piece is in'),
]
w, h, gap, header = 620, 625, 22, 48
sheet = Image.new('RGB', (w * 2 + gap * 3, (h + header) * 3 + gap * 4), '#e2e4d8')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 22)
for i, (filename, label) in enumerate(views):
    x = gap + (i % 2) * (w + gap)
    y = gap + (i // 2) * (h + header + gap)
    draw.text((x + 2, y + 6), label, fill='#252b23', font=font)
    shot = Image.open(root / filename).convert('RGB')
    shot = ImageOps.contain(shot, (w, h), Image.Resampling.LANCZOS)
    draw.rectangle((x, y + header, x + w, y + header + h), fill='#f4f0e6')
    sheet.paste(shot, (x + (w-shot.width)//2, y + header + (h-shot.height)//2))
sheet.save(root/'six-views.jpg', quality=92, optimize=True)
figures = ''.join(f'<figure><figcaption>{label}</figcaption><a href="{filename}"><img src="{filename}" alt="{label}" loading="lazy"></a></figure>' for filename,label in views)
(root/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Six views — Dear Jensen</title><style>body{margin:0;background:#f4f0e6;color:#252b23;font:16px Georgia,serif;padding:32px}main{max-width:1265px;margin:auto}h1{font-size:44px;font-weight:normal}p{line-height:1.6}figure{margin:48px 0}figcaption{margin-bottom:16px;font:16px sans-serif}img{width:100%;height:auto;border:1px solid #d4d6c9}a{color:#32642e}</style><main><h1>A farewell, built together.</h1><p>Six screenshots from the finished local page. Counts are local test records, not production visitors. Open an image for its full resolution.</p><p><a href="http://127.0.0.1:5173/">Open the interactive local page</a></p>''' + figures + '<p>Additional responsive checks: <a href="mobile-360.jpg">360px mobile</a> · <a href="tablet-768.jpg">768px tablet</a>.</p></main></html>', encoding='utf-8')
print('Created six-views.jpg and index.html.')
