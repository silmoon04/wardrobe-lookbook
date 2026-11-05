"""Build the video person's site profile from pilot/production manifest parts.

Usage: python -X utf8 tools/build_person.py --body pilot|b2 PART.json [PART.json ...]
Each part is in the pilot manifest_preview.json shape (top-level = front view, plus
views.front / views.back). Layer paths in a part are relative to the part's folder.
Every view is cropped to a centred window (integer crop only; no scaling or warps),
and layers are written as WebP under profiles/person/data/.
"""
import os
import argparse, hashlib, json, shutil, sys
from pathlib import Path
from PIL import Image

APP = Path(__file__).resolve().parents[1]
RUN = Path(os.environ.get('WARDROBE_RUN', 'runs/latest'))  # your generation run folder
PID = 'person'
OUT = APP/'profiles'/PID
DATA = OUT/'data'
W = 576  # view window width; height stays 1024
LAYER_PARTS = ['front', 'back', 'shade', 'occlude', 'inner_sleeve_mask', 'over_effective', 'body_keep']
SHOE_INFO = {'af1_white': ('White low-top sneakers (AF1 style)', 'af1', ['white']),
             'boot_brown_lace': ('Brown leather lace-up ankle boots', 'boots', ['brown']),
             'boot_black_chelsea': ('Black leather Chelsea boots', 'boots', ['black'])}
CATEGORY = {'outer': 'outerwear', 'mid': 'knitwear', 'bottom': 'bottom', 'shoes': 'footwear', 'socks': 'socks', 'one_piece': 'dress'}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def rel(p):
    return p.relative_to(APP).as_posix()


def save(im, dest, mask=False):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA')
    if mask:
        im.save(dest, 'WEBP', lossless=True)
    else:
        im.save(dest, 'WEBP', quality=92, alpha_quality=100, method=5)
    return rel(dest)


