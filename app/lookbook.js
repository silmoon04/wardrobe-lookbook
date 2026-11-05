// Lookbook: every garment of the active profile on its own mannequin, using the shared compositor.
import {renderLook, viewManifest, hasView} from './compositor.js';
import {loadSettings, applySettings} from './settings.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CAT_ORDER = ['top','knitwear','shirt','dress','bottom','outerwear','socks','footwear','accessory'];
const CAT_LABEL = {top:'Tops',knitwear:'Knitwear',shirt:'Shirts',dress:'Dresses',bottom:'Bottoms',outerwear:'Outerwear',socks:'Socks',footwear:'Shoes',accessory:'Accessories'};
const STATUS = {PASS:'Clean',NOTE:'With notes',FAIL:'Needs fix'};
const KEY = id => `wardrobe.lookbook.${id}`;

let data, items = [], view = {cat:'all', q:'', pair:'pair', status:'', zoom:210, side:'front'}, visible = [], current = -1;

const statusOf = it => (it.versionStatus || '').toUpperCase().startsWith('PASS') ? 'PASS'
  : (it.versionStatus || '').toUpperCase().startsWith('FAIL') ? 'FAIL' : 'NOTE';

// A neutral partner piece so a top is not read as a crop top, and a bottom is not shown topless.
function partners(manifest) {
  const r = manifest.items.filter(i => i.renderable);
  const set = data.profile.lookbookPartners || {};
  const byId = id => r.find(i => i.id === id);
  const plain = r.find(i => i.slot === 'base' && /white/i.test(i.label) && /t-shirt|tee/i.test(i.label) && !/graphic|print|snoopy|pocket/i.test(i.label));
  const find = (slot, words) => r.find(i => i.slot === slot && words.some(w => (i.label || '').toLowerCase().includes(w)));
  return {
    bottom: byId(set.bottom) || find('bottom', ['straight', 'jean']) || r.find(i => i.slot === 'bottom'),
    base: byId(set.base) || plain || r.find(i => i.slot === 'base'),
  };
}

function lookFor(it, pair) {
  const shoe = data.profile.lookbookShoes;
  const look = {selected: {[it.slot]: it.id}, shoes: shoe ? 'garment' : 'af1', background: 'neutral', tucked: {}, variants: {}, outerOpen: true};
  if (shoe && it.slot !== 'shoes') look.selected.shoes = shoe;
  if (pair === 'pair') {
    const p = partners(data.manifest);
    if (['base', 'mid', 'outer'].includes(it.slot) && p.bottom && !look.selected.bottom) look.selected.bottom = p.bottom.id;
    if (['outer', 'mid'].includes(it.slot) && p.base) look.selected.base = p.base.id;
    if (it.slot === 'bottom' && p.base) look.selected.base = p.base.id;
  }
  return look;
}

// Draw one look in the chosen camera view; a piece without that view says so, never shows the body bare.
function drawStage(st, it, pair) {
  const m = viewManifest(data.manifest, view.side);
  if (!m.items.find(i => i.id === it.id)?.renderable) { st.innerHTML = `<span class="lb-unavailable">No ${view.side} view yet</span>`; return; }
  renderLook(st, m, lookFor(it, pair));
}

function card(it, idx) {
  const st = statusOf(it);
  const el = document.createElement('button');
  el.className = 'lb-card';
  el.dataset.idx = idx;
  el.setAttribute('aria-label', `${it.shortLabel || it.label}, ${STATUS[st]}`);
  el.innerHTML = `<span class="lb-frame">${!it.renderable && !it.image
      ? `<span class="lb-unavailable">No picture yet</span>`
      : view.pair === 'product' || !it.renderable
      ? `<img class="lb-product" loading="lazy" alt="" src="${esc(it.image)}">`
      : `<span class="stage lb-stage" aria-hidden="true"></span>`}
      <span class="lb-badge lb-${st.toLowerCase()}" title="${STATUS[st]}"></span></span>
    <span class="lb-name">${esc(it.shortLabel || it.label)}</span>
    <span class="lb-meta">${esc((it.colours || []).join(', '))}</span>`;
  return el;
}

