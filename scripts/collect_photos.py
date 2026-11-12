"""Produce self-hosted responsive WebP derivatives from curated Commons originals.

Run collect_photos.ps1 -MetadataOnly first. Then download the selected sources
recorded in docs/photo-catalog-selected.json to assets/photo-originals before
running this file with the bundled Python runtime (Pillow required).
"""
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PHOTO_DIR = ROOT / 'public' / 'photos'

def main():
    selected = json.loads((ROOT / 'docs/photo-catalog-selected.json').read_text(encoding='utf-8-sig'))
    manifest = []
    for photo in selected:
        source = ROOT / 'assets' / 'photo-originals' / photo['filename']
        if not source.exists():
            continue
        with Image.open(source) as original:
            original = ImageOps.exif_transpose(original).convert('RGB')
            variants = []
            for target in (600, 1200, 1600):
                width = min(original.width, target)
                height = round(original.height * width / original.width)
                dest = PHOTO_DIR / f"{photo['id']}-{target}.webp"
                original.resize((width, height), Image.Resampling.LANCZOS).save(dest, 'WEBP', quality=85, method=6)
                variants.append((dest, width, height))
            best = variants[-1]
            manifest.append({
                'id':photo['id'], 'src':f"/photos/{best[0].name}",
                'srcSet':', '.join(f'/photos/{p.name} {w}w' for p,w,h in variants if w == 600 or w == 1200 or (p,w,h) == best),
                'width':best[1], 'height':best[2], 'title':photo['title'].removeprefix('File:'),
                'caption':photo['caption'], 'year':photo['year'], 'creator':photo['creator'],
                'sourceUrl':photo['sourceUrl'], 'license':photo['license'], 'licenseUrl':photo['licenseUrl'],
                'changes':'Resized and converted to WebP. Display crops and grayscale are applied by the website.'
            })
    out = ROOT / 'src/data/photos.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Published {len(manifest)} photographs and responsive variants.')

if __name__ == '__main__':
    main()