class View:
    """A camera view: crop window inside the view canvas (x0) and inside the 1536 sheet (sx0)."""
    def __init__(self, name, sheet_box, body_alpha):
        self.name = name
        bx0 = sheet_box[0]
        a = body_alpha.crop(tuple(sheet_box))
        l, t, r, b = a.getbbox()
        cx = (l + r) // 2
        self.x0 = max(0, min(cx - W // 2, (sheet_box[2] - bx0) - W))
        self.sx0 = bx0 + self.x0

    def crop_view(self, im):   # image registered to this view's 768x1024 canvas
        return im.crop((self.x0, 0, self.x0 + W, im.height))

    def crop_sheet(self, im):  # image registered to the 1536x1024 sheet
        return im.crop((self.sx0, 0, self.sx0 + W, im.height))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--body', choices=['pilot', 'b2'], required=True)
    ap.add_argument('--name', default='Video person')
    ap.add_argument('--shoes', help='shoes.json from the shoes lane')
    ap.add_argument('--show-open', action='store_true', help='render items that have layers even when a lane held them for open faults')
    ap.add_argument('--plate', help='mannequin folder with <view>/bg.png (empty studio plate) and <view>/over.png')
    ap.add_argument('parts', nargs='+')
    a = ap.parse_args()

    marks = json.loads((RUN/'pilot/mannequin/landmarks.json').read_text(encoding='utf8'))
    b2 = RUN/'body/b2'
    if DATA.exists():
        shutil.rmtree(DATA)
    body_alpha = Image.open(b2/'body_B_bald.png').getchannel('A') if a.body == 'b2' else None
    views = {}
    for name, box in [('front', marks['front_box']), ('back', marks['back_box'])]:
        if a.body == 'pilot':
            pb = Image.open(RUN/f'pilot/mannequin/{name}/body.png')
            sheet_alpha = Image.new('L', (1536, 1024)); sheet_alpha.paste(pb.getchannel('A'), (box[0], 0))
            views[name] = View(name, box, sheet_alpha)
        else:
            views[name] = View(name, box, body_alpha)

    def mannequin(name):
        v = views[name]
        d = DATA/'mannequin'/name
        m = {'id': f'{PID}_{a.body}_{name}', 'folder': f'profiles/{PID}/data/mannequin/{name}'}
        over = v.crop_view(Image.open((Path(a.plate) if a.plate and a.body == 'b2' else RUN/'pilot/mannequin')/name/'over.png'))
        if a.body == 'pilot':
            src = RUN/f'pilot/mannequin/{name}'
            for part in ['bg', 'body', 'hair_back']:
                m[part] = save(v.crop_view(Image.open(src/f'{part}.png')), d/f'{part}.webp')
            m['base'] = m['body']
        else:
            # The bg must be an EMPTY studio plate: body_keep reveals it where the mannequin is hidden.
            m['bg'] = save(v.crop_view(Image.open(Path(a.plate)/name/'bg.png')) if a.plate else v.crop_sheet(Image.open(b2/'body_B_bald_preview.png')), d/'bg.webp')
            m['body'] = m['base'] = save(v.crop_sheet(Image.open(b2/'body_B_bald.png')), d/'body.webp')
            empty = Image.new('RGBA', (W, 1024))
            m['hair_back'] = save(empty, d/'hair_back_none.webp', mask=True)
            opts = {}
            labels = {'H1': 'Short (as filmed)', 'H2': 'Short, slightly curly', 'H3': 'Short, middle part', 'H4': 'Short, middle part (take 2)'}
            for h, info in json.loads((b2/'layers.json').read_text(encoding='utf8'))['versions'].items():
                opts[h] = {'label': labels.get(h, h),
                           'hair': save(v.crop_sheet(Image.open(b2/info['front_layer'])), d/f'hair_{h}.webp'),
                           'hair_back': save(v.crop_sheet(Image.open(b2/info['behind_layer'])), d/f'hair_back_{h}.webp')}
            m['hairOptions'] = opts
            m['defaultHair'] = 'H1'
        m['over'] = save(over, d/'over.webp')
        lm = dict(marks, canvas=[W, 1024], view=name, crop_x0_in_view=v.x0, crop_x0_in_sheet=v.sx0)
        (d/'landmarks.json').write_text(json.dumps(lm, indent=1), encoding='utf8')
        m['landmarks'] = rel(d/'landmarks.json')
        return m

    man = {n: mannequin(n) for n in views}
    items, by_id, view_items = [], {}, {'front': {}, 'back': {}}
    for part_path in a.parts:
        part_path = Path(part_path)
        part = json.loads(part_path.read_text(encoding='utf8'))
        base = part_path.parent
        pviews = part.get('views') or {'front': {'items': part['items']}}
        for vname, pv in pviews.items():
            v = views[vname]
            for it in pv['items']:
                if it['id'] not in by_id:
                    rec = {k: it[k] for k in ['id', 'label', 'slot'] if k in it}
                    rec['shortLabel'] = it.get('shortLabel') or it['label']
                    rec['sourceLabel'] = it['label']
                    rec['layerSlot'] = it.get('layerSlot', rec['slot'])
                    rec['colours'] = it.get('colours') or []
                    if it.get('colourHex'): rec['colourHex'] = it['colourHex']
                    lab = (it['label'] + ' ' + it.get('category', '')).lower()
                    rec['category'] = CATEGORY.get(rec['slot']) or ('shirt' if 'shirt' in lab and 't-shirt' not in lab else 'top')
                    if it.get('decision') == 'hold' or it.get('renderable') is False:
                        rec['reviewState'] = 'held: ' + (it.get('reviewState') or 'incomplete')
                    for k in ['hemVariant', 'notes', 'defaultState', 'versionStatus', 'pairingRule']:
                        if k in it: rec[k] = it[k]
                    rec.setdefault('reviewState', it.get('reviewState') or 'awaiting person review')
                    rec['decision'] = 'keep'; rec.setdefault('notes', [])
                    if it.get('image') and (base/it['image']).is_file():
                        rec['image'] = save(Image.open(base/it['image']).convert('RGB'), DATA/'products'/f"{it['id']}.webp")
                    rec['variants'] = {}
                    by_id[it['id']] = rec; items.append(rec)
                cache = {}
                def layer(p, mask):
                    if p not in cache:
                        dest = DATA/'garments'/vname/Path(p).with_suffix('.webp')
                        cache[p] = save(v.crop_view(Image.open(base/p)), dest, mask)
                    return cache[p]
                out = {}
                held = it.get('decision') == 'hold' or it.get('renderable') is False
                if held and a.show_open and any(v.get('front') and (base/v['front']).is_file() for v in it['variants'].values()):
                    held = False
                    by_id[it['id']]['reviewState'] = 'open faults: ' + (it.get('reviewState') or 'under review')
                for vn, var in ({} if held else it['variants']).items():
                    if it['slot'] == 'bottom' and vn not in ('default', 'solo') and not vn.startswith('solo'):
                        vn = 'solo_' + vn  # lane names af1/boots/*_smooth -> compositor solo_<shoe>[_smooth]
                    o = {}
                    for k in LAYER_PARTS:
                        if var.get(k): o[k] = layer(var[k], k in ('inner_sleeve_mask', 'over_effective', 'occlude', 'body_keep'))
                    if var.get('masks'):
                        o['masks'] = {mk: layer(mp, True) for mk, mp in var['masks'].items()}
                    for k in ['review_state', 'source']:
                        if var.get(k): o[k] = str(var[k])
                    out[vn] = o
                view_items[vname][it['id']] = out
    for rec in items:
        rec['variants'] = view_items['front'].get(rec['id'], {})
        rec['renderable'] = bool(rec['variants'])
    shoes = []
    if a.shoes:
        sj = json.loads(Path(a.shoes).read_text(encoding='utf8'))
        sbase = Path(a.shoes).parent
        for s in sj.get('shoes', sj if isinstance(sj, list) else []):
            nm, hem, col = SHOE_INFO.get(s['id'], (s['id'], None, []))
            rec = {'id': s['id'], 'label': nm, 'shortLabel': nm, 'sourceLabel': s.get('label', s['id']), 'colours': col,
                   'slot': 'shoes', 'layerSlot': 'shoes', 'category': 'footwear',
                   'hemVariant': hem, 'decision': 'keep', 'notes': [], 'reviewState': 'awaiting person review', 'variants': {}}
            for vname in ['front', 'back']:
                paths = s.get('views', {}).get(vname) or s.get(vname)
                if not paths: continue
                o = {k: save(views[vname].crop_sheet(Image.open(sbase/p)) if Image.open(sbase/p).width == 1536 else views[vname].crop_view(Image.open(sbase/p)),
                             DATA/'shoes'/s['id']/vname/f'{k}.webp', k == 'occlude')
                     for k, p in paths.items() if k in ('front', 'shade', 'occlude')}
                view_items[vname][s['id']] = {'default': o}
            rec['variants'] = view_items['front'].get(s['id'], {})
            rec['renderable'] = bool(rec['variants'])
            items.append(rec); shoes.append(rec['id'])

    canvas = {'width': W, 'height': 1024}
    wardrobe = {'version': 2, 'canvas': canvas, 'mannequin': man['front'], 'items': items,
                'views': {'back': {'canvas': canvas, 'items': [{'id': i, 'variants': vv} for i, vv in view_items['back'].items()]}},
                'provenance': {'body': a.body, 'parts': [str(p) for p in a.parts],
                               'body_sha256': sha(b2/'body_B.png') if a.body == 'b2' else json.loads((RUN/'pilot/body_used.json').read_text())['sha256']}}
    owner = json.loads((APP/'profiles/owner/profile.json').read_text(encoding='utf8'))
    profile = {'id': PID, 'displayName': a.name, 'demo': False,
               'mannequin': man['front'], 'views': {'back': {'mannequin': man['back']}},
               'wardrobe': f'profiles/{PID}/wardrobe.json', 'decidedOutfits': f'profiles/{PID}/decided.json',
               'feedback': f'profiles/{PID}/feedback.json',
               'settingsDefaults': dict(owner['settingsDefaults'], shoes='garment' if shoes else 'none'),
               'privacy': {'textAgent': True, 'sendPhotos': False}, 'rules': {**owner['rules'], 'avoidPairs': [['p-018', 'p-028']]}}
    if shoes:
        profile['lookbookShoes'] = shoes[0]
        profile['initialLook'] = {'selected': {'shoes': shoes[0]}, 'outerOpen': True}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT/'wardrobe.json').write_text(json.dumps(wardrobe, indent=1, ensure_ascii=False), encoding='utf8')
    (OUT/'profile.json').write_text(json.dumps(profile, indent=1, ensure_ascii=False), encoding='utf8')
    for f, empty in [('decided.json', '[]'), ('feedback.json', '{}')]:
        if not (OUT/f).exists(): (OUT/f).write_text(empty, encoding='utf8')
    sys.path.insert(0, str(APP))
    sys.path.insert(0, str(APP/'tools'))
    if '--no-cover' not in sys.argv:
        import cover_masks  # silhouette cover rule, slit/edge clean-up, shoe_keep
        cover_masks.main(str(OUT))
    import profile_core
    loaded = profile_core.load_profile(PID)
    print('items', len(items), 'front renderable', sum(i['renderable'] for i in items),
          'back', len(loaded['manifest']['views'].get('back', {}).get('items', [])), 'shoes', shoes)


if __name__ == '__main__':
    main()
