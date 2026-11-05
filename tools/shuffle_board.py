# Render shuffled looks (front|back) into boards of 8: python tools/shuffle_board.py OUTDIR seed0 count [base_url]
import sys, json
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw
out, s0, n = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
url = sys.argv[4] if len(sys.argv) > 4 else 'http://127.0.0.1:8766/app/index.html?profile=person'
out.mkdir(parents=True, exist_ok=True); rows = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1600, 'height': 1500}, device_scale_factor=2); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_selector('html[data-ready=true]', state='attached')
    for k in range(n):
        seed = s0 + k
        look = pg.evaluate(f'window.wardrobeTest.shuffle({seed})')
        shots = []
        for v in ['front', 'back']:
            pg.evaluate(f"window.wardrobeTest.setView('{v}')")
            pg.wait_for_function("[...document.querySelectorAll('#current-stage img')].every(i=>i.complete)")
            pg.wait_for_timeout(300)
            f = out/f'look_{seed}_{v}.png'; pg.locator('#current-stage').screenshot(path=str(f)); shots.append(f)
        layers = {v: [l['key'] for l in pg.evaluate(f"window.wardrobeTest.layers(null,'{v}')")] for v in ['front', 'back']}
        rows.append({'seed': seed, 'look': look, 'front': str(shots[0]), 'back': str(shots[1]), 'layers': layers,
                     'labels': {s: pg.evaluate(f"window.wardrobeTest.manifest().items.find(i=>i.id==='{i}')?.shortLabel") for s, i in look['selected'].items()}})
    b.close()
for bi in range(0, len(rows), 8):
    chunk = rows[bi:bi + 8]; tiles = []
    for r in chunk:
        f, bk = Image.open(r['front']), Image.open(r['back'])
        h = 900; f = f.resize((int(f.width * h / f.height), h)); bk = bk.resize((int(bk.width * h / bk.height), h))
        t = Image.new('RGB', (f.width + bk.width, h + 70), 'white'); t.paste(f, (0, 0)); t.paste(bk, (f.width, 0))
        d = ImageDraw.Draw(t); tk = 'tucked' if r['look']['tucked'].get('base') else 'untucked'
        oo = '' if 'outer' not in r['look']['selected'] else (' open' if r['look']['outerOpen'] else ' closed')
        d.text((8, h + 6), f"seed {r['seed']} | {tk}{oo} | {r['look'].get('finish') or 'as worn'}", fill='black')
        d.text((8, h + 26), ' + '.join(v for v in r['labels'].values() if v)[:150], fill='black'); tiles.append(t)
    W = tiles[0].width; cols = 4; board = Image.new('RGB', (W * cols, tiles[0].height * ((len(tiles) + cols - 1) // cols)), 'white')
    for i, t in enumerate(tiles): board.paste(t, ((i % cols) * W, (i // cols) * t.height))
    name = out/f'board_{s0}_{bi // 8 + 1}.png'; board.save(name)
    (out/f'board_{s0}_{bi // 8 + 1}.json').write_text(json.dumps(chunk, indent=1), encoding='utf8'); print(name)
print('errors', errs)