const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const c = e.target, it = visible[+c.dataset.idx], st = c.querySelector('.lb-stage');
    if (st && !st.dataset.done) { drawStage(st, it, view.pair); st.dataset.done = '1'; }
    io.unobserve(c);
  }
}, {rootMargin: '600px'});

function render() {
  document.documentElement.style.setProperty('--lb-card', view.zoom + 'px');
  const q = view.q.trim().toLowerCase();
  visible = items.filter(it => (view.cat === 'all' || it.category === view.cat)
    && (!view.status || statusOf(it) === view.status)
    && (!q || [it.label, it.shortLabel, ...(it.colours || []), it.category].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
  const groups = $('#lb-groups');
  groups.innerHTML = '';
  const cats = [...new Set(visible.map(i => i.category))].sort((a, b) => CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b));
  for (const cat of cats) {
    const sec = document.createElement('section');
    sec.className = 'lb-group';
    const list = visible.map((it, i) => [it, i]).filter(([it]) => it.category === cat);
    sec.innerHTML = `<h2 class="lb-group-title">${esc(CAT_LABEL[cat] || cat)}<span>${list.length}</span></h2><div class="lb-grid"></div>`;
    const grid = sec.querySelector('.lb-grid');
    for (const [it, i] of list) { const c = card(it, i); grid.append(c); io.observe(c); }
    groups.append(sec);
  }
  $('#lb-empty').hidden = visible.length > 0;
  $$chips();
  localStorage.setItem(KEY(data.profile.id), JSON.stringify(view));
}

function $$chips() {
  const counts = {};
  for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
  const cats = ['all', ...Object.keys(counts).sort((a, b) => CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b))];
  $('#lb-chips').innerHTML = cats.map(c => `<button role="tab" aria-selected="${c === view.cat}" data-cat="${c}">${esc(c === 'all' ? 'All' : CAT_LABEL[c] || c)}<span>${c === 'all' ? items.length : counts[c]}</span></button>`).join('');
}

