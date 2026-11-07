"""Remove studio matte colour from garment edges without changing registration.

Only non-opaque pixels within three pixels of transparent space are eligible.
The nearest opaque cloth interior supplies foreground RGB. Shadows and masks are
not colour layers and are never processed. Writes are exact, lossless WebP.
"""
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion, distance_transform_edt


def colour_layers(profile_dir):
    profile_dir = Path(profile_dir).resolve()
    wardrobe = json.loads((profile_dir / 'wardrobe.json').read_text(encoding='utf8'))
    paths = {}
    collections = [wardrobe['items']] + [v['items'] for v in wardrobe.get('views', {}).values()]
    for items in collections:
        for item in items:
            for variant in item.get('variants', {}).values():
                for key in ('front', 'back'):
                    if variant.get(key):
                        paths[variant[key]] = item['id']
    return paths


def clean_pixels(original, legacy_alpha=False):
    result = original.copy()
    alpha = original[..., 3]
    edge = (alpha > 0) & (alpha < 255) & (distance_transform_edt(alpha > 0) <= 3)
    if not np.any(alpha == 255):
        return result, edge
    # A dark baked outline is not cloth colour. Sample one pixel inside it so
    # cleaning does not extend that outline into translucent pixels on light UI.
    core = binary_erosion(alpha == 255, structure=np.ones((3, 3), dtype=bool))
    if not core.any():
        core = alpha == 255
    distance, nearest = distance_transform_edt(~core, return_indices=True)
    # Narrow islands can be farther from opaque cloth. Leave them intact instead
    # of borrowing a colour from a different cuff, leg, or opening.
    eligible = edge & (distance <= 6)
    foreground = original[nearest[0], nearest[1], :3]
    result[..., :3][eligible] = foreground[eligible]
    if legacy_alpha:
        # Preserve UI-2's existing p-004 alpha repair on every exported variant.
        # This predates colour cleaning. All its affected pixels lie in this rim.
        repaired = np.rint(np.clip((alpha.astype(float) - 235) / 20, 0, 1) * 255).astype('uint8')
        result[..., 3][edge] = repaired[edge]
    return result, edge


def main(profile_dir):
    profile_dir = Path(profile_dir).resolve()
    root = profile_dir.parents[1]
    report_path = Path(os.environ.get('WARDROBE_EDGE_REPORT', str(profile_dir / 'edge_clean.json')))
    backup = os.environ.get('WARDROBE_EDGE_BACKUP')
    def process(entry):
        relative, item_id = entry
        path = root / relative
        before_bytes = path.read_bytes()
        before = np.array(Image.open(path).convert('RGBA'))
        if backup:
            dest = Path(backup) / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(before_bytes)
        legacy_alpha = profile_dir.name == 'person' and item_id == 'p-004'
        after, edge = clean_pixels(before, legacy_alpha=legacy_alpha)
        changed = np.any(before != after, axis=2)
        if np.any(changed):
            Image.fromarray(after).save(path, 'WEBP', lossless=True, exact=True)
        decoded = np.array(Image.open(path).convert('RGBA'))
        assert np.array_equal(after, decoded), f'Non-exact write: {relative}'
        assert not np.any(changed & ~edge), f'Changed non-edge pixel: {relative}'
        assert np.array_equal(before[before[..., 3] == 255], decoded[before[..., 3] == 255])
        def stats(a):
            semi = (a[..., 3] > 0) & (a[..., 3] < 255)
            bright = semi & (a[..., :3].min(axis=2) > 180)
            values = a[..., :3][edge].mean(axis=1)
            return {'semi_pixels': int(semi.sum()), 'bright_semi_pixels': int(bright.sum()),
                    'edge_rgb_mean': float(values.mean()) if len(values) else None,
                    'edge_rgb_p90': float(np.percentile(values, 90)) if len(values) else None}
        return {'path': relative, 'item': item_id, 'before': stats(before), 'after': stats(decoded),
                        'edge_pixels': int(edge.sum()), 'rgb_changed': int(np.any(before[..., :3] != after[..., :3], axis=2).sum()),
                        'alpha_changed': int((before[..., 3] != after[..., 3]).sum()),
                        'legacy_alpha_repair': legacy_alpha, 'opaque_unchanged': True,
                        'outside_three_px_unchanged': True,
                        'before_sha256': hashlib.sha256(before_bytes).hexdigest(),
                        'after_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(process, sorted(colour_layers(profile_dir).items())))
    report = {'method': 'nearest opaque interior RGB (one pixel inset), <=3px outline band, <=6px core neighbour; exact lossless output',
              'mask_files_touched': 0, 'layers': records,
              'totals': {k: sum(r[k] for r in records) for k in ('edge_pixels', 'rgb_changed', 'alpha_changed')}}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding='utf8')
    print('edge_clean', len(records), 'layers', report['totals'], flush=True)
    return report


if __name__ == '__main__':
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else 'profiles/person')
