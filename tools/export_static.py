"""Export one profile as a static site (GitHub Pages). No server, no personal photos.

Usage: python -X utf8 tools/export_static.py OUT_DIR [--profile person] [--name "My wardrobe"]
Layout: OUT/index.html (redirect), OUT/app/{index,lookbook}.html + js/css, OUT/app/api/{profile,profiles}
(static JSON; the query string is ignored by static hosts), OUT/app/profiles/<id>/data/..., OUT/assets/.
Product pictures are rebuilt from the generated garment layer (never from worn photos).
Local file paths, sources and provenance are removed.
"""
import argparse, json, re, shutil, sys
from pathlib import Path
from PIL import Image

APP = Path(__file__).resolve().parents[1]
ASSETS = APP.parent/'assets'
CODE = ['index.html', 'lookbook.html', 'app.js', 'studio-shell.js', 'appearance-chips.js', 'product-images.js', 'local-agent.js', 'lookbook.js', 'compositor.js', 'settings.js', 'shuffle.js'] + (['shadows.js'] if (APP/'shadows.js').exists() else [])
HIDE = '<script>window.wardrobeStatic=true</script><style>#new-profile,#add-garments,#agent-panel,.profile-control,#empty-import,#profile-switch{display:none!important}</style>'
DROP_KEYS = {'source', 'sourceLabel', 'versionSource', 'provenance', 'colourSource', 'review_state'}


def strip(o):
    if isinstance(o, dict):
        # spoken and review notes can hold personal details; the site gets none
        return {k: ([] if k == 'notes' else strip(v)) for k, v in o.items() if k not in DROP_KEYS}
    if isinstance(o, list):
        return [strip(v) for v in o]
    if isinstance(o, str) and re.search(r'[A-Za-z]:[\\/]|\\Users\\|/Users/', o):
        return ''
    return o


def paths_in(o, out):
    if isinstance(o, dict):
        for v in o.values(): paths_in(v, out)
    elif isinstance(o, list):
        for v in o: paths_in(v, out)
    elif isinstance(o, str) and o.startswith('profiles/') and Path(o).suffix in ('.webp', '.png', '.json', '.jpg'):
        out.add(o)


def thumb(front_rel, dest):
    im = Image.open(APP/front_rel).convert('RGBA')
    box = im.getchannel('A').point(lambda a: 255 if a > 20 else 0).getbbox()
    im = im.crop(box)
    pad = int(max(im.size) * 0.08)
    canvas = Image.new('RGB', (im.width + 2 * pad, im.height + 2 * pad), (244, 242, 238))
    canvas.paste(im, (pad, pad), im)
    canvas.thumbnail((480, 640))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, 'WEBP', quality=88)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--profile', default='person')
    ap.add_argument('--name', default='My wardrobe')
    a = ap.parse_args()
    sys.path.insert(0, str(APP))
    import profile_core
    loaded = profile_core.load_profile(a.profile)
    out = Path(a.out); site = out/'app'
    for sub in ['app', 'assets']:
        if (out/sub).exists(): shutil.rmtree(out/sub)
    site.mkdir(parents=True)
    for f in CODE:
        text = (APP/f).read_text(encoding='utf8')
        if f.endswith('.html'):
            text = text.replace('</head>', HIDE + '</head>')
        (site/f).write_text(text, encoding='utf8')
    shutil.copytree(APP/'styles', site/'styles', ignore=shutil.ignore_patterns('*.pre_claude.*'))
    shutil.copytree(ASSETS/'icons', out/'assets/icons')
    shutil.copytree(ASSETS/'fonts', out/'assets/fonts')

    profile, manifest = loaded['profile'], loaded['manifest']
    profile = dict(profile, displayName=a.name)
    profile['settingsDefaults'] = dict(profile['settingsDefaults'], agent=False)
    profile.pop('privacy', None)
    for it in manifest['items']:
        it.pop('image', None)
        v = it['variants'].get('default') or next(iter(it['variants'].values()), None)
        if v:
            rel = f"profiles/{a.profile}/data/thumbs/{it['id']}.webp"
            thumb(v['front'], site/rel)
            it['image'] = rel
    payload = strip({'profile': profile, 'manifest': manifest, 'landmarks': loaded['landmarks'], 'schema': {}})
    need = set(); paths_in(payload, need)
    for p in sorted(need):
        if (site/p).exists(): continue
        (site/p).parent.mkdir(parents=True, exist_ok=True)
        if p.endswith('.json'):  # profile JSON gets the same clean-up as the payload
            (site/p).write_text(json.dumps(strip(json.loads((APP/p).read_text(encoding='utf8'))), ensure_ascii=False), encoding='utf8')
        else:
            shutil.copy2(APP/p, site/p)
    (site/'api').mkdir()
    (site/'api/profile').write_text(json.dumps(payload, ensure_ascii=False), encoding='utf8')
    (site/'api/profiles').write_text(json.dumps({'profiles': [{'id': a.profile, 'displayName': a.name, 'demo': False}],
                                                 'defaultProfile': a.profile}), encoding='utf8')
    (out/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Wardrobe</title>'
                                  f'<meta http-equiv="refresh" content="0; url=app/index.html?profile={a.profile}">'
                                  f'<a href="app/index.html?profile={a.profile}">Open the wardrobe</a>', encoding='utf8')
    (out/'.nojekyll').write_text('')
    leaks = [p for p in site.rglob('*') if p.is_file() and p.suffix in ('.json', '') and re.search(rb'[A-Za-z]:(\\\\|/)+Users|/Users/|/home/', p.read_bytes())]
    size = sum(p.stat().st_size for p in out.rglob('*') if p.is_file()) / 1e6
    print(f'files {sum(1 for p in out.rglob("*") if p.is_file())}, {size:.1f} MB, layers {len(need)}, path leaks {leaks}')


if __name__ == '__main__':
    main()