function stats() {
  const n = s => items.filter(i => statusOf(i) === s).length;
  $('#lb-stats').innerHTML = [['Pieces', items.length], ['Clean', n('PASS')], ['With notes', n('NOTE')], ['Needs fix', n('FAIL')]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('#lb-title').textContent = data.profile.displayName || 'Every piece';
  $('#lb-sub').textContent = `${items.length} kept pieces on ${data.manifest.mannequin.id}. Generated layers; fit is an estimate.`;
}

let detailPair = 'pair';
function openDetail(i) {
  current = i;
  const it = visible[i], d = $('#lb-detail');
  $('#lb-d-cat').textContent = (CAT_LABEL[it.category] || it.category || '').toUpperCase();
  $('#lb-d-title').textContent = it.shortLabel || it.label;
  $('#lb-d-label').textContent = it.label !== it.shortLabel ? it.label : '';
  const prod = $('#lb-d-product');
  if (it.image) { prod.src = it.image; prod.hidden = false; } else { prod.removeAttribute('src'); prod.hidden = true; }
  $('#lb-d-colours').innerHTML = (it.colours || []).map(c => `<span class="lb-chip-colour"><i style="background:${esc(it.colourHex || '#999')}"></i>${esc(c)}</span>`).join('');
  const st = statusOf(it);
  $('#lb-d-state').innerHTML = `<span class="lb-badge lb-${st.toLowerCase()}"></span>${STATUS[st]} · ${esc(it.reviewState || '')}`;
  $('#lb-d-notes').innerHTML = (it.notes || []).map(n => `<li>${esc(n)}</li>`).join('') || '<li>No notes.</li>';
  $('#lb-d-pos').textContent = `${i + 1} / ${visible.length}`;
  document.querySelectorAll('.lb-d-toggle button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pair === detailPair)));
  const stage = $('#lb-d-stage');
  stage.innerHTML = '';
  document.querySelectorAll('.lb-d-side button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.side === view.side)));
  if (it.renderable) drawStage(stage, it, detailPair);
  else stage.innerHTML = '<p class="lb-unavailable">No picture yet. This piece is waiting for its render.</p>';
  if (!d.open) d.showModal();
}

async function loadProfile(id) {
  const r = await fetch(`api/profile?id=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error((await r.json()).error || 'Profile failed to load');
  data = await r.json();
  applySettings(loadSettings(data.profile.id, data.profile.settingsDefaults || {}));
  document.documentElement.dataset.background = 'neutral';
  items = data.manifest.items.slice();
  try { Object.assign(view, JSON.parse(localStorage.getItem(KEY(id)) || '{}')); } catch {}
  if (!hasView(data.manifest, view.side)) view.side = 'front';
  $('#lb-side-wrap').hidden = $('.lb-d-side').hidden = !hasView(data.manifest, 'back');
  $('#lb-side').value = view.side;
  $('#lb-q').value = view.q; $('#lb-pair').value = view.pair; $('#lb-status').value = view.status; $('#lb-zoom').value = view.zoom;
  stats(); render();
}

async function init() {
  const pr = await (await fetch('api/profiles')).json();
  const sel = $('#lb-profile');
  sel.innerHTML = pr.profiles.map(p => `<option value="${esc(p.id)}">${esc(p.displayName || p.id)}</option>`).join('');
  const last = localStorage.getItem('wardrobe.lookbook.profile');
  sel.value = pr.profiles.some(p => p.id === last) ? last : (pr.defaultProfile || pr.profiles[0]?.id);
  sel.onchange = () => { localStorage.setItem('wardrobe.lookbook.profile', sel.value); loadProfile(sel.value); };
  $('#lb-chips').onclick = e => { const b = e.target.closest('[data-cat]'); if (b) { view.cat = b.dataset.cat; render(); } };
  $('#lb-q').oninput = e => { view.q = e.target.value; render(); };
  $('#lb-pair').onchange = e => { view.pair = e.target.value; detailPair = view.pair === 'alone' ? 'alone' : 'pair'; render(); };
  $('#lb-side').onchange = e => { view.side = e.target.value; render(); };
  document.querySelector('.lb-d-side').onclick = e => { const b = e.target.closest('[data-side]'); if (b) { view.side = b.dataset.side; $('#lb-side').value = view.side; openDetail(current); render(); } };
  $('#lb-status').onchange = e => { view.status = e.target.value; render(); };
  $('#lb-zoom').oninput = e => { view.zoom = +e.target.value; document.documentElement.style.setProperty('--lb-card', view.zoom + 'px'); };
  $('#lb-zoom').onchange = () => render();
  $('#lb-groups').onclick = e => { const c = e.target.closest('.lb-card'); if (c) openDetail(+c.dataset.idx); };
  $('#lb-prev').onclick = () => openDetail((current - 1 + visible.length) % visible.length);
  $('#lb-next').onclick = () => openDetail((current + 1) % visible.length);
  document.querySelector('.lb-d-toggle').onclick = e => { const b = e.target.closest('[data-pair]'); if (b) { detailPair = b.dataset.pair; openDetail(current); } };
  $('#lb-detail').addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') $('#lb-next').click();
    if (e.key === 'ArrowLeft') $('#lb-prev').click();
  });
  $('#lb-detail').addEventListener('click', e => { if (e.target.id === 'lb-detail') e.target.close(); });
  await loadProfile(sel.value);
  document.documentElement.dataset.ready = 'true';
}

init().catch(err => { $('#lb-sub').textContent = 'The wardrobe could not load: ' + err.message; });
