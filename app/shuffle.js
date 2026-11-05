// Rule-based outfit shuffle. Same seed -> same look, so reviewed looks can be reproduced.
export function rng(seed) {
  let s = (Math.imul(seed >>> 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < 8; i++) next();
  return next;
}

const pick = (list, r) => list[Math.floor(r() * list.length)];

// Tuck default per garment: lane data (defaultState.tucked / tuckDefault), else a garment-type rule.
export function tuckDefault(item) {
  if (typeof item.defaultState?.tucked === 'boolean') return item.defaultState.tucked;
  if (typeof item.defaultState === 'string' && /tucked/.test(item.defaultState)) return item.defaultState === 'solo_tucked' && !!item.variants?.solo_tucked;
  if (item.tuckDefault) return item.tuckDefault === 'tucked';
  if (!item.variants?.solo_tucked) return false;
  const t = `${item.label} ${item.category}`.toLowerCase();
  if (/overshirt|tank|vest|hoodie|sweat|knit|jumper|polo|graphic/.test(t)) return false;
  return /dress shirt|oxford|button|check|shirt/.test(t) && !/t-shirt|tee/.test(t);
}

const lightness = item => {
  const h = (item.colourHex || '').replace('#', '');
  if (h.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

export function smartShuffle(manifest, rules, seed = Math.floor(Math.random() * 2 ** 31)) {
  // Pairs that failed the layering review are skipped (the user can still choose them by hand).
  const avoid = manifest.rules?.avoidPairs || rules?.avoidPairs || [];
  for (let k = 0; k < 20; k++) {
    const res = shuffleOnce(manifest, rules, k ? (seed * 31 + k) >>> 0 : seed);
    const ids = new Set(Object.values(res.look.selected));
    if (!avoid.some(([a, b]) => ids.has(a) && ids.has(b))) return {...res, seed};
  }
  return shuffleOnce(manifest, rules, seed);
}

function shuffleOnce(manifest, rules, seed) {
  const r = rng(seed);
  const ok = slot => manifest.items.filter(i => i.slot === slot && i.renderable);
  const selected = {};
  const base = ok('base'), bottom = ok('bottom'), mid = ok('mid'), outer = ok('outer'), shoes = ok('shoes');
  if (base.length) selected.base = pick(base, r).id;
  if (bottom.length) {
    // Avoid the same tone top and bottom when there is a choice (no all-light or all-dark blocks).
    const top = manifest.items.find(i => i.id === selected.base);
    const lt = top ? lightness(top) : null;
    const contrast = lt == null ? bottom : bottom.filter(b => lightness(b) == null || Math.abs(lightness(b) - lt) > 0.12);
    selected.bottom = pick(contrast.length ? contrast : bottom, r).id;
  }
  const roll = r();
  if (mid.length && roll < 0.3) selected.mid = pick(mid, r).id;
  if (outer.length && (roll >= 0.3 && roll < 0.75 || roll < 0.12)) selected.outer = pick(outer, r).id;
  if (shoes.length) selected.shoes = pick(shoes, r).id;
  const item = id => manifest.items.find(i => i.id === id);
  // A tucked top only when nothing covers its hem in front.
  const tucked = {base: !!selected.base && !selected.mid && tuckDefault(item(selected.base)), mid: false};
  const o = selected.outer && item(selected.outer);
  const outerOpen = !o ? true : o.variants.open && o.variants.closed ? (o.defaultState === 'closed' ? r() < 0.3 : r() < 0.7) : !o.variants.closed;
  return {seed, look: {selected, tucked, outerOpen, shoes: selected.shoes ? 'garment' : undefined,
    finish: r() < 0.25 ? 'smooth' : undefined}};
}
