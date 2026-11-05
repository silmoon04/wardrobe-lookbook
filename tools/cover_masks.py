"""Silhouette cover rule for a built person profile (run after build_person.py).

For every mid/outer variant and view:
  1. Fill small alpha slits in the garment's own front layer (zip and seam dashes).
  2. inner_sleeve_mask := inner_sleeve_mask AND cover_keep, where cover_keep keeps an
     inner-layer pixel only where the upper garment really lets it show:
       - inside the upper silhouette (it is covered there anyway),
       - in the front opening (the row gap that contains the centre line),
       - below the upper hem, within the hem span,
       - above the collar, within the collar span (turtlenecks, shirt collars).
     Everything else (shoulder rims, arm-to-body gaps, side bulges) is hidden.
For every bottom variant and view:
  3. body_keep := body_keep AND (hide body pixels inside each row's hull of the bottom),
     so no mannequin thigh shows between trouser legs.
Usage: python -X utf8 tools/cover_masks.py profiles/person
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

APP = Path(__file__).resolve().parents[1]


def load_a(p):
    return np.array(Image.open(p).convert('RGBA'))


def save(p, arr):
    Image.fromarray(arr, 'RGBA').save(p, 'WEBP', lossless=True)


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def fill_slits(front):
    """Close zip/seam dashes near the centre line, fill small enclosed holes, drop small loose bits."""
    a = front[..., 3] > 127
    H, W = a.shape
    xs = np.nonzero(a.any(0))[0]
    if not len(xs):
        return front, 0
    cx = int(round((xs.min() + xs.max()) / 2))
    centre = np.zeros_like(a); centre[:, max(0, cx - 45):cx + 46] = True
    closed = ndi.binary_closing(a, structure=disk(3), iterations=1)
    holes = closed & ~a & centre
    filled = ndi.binary_fill_holes(a)
    hl, n = ndi.label(filled & ~a)
    if n:
        sizes = ndi.sum(np.ones_like(a), hl, index=np.arange(1, n + 1))
        small = np.isin(hl, np.nonzero(sizes < 250)[0] + 1)
        holes |= small
    out = front.copy()
    if holes.any():
        rgb = front[..., :3].astype(np.float32)
        w = a.astype(np.float32)
        k = np.ones((9, 9), np.float32)
        num = np.stack([ndi.convolve(rgb[..., c] * w, k, mode='constant') for c in range(3)], -1)
        den = ndi.convolve(w, k, mode='constant')[..., None]
        fill = np.clip(num / np.maximum(den, 1e-3), 0, 255).astype(np.uint8)
        out[holes, :3] = fill[holes]
        out[holes, 3] = 255
    # smooth stair steps and bites along the outline (binary median, 7 px)
    sm = ndi.median_filter((out[..., 3] > 127).astype(np.uint8), size=7).astype(bool)
    grow = sm & ~(out[..., 3] > 127)
    if grow.any():
        if not holes.any():
            rgb = front[..., :3].astype(np.float32); w = a.astype(np.float32); k = np.ones((9, 9), np.float32)
            num = np.stack([ndi.convolve(rgb[..., c] * w, k, mode='constant') for c in range(3)], -1)
            den = ndi.convolve(w, k, mode='constant')[..., None]
            fill = np.clip(num / np.maximum(den, 1e-3), 0, 255).astype(np.uint8)
        out[grow, :3] = fill[grow]; out[grow, 3] = 255
    shrink = ~sm & (out[..., 3] > 127)
    out[shrink, 3] = 0
    holes |= grow | shrink
    # loose fragments: components under 200 px are removed
    lab, m = ndi.label(out[..., 3] > 30)
    if m > 1:
        sizes = ndi.sum(np.ones_like(a), lab, index=np.arange(1, m + 1))
        tiny = np.isin(lab, np.nonzero(sizes < 200)[0] + 1)
        out[tiny, 3] = 0
        holes |= tiny
    return out, int(holes.sum())


def clean_opening(front, band=12, win=15, T=70.0):
    """Cut edge pixels near the front opening whose colour differs from the local edge median."""
    a = front[..., 3] > 127
    H, W = a.shape
    ys, xs = np.nonzero(a)
    if not len(ys):
        return front, 0
    cx = int(round((xs.min() + xs.max()) / 2))
    rgb = front[..., :3].astype(np.float32)
    bandm = np.zeros_like(a); trim = np.zeros_like(a)
    for y in range(ys.min(), ys.max() + 1):
        if a[y, cx]:
            continue
        q = np.nonzero(a[y, :cx])[0]
        if len(q) and cx - q[-1] < 120:
            bandm[y, max(0, q[-1] - band + 1):q[-1] + 1] = True
            trim[y, max(0, q[-1] - 2):q[-1] + 1] = True
        q = np.nonzero(a[y, cx:])[0]
        if len(q) and q[0] < 120:
            bandm[y, cx + q[0]:cx + q[0] + band] = True
            trim[y, cx + q[0]:cx + q[0] + 3] = True
    bandm &= a
    out = front.copy(); n = int(trim.sum())
    out[trim, 3] = 0  # the outer 3 px of an open front carry the generation's matte fringe
    # the new opening edge is solid: no half-transparent fringe over a contrasting inner layer
    edge = bandm & ~trim & (out[..., 3] > 0)
    out[edge, 3] = 255
    for half in (slice(0, cx), slice(cx, W)):
        bm = np.zeros_like(a); bm[:, half] = bandm[:, half]
        rows = np.nonzero(bm.any(1))[0]
        for y in rows:
            y0, y1 = max(0, y - win), min(H, y + win + 1)
            ref = np.median(rgb[y0:y1][bm[y0:y1]], axis=0)
            px = np.nonzero(bm[y])[0]
            d = np.linalg.norm(rgb[y, px] - ref, axis=1)
            bad = px[d > T]
            out[y, bad, 3] = 0; n += len(bad)
    return out, n


def smooth_opening(front):
    """Straighten the two front-opening edges (the run boundaries nearest the centre line)."""
    a = front[..., 3] > 127
    H, W = a.shape
    ys, xs = np.nonzero(a)
    if not len(ys):
        return front, 0
    cx = int(round((xs.min() + xs.max()) / 2))
    out = front.copy(); n = 0
    for side in (-1, 1):
        E = np.full(H, np.nan)
        for y in range(ys.min(), ys.max() + 1):
            if a[y, cx]:
                continue
            if side < 0:
                q = np.nonzero(a[y, :cx])[0]
                if len(q) and cx - q[-1] < 120: E[y] = q[-1]
            else:
                q = np.nonzero(a[y, cx:])[0]
                if len(q) and q[0] < 120: E[y] = cx + q[0]
        ok = ~np.isnan(E)
        if ok.sum() < 40:
            continue
        idx = np.nonzero(ok)[0]
        e = E[idx]
        med = ndi.median_filter(e, size=21, mode='nearest')
        sm = ndi.uniform_filter1d(med, size=9, mode='nearest')
        for y, e0, e1 in zip(idx, e, sm):
            e0 = int(e0); e1 = int(round(e1))
            if abs(e1 - e0) > 14 or e1 == e0:
                continue
            if side < 0:
                if e1 > e0:   # extend toward centre
                    out[y, e0 + 1:e1 + 1, :3] = out[y, e0, :3]; out[y, e0 + 1:e1 + 1, 3] = 255
                else:
                    out[y, e1 + 1:e0 + 1, 3] = 0
            else:
                if e1 < e0:
                    out[y, e1:e0, :3] = out[y, e0, :3]; out[y, e1:e0, 3] = 255
                else:
                    out[y, e0:e1, 3] = 0
            n += abs(e1 - e0)
    return out, n


def arm_band(body_alpha, grow=8):
    """Mannequin arm pixels: per row, body runs that do not contain the centre line (armpit to fingertips)."""
    b = body_alpha > 127
    H, W = b.shape
    xs = np.nonzero(b.any(0))[0]
    cx = int(round((xs.min() + xs.max()) / 2))
    arm = np.zeros_like(b)
    rows = np.nonzero(b.any(1))[0]
    for y in rows:
        lab, n = ndi.label(b[y])
        if n < 2:
            continue
        c = lab[cx]
        if c == 0:
            continue  # legs: centre is between them
        arm[y] = (lab > 0) & (lab != c)
    # legs rows also give two runs without the centre: drop them (they start below the crotch)
    return ndi.binary_dilation(arm, structure=disk(grow))


def torso_band(body_alpha, margin=12):
    """Per row: the body run holding the centre line (torso, hips); below the crotch the hull of both legs."""
    b = body_alpha > 127
    H, W = b.shape
    xs = np.nonzero(b.any(0))[0]
    cx = int(round((xs.min() + xs.max()) / 2))
    t = np.zeros_like(b)
    for y in np.nonzero(b.any(1))[0]:
        lab, n = ndi.label(b[y])
        c = lab[cx]
        if c:
            t[y] = lab == c
        else:
            l = lab[:cx][lab[:cx] > 0]; r = lab[cx:][lab[cx:] > 0]
            if len(l) and len(r):
                xl = np.nonzero(lab == l[-1])[0].min(); xr = np.nonzero(lab == r[0])[0].max()
                t[y, xl:xr + 1] = True
    return ndi.binary_dilation(t, structure=np.ones((1, 2 * margin + 1), bool))


def cover_keep(a, armband=None, torso=None):
    """a: bool silhouette of the upper garment. Returns bool keep mask for inner layers."""
    H, W = a.shape
    # inside the solid core only: under the soft outline the inner layer would bleed through as a rim
    keep = ndi.binary_erosion(a, structure=disk(2))
    ys, xs = np.nonzero(a)
    if not len(ys):
        return np.ones_like(a), np.zeros_like(a)
    top_y = ys.min()
    cx = int(round((xs.min() + xs.max()) / 2))
    # front opening: gap that contains the centre line, per row
    opening = np.zeros_like(a)
    for y in range(top_y, ys.max() + 1):
        row = a[y]
        if row[cx]:
            continue
        left = np.nonzero(row[:cx])[0]
        right = np.nonzero(row[cx:])[0]
        if len(left) and len(right):
            opening[y, left[-1] + 1: cx + right[0]] = True
    keep |= opening
    # torso hem: lowest pixel near the centre line (sleeve cuffs can hang lower)
    win = a[:, max(0, cx - 70):cx + 71]
    wy = np.nonzero(win.any(1))[0]
    hem_y = int(wy.max()) if len(wy) else int(ys.max())
    yy = np.arange(H)[:, None]
    has = a.any(0)
    colbot = np.where(has, H - 1 - np.argmax(a[::-1], axis=0), -1)
    # below the jacket hem the inner layer keeps its own shape (natural tails)
    below = (yy > np.maximum(colbot, hem_y - 4)[None, :]) | ((~has)[None, :] & (yy > hem_y - 4))
    if torso is not None:
        below &= torso  # tails follow the hip outline; loose bits beside the hips stay hidden
    keep |= below
    if armband is not None:
        # inner sleeves beside the jacket sleeves stay hidden down to just below the jacket cuff
        out_arm = armband & ~ndi.binary_dilation(a, structure=disk(1))
        for lo, hi in ((0, cx), (cx, W)):
            sub = a[:, lo:hi] & armband[:, lo:hi]
            sy = np.nonzero(sub.any(1))[0]
            if not len(sy):
                continue
            cuff = int(sy.max()) + 1
            zone = np.zeros_like(a); zone[:cuff, lo:hi] = True
            keep &= ~(out_arm & zone)
    # above the collar, within the collar span
    collar = a[top_y:top_y + 15].any(0)
    cxs = np.nonzero(collar)[0]
    if len(cxs):
        c0, c1 = cxs.min() - 4, cxs.max() + 4
        coltop = np.where(has, np.argmax(a, axis=0), H)
        above = yy < coltop[None, :]
        cm = np.zeros(W, bool); cm[max(0, c0):min(W, c1 + 1)] = True
        keep |= above & cm[None, :]
    # the opening plus 4 px under its edges is always open to inner layers (the outer covers the 4 px)
    force = ndi.binary_dilation(opening, structure=np.ones((1, 9), bool))
    return keep, force


def bottom_hide(a):
    """Hide body inside each row hull; below the crotch hide every body pixel in the leg rows."""
    H, W = a.shape
    hide = np.zeros_like(a)
    rows = np.nonzero(a.any(1))[0]
    xs_all = np.nonzero(a.any(0))[0]
    cx = int(round((xs_all.min() + xs_all.max()) / 2))
    crotch = None
    for y in rows:
        xs = np.nonzero(a[y])[0]
        hide[y, xs.min():xs.max() + 1] = True
        if crotch is None and y > rows.min() + 40 and not a[y, cx - 2:cx + 3].any():
            crotch = y
    if crotch is not None:
        # below the crotch plus a hand margin, legs are always covered by the bottom
        hide[crotch + 60:rows.max() + 1, :] = True
    # leave the ankle zone alone: arched hems show the ankle and the shoe there
    hide[max(0, rows.max() - 80):, :] = False
    return hide


def shoe_keep(a):
    """Hide shoe pixels above each leg's hem line, within the leg's column range."""
    H, W = a.shape
    keep = np.ones_like(a)
    xs_all = np.nonzero(a.any(0))[0]
    cx = int(round((xs_all.min() + xs_all.max()) / 2))
    has = a.any(0)
    colbot = np.where(has, H - 1 - np.argmax(a[::-1], axis=0), -1)
    for lo, hi in ((0, cx), (cx, W)):
        cols = np.nonzero(has[lo:hi])[0] + lo
        if not len(cols):
            continue
        hem = int(np.median(colbot[cols][colbot[cols] >= np.percentile(colbot[cols], 70)]))
        # hide only beside the leg: columns with no trouser pixels near the hem
        near = a[max(0, hem - 30):hem + 1].any(0)
        for x in range(max(lo, cols.min() - 40), min(hi, cols.max() + 41)):
            if not near[x]:
                keep[:hem - 4, x] = False
    return keep


def unmirror_graphic(front, ymax=500, dark=90):
    """Labelled transform: flip a mirrored generated chest graphic back to readable."""
    import cv2
    rgb = front[..., :3].copy()
    g = (front[..., 3] > 200) & (rgb.mean(-1) < dark)
    g[ymax:] = False
    ys, xs = np.nonzero(g)
    if len(ys) < 50:
        return front, False
    y0, y1, x0, x1 = ys.min() - 3, ys.max() + 4, xs.min() - 3, xs.max() + 4
    m = ndi.binary_dilation(g, structure=disk(2)) & (front[..., 3] > 200)
    base = cv2.inpaint(np.ascontiguousarray(rgb[..., ::-1]), m.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)[..., ::-1]
    out = front.copy(); out[..., :3] = base
    sub_m = m[y0:y1, x0:x1][:, ::-1]; sub_rgb = rgb[y0:y1, x0:x1][:, ::-1]
    region = out[y0:y1, x0:x1]
    region[sub_m, :3] = sub_rgb[sub_m]
    return out, True


UNMIRROR = {'p-040'}


def variant_sets(w):
    for it in w['items']:
        yield it, 'front', it.get('variants') or {}
    for vname, v in (w.get('views') or {}).items():
        byid = {i['id']: i for i in w['items']}
        for vi in v.get('items', []):
            if vi['id'] in byid:
                yield byid[vi['id']], vname, vi.get('variants') or {}


def main(profile_dir):
    pdir = Path(profile_dir)
    if not pdir.is_absolute():
        pdir = APP / pdir
    w = json.loads((pdir / 'wardrobe.json').read_text(encoding='utf8'))
    root = pdir.parents[1]  # paths in wardrobe.json are relative to the app dir
    stats = dict(upper=0, slits=0, bottom=0)
    prof = json.loads((pdir / 'profile.json').read_text(encoding='utf8'))
    bodies = {'front': load_a(root / prof['mannequin']['body'])[..., 3]}
    for vn, vv in (prof.get('views') or {}).items():
        if vv.get('mannequin', {}).get('body'):
            bodies[vn] = load_a(root / vv['mannequin']['body'])[..., 3]
    arms = {k: arm_band(v) for k, v in bodies.items()}
    torsos = {k: torso_band(v) for k, v in bodies.items()}
    changed = False
    flipped = set()
    for it, view, variants in variant_sets(w):
        slot = it.get('slot')
        for vk, asset in variants.items():
            if not isinstance(asset, dict) or 'front' not in asset:
                continue
            fp = root / asset['front']
            if not fp.exists():
                continue
            if it['id'] in UNMIRROR and view == 'front' and str(fp) not in flipped:
                flipped.add(str(fp))
                f = load_a(fp); f2, ok = unmirror_graphic(f)
                if ok:
                    save(fp, f2); stats['unmirror'] = stats.get('unmirror', 0) + 1
            if slot in ('mid', 'outer'):
                f = load_a(fp)
                f2, n = fill_slits(f)
                if 'open' in vk and view == 'front':
                    f2, n1 = clean_opening(f2)
                    f2, n2 = smooth_opening(f2); n += n1 + n2
                if n:
                    save(fp, f2); stats['slits'] += n
                a = f2[..., 3] > 127
                keep, force = cover_keep(a, arms.get(view), torsos.get(view))
                mp = asset.get('inner_sleeve_mask')
                if mp and (root / mp).exists():
                    m = load_a(root / mp)
                else:
                    mp = str(Path(asset['front']).with_name('inner_sleeve_mask.webp')).replace('\\', '/')
                    m = np.zeros(a.shape + (4,), np.uint8); m[..., :3] = 255; m[..., 3] = 255
                    asset['inner_sleeve_mask'] = mp; changed = True
                m[..., 3] = np.where(keep, m[..., 3], 0)
                m[force, 3] = 255; m[force, :3] = 255
                save(root / mp, m); stats['upper'] += 1
            elif slot == 'bottom':
                f = load_a(fp)
                hide = bottom_hide(f[..., 3] > 127)
                bp = asset.get('body_keep')
                if bp and (root / bp).exists():
                    m = load_a(root / bp)
                else:
                    bp = str(Path(asset['front']).with_name('body_keep.webp')).replace('\\', '/')
                    m = np.zeros(hide.shape + (4,), np.uint8); m[..., :3] = 255; m[..., 3] = 255
                    asset['body_keep'] = bp; changed = True
                m[..., 3] = np.where(hide, 0, m[..., 3])
                save(root / bp, m); stats['bottom'] += 1
                sk = shoe_keep(f[..., 3] > 127)
                sp = Path(asset['front']).with_name('shoe_keep.webp').as_posix()
                s_arr = np.zeros(sk.shape + (4,), np.uint8); s_arr[..., :3] = 255; s_arr[..., 3] = np.where(sk, 255, 0)
                save(root / sp, s_arr)
                if asset.get('shoe_keep') != sp:
                    asset['shoe_keep'] = sp; changed = True
    if changed:
        (pdir / 'wardrobe.json').write_text(json.dumps(w, indent=1, ensure_ascii=False), encoding='utf8')
    print(json.dumps(stats))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'profiles/person')
