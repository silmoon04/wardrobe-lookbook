import {renderLook, resolveLayers, viewManifest, hasView} from './compositor.js';
import {smartShuffle} from './shuffle.js';
import {loadSettings,applySettings,saveSettings} from './settings.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const clone = value => structuredClone(value);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="../assets/icons/${['one_piece','socks','view-front','view-side','view-quarter'].includes(name) ? 'slots' : 'sprite'}.svg#${name}"></use></svg>`;
let KEY, SLOT_LIST = [], FILTERS = [], profile, settings, manifest, state, toastTimer;
let suggestionBatch = [], suggestionIndex = 0, beforeSuggestion, agentRequest, loadGeneration = 0;
const undo = [], redo = [];
let browse = {slot:'all', category:'all', colour:'all', status:'all', search:'', sort:'default', mode:'grid', index:0};
let curated = [], browseReturn;
const productImages=new Map();
const productImage=item=>productImages.get(item.id) || (profile?.id==='person' ? '' : item.image || '');

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2200);
}

function cleanLook(raw) {
  const look = {selected:{}, tucked:{base:false, mid:false}, outerOpen:true,shoes:settings.shoes,background:settings.background};
  if (!raw || typeof raw !== 'object') return look;
  for (const item of manifest.items) if (raw.selected?.[item.slot] === item.id) look.selected[item.slot] = item.id;
  for (const slot of ['base','mid']) look.tucked[slot] = raw.tucked?.[slot] === true;
  look.outerOpen = raw.outerOpen !== false;
  if (['none','af1','garment'].includes(raw.shoes)) look.shoes = raw.shoes;
  look.variants = raw.variants && typeof raw.variants === 'object' ? raw.variants : {};
  if (typeof raw.hair === 'string' && manifest.mannequin.hairOptions?.[raw.hair]) look.hair = raw.hair;
  if (typeof raw.head === 'string' && manifest.mannequin.headOptions?.[raw.head]) look.head = raw.head;
  if (raw.finish === 'smooth') look.finish = 'smooth';
  if (look.selected[profile.rules.onePiece]) {
    delete look.selected[profile.rules.topSlots[0]];
    delete look.selected[profile.rules.bottomSlot];
  }
  return look;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('Could not save to browser storage'); }
}

function remember(change) {
  const before = clone(state.look);
  change();
  if (JSON.stringify(before) === JSON.stringify(state.look)) return;
  undo.push(before);
  if (undo.length > 70) undo.shift();
  redo.length = 0;
  updateOutfit();
}

function apply(id) {
  const item = manifest.items.find(i => i.id === id);
  if (!item) return;
  if (!item.renderable) {showDetail(item); toast('Product only · layers are not available yet'); return;}
  remember(() => {
    if (item.slot === profile.rules.onePiece) {
      delete state.look.selected[profile.rules.topSlots[0]];
      delete state.look.selected[profile.rules.bottomSlot];
    } else if ([profile.rules.topSlots[0],profile.rules.bottomSlot].includes(item.slot)) delete state.look.selected[profile.rules.onePiece];
    state.look.selected[item.slot] = id;
    if (item.slot === 'shoes') {state.look.shoes='garment'; settings.shoes='garment'; applySettings(settings); saveSettings(settings);}
  });
}

function filtered() {
  const query = browse.search.trim().toLowerCase();
  const items = manifest.items.filter(i => (browse.slot === 'all' || i.slot === browse.slot)
    && (browse.category === 'all' || i.category === browse.category)
    && (browse.colour === 'all' || colourFamily(i) === browse.colour || i.colours.includes(browse.colour))
    && (browse.status === 'all' || statusOf(i) === browse.status)
    && `${i.label} ${i.shortLabel || ''} ${i.sourceLabel || ''} ${i.category} ${i.slot} ${SLOT_LIST.find(s=>s[0]===i.slot)?.[1] || ''} ${i.colours.join(' ')} ${(i.tags || []).join(' ')}`.toLowerCase().includes(query));
  if (browse.sort === 'az') items.sort((a,b) => a.label.localeCompare(b.label, 'en'));
  if (browse.sort === 'za') items.sort((a,b) => b.label.localeCompare(a.label, 'en'));
  if (browse.sort === 'category') items.sort((a,b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  if (browse.sort === 'colour') items.sort((a,b) => a.colours[0].localeCompare(b.colours[0]) || a.label.localeCompare(b.label));
  return items;
}

function setFilter(slot) {
  browse.slot = slot;
  browse.index = 0;
  renderBrowse();
  renderSlots();
}

function resetFilters() {
  Object.assign(browse, {slot:'all', category:'all', colour:'all', status:'all', search:'', sort:'default', index:0});
  $('#search').value = '';
  $('#sort').value = 'default';
  $('#category').value = 'all';
  renderBrowse();
  renderSlots();
}

function renderSlots() {
  $('#slots').innerHTML = SLOT_LIST.filter(([slot])=>manifest.items.some(i=>i.slot===slot)).map(([slot,label]) => {
    const item = manifest.items.find(i => i.id === state.look.selected[slot]);
    const unavailable = !manifest.items.some(i => i.slot === slot);
    return `<div class="slot ${unavailable ? 'slot-unavailable' : ''}" ${unavailable ? 'title="Not made yet" tabindex="0"' : ''}>
      <button class="slot-main ${browse.slot === slot ? 'active' : ''} ${item ? 'occupied' : ''}" data-slot="${slot}" aria-pressed="${browse.slot === slot}" aria-label="${label}${item ? ': '+escape(item.label) : unavailable ? ': not made yet' : ': empty'}" ${unavailable ? 'disabled' : ''}>
      ${icon(slot)}<span class="slot-label">${label}</span><span class="slot-count">${manifest.items.filter(i=>i.slot===slot).length}</span></button></div>`;
  }).join('');
}

function renderVariants() {
  const controls = [];
  const bottom=manifest.items.find(i=>i.id===state.look.selected.bottom);
  $('#finish-control').hidden=!Object.keys(bottom?.variants || {}).some(v=>v.endsWith('_smooth'));
  for (const [slot,label] of [['base','Base'], ['mid','Mid']]) {
    const item = manifest.items.find(i => i.id === state.look.selected[slot]);
    if (!item?.variants.solo_tucked || !item?.variants.solo_untucked) continue;
    const canTuck = !!item.variants.solo_tucked && !!state.look.selected.bottom;
    controls.push(`<div class="variant-group"><span class="variant-label">${label}</span><div class="segmented" role="group" aria-label="${label} hem">
      <button data-tuck="${slot}" data-value="false" aria-pressed="${!state.look.tucked[slot]}">Untucked</button>
      <button data-tuck="${slot}" data-value="true" aria-pressed="${state.look.tucked[slot]}" ${canTuck ? '' : 'disabled title="Add a bottom first"'}>Tucked</button></div></div>`);
  }
  if (state.look.selected.outer && manifest.items.find(i => i.id === state.look.selected.outer)?.variants.open && manifest.items.find(i => i.id === state.look.selected.outer)?.variants.closed) {
    const item = manifest.items.find(i => i.id === state.look.selected.outer);
    controls.push(`<div class="variant-group"><span class="variant-label">Outer</span><div class="segmented" role="group" aria-label="Outer closure">
      <button data-open="true" aria-pressed="${state.look.outerOpen}" ${item.variants.open ? '' : 'disabled'}>Open</button>
      <button data-open="false" aria-pressed="${!state.look.outerOpen}" ${item.variants.closed ? '' : 'disabled'}>Closed</button></div></div>`);
  }
  $('#variants').innerHTML = controls.join('');
}

function renderStages() {
  state.look.background = settings.background;
  state.look.shadows = settings.shadows !== false;
  const shown = viewManifest(manifest, state.view);
  renderLook($('#current-stage'), shown, state.look);
  const noView = Object.values(state.look.selected).filter(id => shown.items.find(i => i.id === id && !i.renderable) && manifest.items.find(i => i.id === id)?.renderable);
  $('#view-note').hidden = !noView.length;
  $('#view-note').textContent = noView.length ? `No ${state.view} view yet for ${noView.length === 1 ? 'one piece' : noView.length+' pieces'}.` : '';
  $$('[data-view]').forEach(b => {const on = b.dataset.view === state.view; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));});
  $('#mannequin-hair').value = state.look.hair || manifest.mannequin.defaultHair || '';
  $('#mannequin-head').value = state.look.head || manifest.mannequin.defaultHead || '';
  $('#shadow-toggle').checked = settings.shadows !== false;
  $('#bottom-finish').value = state.look.finish || 'default';
  $('#current-stage').setAttribute('aria-label', `Current outfit: ${Object.values(state.look.selected).map(id => manifest.items.find(i => i.id === id)?.label).filter(Boolean).join(', ') || 'empty'}`);
  const comparing = state.comparing && !!state.pinned;
  $('#stages').classList.toggle('comparing', comparing);
  $('.pinned-frame').hidden = !comparing;
  $('#stage-title').textContent = comparing ? 'Compare' : 'Current look';
  if (comparing) renderLook($('#pinned-stage'), shown, {...state.pinned,background:settings.background});
  else $('#pinned-stage').replaceChildren();
  $('#compare').disabled = !state.pinned;
  $('#compare').setAttribute('aria-pressed', String(comparing));
  $('#pin-label').textContent = state.pinned ? 'Update pin' : 'Pin look';
  $('#pin-look').setAttribute('aria-label', state.pinned ? 'Update pinned look' : 'Pin current look');
  const count = Object.keys(state.look.selected).length;
  $('#layer-count').textContent = `${count} garment${count === 1 ? '' : 's'}`;
}

function renderBrowse() {
  const items = filtered();
  browse.index = items.length ? ((browse.index % items.length) + items.length) % items.length : 0;
  $('#slot-filters').innerHTML = FILTERS.map(([slot,label]) => `<button class="filter-chip" data-filter="${slot}" aria-pressed="${browse.slot === slot}">${label}<span>${slot==='all' ? manifest.items.length : manifest.items.filter(i=>i.slot===slot).length}</span></button>`).join('');
  $$('#status-filters button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.status===browse.status)));
  $$('#swatches button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.colour === browse.colour)));
  const refinements=[browse.colour!=='all'&&browse.colour,browse.status!=='all'&&({'faults':'Open faults','held':'Held','product':'Product only','ready':'Preview ready'}[browse.status]),browse.category!=='all'&&browse.category].filter(Boolean);
  $('#result-count').textContent = `${items.length} of ${manifest.items.length} pieces${refinements.length ? ' · '+refinements.join(' · ') : ''}`;
  $('#filter-toggle').classList.toggle('active',!!refinements.length);
  $('#filter-toggle').setAttribute('aria-label',`Category filters${refinements.length?' ('+refinements.length+' active)':''}`);
  const grid = browse.mode === 'grid';
  $('.browser').classList.toggle('grid-view', grid);
  $('#rail-mode').classList.toggle('active', !grid);
  $('#grid-mode').classList.toggle('active', grid);
  $('#rail-mode').setAttribute('aria-pressed', String(!grid));
  $('#grid-mode').setAttribute('aria-pressed', String(grid));
  $('#garment-grid').hidden = !grid || !items.length;
  $('#rail-scene').hidden = grid || !items.length;
  $('#rail-navigation').hidden = grid || !items.length;
  $('#empty-state').hidden = !!items.length;
  $('#wear-item').disabled = !items.length;
  const labels = [];
  if (browse.slot !== 'all') labels.push(FILTERS.find(f => f[0] === browse.slot)?.[1] || browse.slot);
  if (browse.colour !== 'all') labels.push(browse.colour);
  if (browse.category !== 'all') labels.push(browse.category);
  $('#active-filter-label').textContent = labels.join(' / ') || 'All clothes';
  $('#empty-label').textContent = manifest.items.length ? 'No garments match these filters' : 'Your wardrobe is empty';
  $('#empty-import').hidden = !!manifest.items.length;
  $('#clear-empty').hidden = !manifest.items.length;
  const label = item => settings.labels === 'short' ? item.shortLabel || item.label : item.label;
  const photo = item => productImage(item) ? `<img src="${escape(productImage(item))}" alt="${escape(item.label)}" draggable="false">` : '<span class="missing-product">Preparing preview…</span>';
  $('#garment-grid').innerHTML = grid ? items.map(item => `<button class="garment-card" data-item="${item.id}" aria-pressed="${state.look.selected[item.slot] === item.id}" title="${item.renderable ? 'Wear' : 'Inspect'} ${escape(item.label)}"><span class="grid-photo">${photo(item)}${wearMark(item)}${!item.renderable ? '<span class="product-only">Product only</span>' : ''}</span><span class="garment-label">${escape(label(item))}</span><span class="garment-meta">${escape(item.colours[0] || 'Unknown')}</span></button>`).join('') : '';
  const visible = new Map();
  // Only five hangers are needed, even when the wardrobe is large.
  for (let delta = -2; delta <= 2; delta++) {
    if (!items.length) break;
    const index = (browse.index + delta + items.length) % items.length;
    if (!visible.has(index) || Math.abs(delta) < Math.abs(visible.get(index))) visible.set(index, delta);
  }
  $('#rail-items').innerHTML = !grid ? [...visible].map(([index,delta]) => {
    const item = items[index];
    const small = innerWidth < 481;
    const x = delta * (small ? 107 : 137);
    const scale = delta === 0 ? 1 : Math.abs(delta) === 1 ? .78 : .59;
    const turn = delta === 0 ? 0 : delta > 0 ? -24 : 24;
    return `<button class="rail-card" data-item="${item.id}" data-index="${index}" aria-label="${item.renderable ? 'Wear' : 'Inspect'} ${escape(item.label)}" aria-pressed="${state.look.selected[item.slot] === item.id}" style="transform:translateX(${x}px) translateY(${Math.abs(delta)*9}px) rotate(${delta*3}deg) scale(${scale});z-index:${3-Math.abs(delta)};opacity:${delta === 0 ? 1 : Math.abs(delta) === 1 ? .75 : .45}">${icon('hanger')}<span class="rail-photo">${photo(item)}${wearMark(item)}${!item.renderable ? '<span class="product-only">Product only</span>' : ''}</span></button>`;
  }).join('') : '';
  const focus = items[browse.index];
  $('#rail-name').textContent = focus ? label(focus) : '';
  $('#rail-category').textContent = focus ? `${focus.category} / ${focus.colours[0]}` : '';
  $('#rail-index').textContent = focus ? `${String(browse.index+1).padStart(2,'0')} / ${String(items.length).padStart(2,'0')}` : '';
  $('#previous').disabled = items.length < 2;
  $('#next').disabled = items.length < 2;
  $('#wear-item').innerHTML = `${focus && !focus.renderable ? 'View product' : focus && state.look.selected[focus.slot] === focus.id ? 'Wearing' : 'Wear garment'}${icon(focus && state.look.selected[focus.slot] === focus.id ? 'check' : 'right')}`;
  showDetail(focus);
}

function wearMark(item) {
  return state.look.selected[item.slot] === item.id ? `<span class="wear-mark">${icon('check')}<span>Wearing</span></span>` : '';
}

function renderSaved() {
  $('#saved-count').textContent = state.saved.length;
  $('#nav-saved-count').textContent = state.saved.length;
  $('#saved-list').innerHTML = state.saved.length ? state.saved.map(saved => `<div class="saved-card"><button class="saved-load" data-look="${saved.id}"><span class="saved-thumbnail"><span class="stage" data-thumbnail="${saved.id}" aria-hidden="true"></span></span><span><span class="saved-name">${escape(saved.name)}</span><span class="saved-meta">${Object.keys(saved.look.selected).length} garments</span></span></button><button class="icon-button delete-look" data-delete="${saved.id}" aria-label="Delete ${escape(saved.name)}">${icon('close')}</button></div>`).join('') : '<p class="saved-empty">No saved looks</p>';
  for (const saved of state.saved) renderLook($(`[data-thumbnail="${saved.id}"]`), manifest, saved.look);
  renderCurated();
}

function updateOutfit() {
  renderSlots();
  renderVariants();
  renderStages();
  renderBrowse();
  renderWorn();
  $('#undo').disabled = !undo.length;
  $('#redo').disabled = !redo.length;
  persist();
}

function step(amount) {
  browse.index += amount;
  renderBrowse();
}

function openSave() {
  $('#save-error').textContent='';
  $('#look-name').value = `Look ${state.saved.length + 1}`;
  $('#save-dialog').showModal();
  $('#look-name').select();
}

function randomise(seed) {
  remember(() => {
    const previous = JSON.stringify(state.look);
    for (let k = 0; k < 6; k++) {
      const {look} = smartShuffle(manifest, profile.rules, seed == null ? undefined : seed + k);
      if (!look.shoes) look.shoes = settings.shoes;
      state.look = cleanLook({...look, hair:state.look.hair, head:state.look.head});
      if (JSON.stringify(state.look) !== previous) break;
    }
  });
}

function bind() {
  $('#slots').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {remember(() => delete state.look.selected[remove.dataset.remove]); return;}
    const slot = event.target.closest('[data-slot]');
    if (slot && !slot.disabled) {resetFilters();setFilter(slot.dataset.slot); openBrowse(slot);}
  });
  $('#slot-filters').addEventListener('click', e => {const b = e.target.closest('[data-filter]'); if (b) setFilter(b.dataset.filter);});
  $('#garment-browser').addEventListener('click', e => {
    const button = e.target.closest('[data-item]');
    if (!button) return;
    browse.index=filtered().findIndex(i=>i.id===button.dataset.item);
    apply(button.dataset.item);
    renderBrowse();
    if (innerWidth<=700 && manifest.items.find(i=>i.id===button.dataset.item)?.renderable) closeBrowse();
  });
  $('#variants').addEventListener('click', e => {
    const tuck = e.target.closest('[data-tuck]'), open = e.target.closest('[data-open]');
    if (tuck && !tuck.disabled) remember(() => state.look.tucked[tuck.dataset.tuck] = tuck.dataset.value === 'true');
    if (open && !open.disabled) remember(() => state.look.outerOpen = open.dataset.open === 'true');
  });
  $('#search').addEventListener('input', e => {browse.search = e.target.value; browse.index = 0; renderBrowse();});
  $('#sort').addEventListener('change', e => {browse.sort = e.target.value; browse.index = 0; renderBrowse();});
  $('#category').addEventListener('change', e => {browse.category = e.target.value; browse.index = 0; renderBrowse();});
  $('#swatches').addEventListener('click', e => {const b = e.target.closest('[data-colour]'); if (b) {browse.colour = b.dataset.colour; browse.index = 0; renderBrowse();}});
  $('#colour-next').addEventListener('click',()=>{
    const strip=$('#swatches');
    strip.scrollTo({left:strip.scrollLeft+strip.clientWidth>=strip.scrollWidth-2 ? 0 : strip.scrollLeft+180});
  });
  $('#filter-toggle').addEventListener('click', () => {
    $('#category-panel').hidden = !$('#category-panel').hidden;
    $('#filter-toggle').setAttribute('aria-expanded', String(!$('#category-panel').hidden));
  });
  $('#reset-filters').addEventListener('click', resetFilters);
  $('#clear-empty').addEventListener('click', resetFilters);
  $('#rail-mode').addEventListener('click', () => {settings.browse = browse.mode = 'rail'; saveSettings(settings); renderBrowse();});
  $('#grid-mode').addEventListener('click', () => {settings.browse = browse.mode = 'grid'; saveSettings(settings); renderBrowse();});
  $('#previous').addEventListener('click', () => step(-1));
  $('#next').addEventListener('click', () => step(1));
  $('#wear-item').addEventListener('click', () => {const item = filtered()[browse.index]; if (item) apply(item.id);});
  $('#undo').addEventListener('click', () => {if (undo.length) {redo.push(clone(state.look)); state.look = undo.pop(); updateOutfit();}});
  $('#redo').addEventListener('click', () => {if (redo.length) {undo.push(clone(state.look)); state.look = redo.pop(); updateOutfit();}});
  $('#randomise').addEventListener('click', () => randomise());
  $('#pin-look').addEventListener('click', () => {state.pinned = clone(state.look); renderStages(); persist(); toast('Look pinned');});
  $('#compare').addEventListener('click', () => {state.comparing = !state.comparing; renderStages(); persist();});
  $('#save-look').addEventListener('click', openSave);
  $('#close-save').addEventListener('click', () => $('#save-dialog').close());
  $('#cancel-save').addEventListener('click', () => $('#save-dialog').close());
  $('#save-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#look-name').value.trim();
    if (!name) {$('#look-name').setCustomValidity('Enter a look name'); $('#look-name').reportValidity(); return;}
    const pid=profile.id,look=clone(state.look);
    try {await api('save',{ids:Object.values(look.selected),name});} catch (error) {$('#save-error').textContent=error.message; return;}
    if (profile.id!==pid) return;
    state.saved.push({id:crypto.randomUUID(), name, look});
    persist(); renderSaved(); $('#save-dialog').close(); toast('Look saved');
  });
  $('#look-name').addEventListener('input', () => $('#look-name').setCustomValidity(''));
  $('#saved-list').addEventListener('click', e => {
    const load = e.target.closest('[data-look]'), remove = e.target.closest('[data-delete]');
    if (load) {
      const saved = state.saved.find(s => s.id === load.dataset.look);
      if (saved) remember(() => state.look = clone(saved.look));
    }
    if (remove) {state.saved = state.saved.filter(s => s.id !== remove.dataset.delete); persist(); renderSaved();}
  });
  let startX;
  $('#rail-scene').addEventListener('pointerdown', e => {startX = e.clientX;});
  $('#rail-scene').addEventListener('pointerup', e => {
    if (startX !== undefined && Math.abs(e.clientX-startX) > 40) {
      step(e.clientX < startX ? 1 : -1);
      // The pointer gesture must not also select the garment at release.
      $('#rail-scene').addEventListener('click', event => event.stopPropagation(), {capture:true, once:true});
    }
    startX = undefined;
  });
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,select,textarea') || $('#save-dialog').open) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {e.preventDefault(); $(e.shiftKey ? '#redo' : '#undo').click();}
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {e.preventDefault(); $('#redo').click();}
    else if (e.key === 'ArrowLeft' && $('#rail-scene').contains(document.activeElement)) {e.preventDefault(); step(-1);}
    else if (e.key === 'ArrowRight' && $('#rail-scene').contains(document.activeElement)) {e.preventDefault(); step(1);}
    else if (e.key === 'Escape') resetFilters();
  });
  let resizeTimer,phone=innerWidth<=600;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    document.documentElement.dataset.layoutReady='false';
    const next=innerWidth<=600;
    if (next!==phone) {$('#agent-panel').open=!next;phone=next;}
    $('.fit-panel').open=innerWidth>700;
    arrangeBrowseFilters();
    resizeTimer=setTimeout(()=>{
      renderBrowse();
      document.documentElement.dataset.layoutReady='true';
    },80);
  });
  bindProfilesAndSettings();
  bindAgent();
}

async function loadProfile(id) {
  const generation = ++loadGeneration;
  agentRequest?.abort();
  document.documentElement.dataset.ready='false';
  document.documentElement.dataset.productsReady='false';
  $('#load-error').hidden=true;
  $('#main').inert=true;
  try {
  const response = await fetch(`api/profile?id=${encodeURIComponent(id)}`);
  const loaded = await response.json();
  if (!response.ok) throw new Error(loaded.error || 'Profile could not load');
  if (generation!==loadGeneration) return;
  ({profile,manifest}=loaded);
  KEY = `wardrobe:${profile.id}:looks`;
  settings = loadSettings(profile.id,profile.settingsDefaults);
  let rawSettings={};
  try {const raw=JSON.parse(localStorage.getItem(`wardrobe:${profile.id}:settings`) || '{}');if(raw && typeof raw==='object')rawSettings=raw;}catch{}
  if (!rawSettings.browse) settings.browse='grid';
  if (!rawSettings.background && profile.id==='person') settings.background='warm';
  if (!rawSettings.accent) settings.accent='#684557';
  settings.shadows=rawSettings.shadows!==false;
  SLOT_LIST = profile.rules.slots.map(s => [s.id,s.label]);
  FILTERS = [['all','All'],...SLOT_LIST.filter(([s])=>manifest.items.some(i=>i.slot===s))];
  undo.length=0; redo.length=0; suggestionBatch=[]; beforeSuggestion=null;
  $('#suggestion').hidden=true;
  $('#suggest').disabled=false;
  $('#suggest').removeAttribute('aria-busy');
  $('#agent-status').textContent='New combinations from your kept wardrobe.';
  $('#agent-prompt').value=''; $('#use-piece').checked=false;
  $('#agent-panel').open=false;
  Object.assign(browse,{slot:'all',category:'all',colour:'all',status:'all',search:'',sort:'default',mode:settings.browse,index:0});
  $('#search').value=''; $('#sort').value='default';
  let stored;
  try {stored = JSON.parse(localStorage.getItem(KEY) || 'null');} catch {stored = null;}
  let initial = profile.initialLook || {selected:{},outerOpen:true};
  if(profile.id==='person' && !stored?.look) {
    const selected={...initial.selected};
    for(const slot of ['base','bottom']) if(!selected[slot]) {const item=manifest.items.find(i=>i.slot===slot&&i.renderable);if(item)selected[slot]=item.id;}
    initial={...initial,selected};
  }
  const ids = new Set();
  const saved = (Array.isArray(stored?.saved) ? stored.saved : []).filter(s => {
    if (!s || typeof s.id !== 'string' || !/^[\w-]+$/.test(s.id) || ids.has(s.id) || typeof s.name !== 'string') return false;
    ids.add(s.id); return true;
  }).map(s => ({id:s.id, name:s.name.slice(0,60), look:cleanLook(s.look)}));
  state = {view:'front', look:cleanLook(stored?.look || initial), pinned:stored?.pinned ? cleanLook(stored.pinned) : null, comparing:stored?.comparing === true, saved};
  const colours = [...new Set(manifest.items.map(colourFamily))];
  $('#swatches').innerHTML = ['all',...colours].map(colour=>`<button class="swatch" data-colour="${colour}" aria-label="${colour==='all'?'All colours':colour}" aria-pressed="${colour==='all'}"><i style="background:${FAMILY_HEX[colour] || 'conic-gradient(#c1a18a,#66556b,#e5ded4)'}"></i>${colour==='all'?'All colours':colour}</button>`).join('');
  $('#category').innerHTML = '<option value="all">All categories</option>' + [...new Set(manifest.items.map(i => i.category))].sort().map(c => `<option value="${escape(c)}">${escape(c[0].toUpperCase()+c.slice(1))}</option>`).join('');
  $('#total-count').textContent = String(manifest.items.length).padStart(2,'0');
  $('#stage-note').textContent='Generated preview · Fit is an estimate';
  const real=manifest.items.filter(i=>i.renderable).length;
  $('#data-summary').textContent=`${real} with preview layers · ${manifest.items.length-real} product only`;
  $('#profile-switch').value=profile.id;
  for (const select of [$('#mannequin-shoes'),$('[data-setting="shoes"]')]) {
    select.querySelector('[value="af1"]').disabled=!manifest.mannequin.af1;
    select.querySelector('[value="garment"]').textContent=manifest.items.some(i=>i.slot==='shoes' && i.renderable) ? 'Garment footwear' : 'Garment footwear (none yet)';
  }
  $('[data-view="back"]').hidden = !hasView(manifest,'back');
  const hairs = Object.entries(manifest.mannequin.hairOptions || {});
  $('#hair-control').hidden = !hairs.length;
  $('#mannequin-hair').innerHTML = hairs.map(([id,o]) => `<option value="${escape(id)}">${escape(o.label || id)}</option>`).join('');
  const heads=Object.entries(manifest.mannequin.headOptions || {});
  $('#head-control').hidden=!heads.length;
  $('#mannequin-head').innerHTML=heads.map(([id,o])=>`<option value="${escape(id)}">${escape(o.label || id)}</option>`).join('');
  $('#finish-control').hidden = !manifest.items.some(i => Object.keys(i.variants || {}).some(v => v.endsWith('_smooth')));
  const url=new URL(location.href);url.searchParams.set('profile',profile.id);history.replaceState(null,'',url);
  try {localStorage.setItem('wardrobe:last-profile',profile.id);} catch {toast('Could not save browser preferences');}
  applySettings(settings); updateOutfit(); renderSaved();
  buildCurated();
  prepareProductImages(generation);
  for (const a of $$('a[href="lookbook.html"]')) a.href=`lookbook.html?profile=${encodeURIComponent(profile.id)}`;
  if (new URLSearchParams(location.search).has('browse')) openBrowse();
  // Read-only inspection API. Browser checks still perform actions through controls.
  window.wardrobeTest = {getState:() => clone({...state, browse, filtered:filtered().map(i => i.id)}),
    layers:(look,view) => clone(resolveLayers(viewManifest(manifest, view || 'front'), look || state.look)),
    shuffle:seed => {randomise(seed); return clone(state.look);}, setView:v => {state.view = v; renderStages();}, manifest:() => clone(manifest),profile:()=>clone(profile),settings:()=>clone(settings)};
  document.documentElement.dataset.ready = 'true';
  document.documentElement.dataset.layoutReady='true';
  } catch(error) {
    $('#load-error').hidden=false;
    $('#error-detail').textContent=error.message;
  } finally {if (generation===loadGeneration) $('#main').inert=false;}
}

function showDetail(item) {
  $('#piece-label').textContent=item?.label || 'Select a garment to see its details.';
  $('#piece-render-state').textContent=item ? item.renderable ? 'Layer preview' : 'Product only' : '';
  $('#piece-status').textContent=item ? `${item.category} · ${item.colours.join(', ')} · ${item.reviewState || 'awaiting owner review'}` : '';
  $('#piece-version').textContent=item ? `Version: ${item.versionStatus || 'imported'}${item.versionSource ? ' · '+item.versionSource : ''}` : '';
  $('#piece-note-list').innerHTML=(item?.notes || []).map(n=>`<li>${escape(n)}</li>`).join('');
  $('#piece-notes').hidden=!item;
}

async function api(endpoint,body,signal) {
  if (window.wardrobeStatic && ['save','accept'].includes(endpoint)) return {ok:true};
  const response = await fetch(`api/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:profile?.id,...body}),signal});
  const result=await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not finish. Please retry.');
  return result;
}

async function refreshProfiles(preferred) {
  const response=await fetch('api/profiles');
  if (!response.ok) throw new Error('Could not load the profile list. Start the local server.');
  const {profiles,defaultProfile}=await response.json();
  $('#profile-switch').innerHTML=profiles.map(p=>`<option value="${escape(p.id)}">${escape(p.displayName)}${p.demo ? ' (demo)' : ''}</option>`).join('');
  return profiles.some(p=>p.id===preferred) ? preferred : defaultProfile || profiles[0]?.id;
}

function changeSettings() {
  applySettings(settings);
  browse.mode=settings.browse;
  state.look.shoes=settings.shoes;
  try {saveSettings(settings);} catch {toast('Could not save browser preferences');}
  updateOutfit(); renderSaved();
}

async function uploadFiles(input,onlyModel=false) {
  const files=[...input.files];
  let total=0;
  const result=[];
  for (const file of files) {
    if (onlyModel && !['base.png','body.png','over.png','hair_back.png','bg.png','landmarks.json'].includes(file.name)) continue;
    if (!/\.(png|webp|jpe?g|json)$/i.test(file.name)) continue;
    total+=file.size;
    if (total>35000000) throw new Error('Upload is too large. Point to the local folder for imports above 35 MB.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader(); reader.onload=()=>resolve(reader.result.split(',')[1]); reader.onerror=()=>reject(new Error('Could not read '+file.name)); reader.readAsDataURL(file);});
    const relative=file.webkitRelativePath || file.name;
    result.push({name:relative.includes('/') ? relative.slice(relative.indexOf('/')+1) : relative,data});
  }
  return result;
}

function bindProfilesAndSettings() {
  $('#profile-switch').addEventListener('change',e=>loadProfile(e.target.value));
  $('#retry-profile').addEventListener('click',()=>loadProfile($('#profile-switch').value));
  $('#new-profile').addEventListener('click',()=>{$('#profile-error').textContent='';$('#profile-dialog').showModal();});
  $$('[data-close]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
  for (const id of ['add-garments','empty-import']) $('#'+id).addEventListener('click',()=>{$('#import-error').textContent='';$('#import-dialog').showModal();});
  $('#profile-form').addEventListener('submit',async e=>{
    e.preventDefault(); $('#create-profile').disabled=true; $('#profile-error').textContent='';
    try {
      const measurements={};
      for (const key of ['bust','waist','hip']) {
        const value=$('#measure-'+key).value;
        if (value) measurements[key]={value:Number(value),unit:'cm',kind:'reported'};
      }
      const result=await api('profiles',{name:$('#profile-name').value,folder:$('#profile-folder').value.trim(),files:await uploadFiles($('#profile-upload'),true),measurements});
      await refreshProfiles(result.id); await loadProfile(result.id);
      $('#profile-dialog').close(); $('#profile-form').reset(); toast('Profile created. Add garments to begin.');
    } catch(error) {$('#profile-error').textContent=error.message;}
    finally {$('#create-profile').disabled=false;}
  });
  $('#import-form').addEventListener('submit',async e=>{
    e.preventDefault(); $('#import-submit').disabled=true; $('#import-error').textContent='';
    const pid=profile.id;
    try {
      const result=await api('import',{folder:$('#import-folder').value.trim(),files:await uploadFiles($('#import-upload'))});
      if (profile.id===pid) await loadProfile(pid);
      $('#import-dialog').close(); $('#import-form').reset(); toast(`${result.imported} garments added`);
    } catch(error) {$('#import-error').textContent=error.message;}
    finally {$('#import-submit').disabled=false;}
  });
  $('#customize').addEventListener('click',()=>$('#settings-dialog').showModal());
  for (const id of ['close-settings','done-settings']) $('#'+id).addEventListener('click',()=>$('#settings-dialog').close());
  $$('[data-setting]').forEach(field=>field.addEventListener('change',()=>{
    settings[field.dataset.setting]=field.type==='checkbox' ? field.checked : field.value;
    changeSettings();
  }));
  $('#mannequin-shoes').addEventListener('change',e=>{settings.shoes=e.target.value; changeSettings();});
  $$('[data-view]').forEach(b => b.addEventListener('click', () => {if (!b.hidden) {state.view = b.dataset.view; renderStages();}}));
  $('#mannequin-hair').addEventListener('change', e => remember(() => state.look.hair = e.target.value));
  $('#mannequin-head').addEventListener('change', e => remember(() => state.look.head = e.target.value));
  $('#shadow-toggle').addEventListener('change',e=>{settings.shadows=e.target.checked;applySettings(settings);saveSettings(settings);updateOutfit();});
  $('#bottom-finish').addEventListener('change', e => remember(() => {if (e.target.value === 'smooth') state.look.finish = 'smooth'; else delete state.look.finish;}));
  $('#reset-settings').addEventListener('click',()=>{settings=clone(profile.settingsDefaults);changeSettings();toast('Profile defaults restored');});
}

function showSuggestion() {
  const outfit=suggestionBatch[suggestionIndex];
  if (!outfit) return;
  const selected={};
  for (const id of outfit.ids) {
    const item=manifest.items.find(i=>i.id===id);
    if (item) selected[item.slot]=id;
  }
  state.look=cleanLook({selected,shoes:settings.shoes});
  updateOutfit();
  $('#suggestion').hidden=false;
  $('#suggestion-reason').textContent=outfit.reason;
  const missing=outfit.ids.filter(id=>!manifest.items.find(i=>i.id===id)?.renderable);
  $('#suggestion-pieces').textContent=outfit.ids.map(id=>manifest.items.find(i=>i.id===id)?.label).join(' + ')+(missing.length ? ' · Some pieces have no preview layers.' : '');
  $('#suggestion-index').textContent=`${suggestionIndex+1} of ${suggestionBatch.length}`;
  $('#next-suggestion').disabled=suggestionBatch.length<2;
  $('#accept-suggestion').disabled=false;
}

function bindAgent() {
  $('#agent-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const pid=profile.id;
    agentRequest?.abort();
    const controller=agentRequest=new AbortController();
    const piece=filtered()[browse.index];
    $('#suggest').disabled=true; $('#suggest').setAttribute('aria-busy','true');
    $('#agent-status').textContent='Considering your wardrobe and previous outfits…';
    try {
      const result=await api('suggest',{prompt:$('#agent-prompt').value,requiredIds:$('#use-piece').checked && piece ? [piece.id] : [],decided:state.saved.map(s=>Object.values(s.look.selected))},controller.signal);
      if (pid!==profile.id) return;
      $('#agent-status').textContent=result.mode==='local fallback' ? 'Local fallback · category and colour rules' : 'Outfit assistant · new combinations checked';
      if (!result.outfits.length) {$('#agent-status').textContent += ' · '+result.message;return;}
      beforeSuggestion ||= clone(state.look);
      suggestionBatch=result.outfits; suggestionIndex=0; showSuggestion();
    } catch(error) {if (error.name!=='AbortError' && profile.id===pid) $('#agent-status').textContent=error.message;}
    finally {if (agentRequest===controller) {$('#suggest').disabled=false;$('#suggest').removeAttribute('aria-busy');}}
  });
  $('#next-suggestion').addEventListener('click',()=>{suggestionIndex=(suggestionIndex+1)%suggestionBatch.length;showSuggestion();});
  $('#close-suggestion').addEventListener('click',()=>{
    if (beforeSuggestion) remember(()=>state.look=clone(beforeSuggestion));
    beforeSuggestion=null; $('#suggestion').hidden=true;
  });
  $('#accept-suggestion').addEventListener('click',async()=>{
    const outfit=suggestionBatch[suggestionIndex], pid=profile.id;
    if (!outfit) return;
    $('#accept-suggestion').disabled=true;
    try {
      const name=`Suggested look ${state.saved.length+1}`;
      await api('accept',{ids:outfit.ids,name});
      if (pid!==profile.id) return;
      // Save the exact suggestion recipe, even if the stage was edited meanwhile.
      const selected=Object.fromEntries(outfit.ids.map(id=>[manifest.items.find(i=>i.id===id).slot,id]));
      state.saved.push({id:crypto.randomUUID(),name,look:cleanLook({selected,shoes:settings.shoes})});
      persist();renderSaved();beforeSuggestion=null;
      $('#suggestion').hidden=true; $('#agent-status').textContent='Saved as a decided look.';toast('Suggestion saved');
    } catch(error) {$('#agent-status').textContent=error.message;$('#accept-suggestion').disabled=false;}
  });
}

const FAMILY_HEX={Black:'#29272b',White:'#f9f7f0',Grey:'#999593',Blue:'#566985',Brown:'#9c7256',Beige:'#cbb796',Green:'#76816a',Red:'#a65b63',Purple:'#85708e',Other:'#c7a184'};
function colourFamily(item) {
  const c=(item.colours || []).join(' ').toLowerCase();
  for (const [family,pattern] of [['Black',/black|very dark/],['White',/white|ivory|cream/],['Grey',/grey|gray|charcoal/],['Blue',/blue|navy|denim/],['Brown',/brown|tan|camel|chocolate/],['Beige',/beige|sand|khaki|oat/],['Green',/green|olive/],['Red',/red|pink|burgundy/],['Purple',/purple|lilac/]]) if(pattern.test(c)) return family;
  return 'Other';
}
function statusOf(item) {
  const text=`${item.reviewState || ''} ${item.versionStatus || ''}`;
  return /hold|held/i.test(text) ? 'held' : /open faults|fail|fix/i.test(text) ? 'faults' : !item.renderable ? 'product' : 'ready';
}
function setupStudio() {
  // Retry a failed image twice without leaving a broken-image box on the stage.
  document.addEventListener('error',event=>{
    const img=event.target;
    if(!(img instanceof HTMLImageElement))return;
    const attempts=Number(img.dataset.loadRetries || 0);
    img.style.visibility='hidden';
    if(attempts<2){img.dataset.loadRetries=String(attempts+1);const src=new URL(img.src);src.searchParams.set('retry',String(attempts+1));setTimeout(()=>{if(img.isConnected)img.src=src.href;},200*(attempts+1));}
    else if(img.closest('#current-stage')) {$('#view-note').hidden=false;$('#view-note').textContent='A preview layer could not load. Change the view to retry.';}
  },true);
  document.addEventListener('load',event=>{if(event.target instanceof HTMLImageElement)event.target.style.removeProperty('visibility');},true);
  const header=$('.header-actions');
  header.insertAdjacentHTML('afterbegin',`<button id="header-search" class="icon-button" aria-label="Search wardrobe">${icon('search')}</button><a class="icon-button" href="#saved-section" aria-label="Saved looks">${icon('save')}</a><button id="menu-toggle" class="icon-button" aria-label="Workspace menu" aria-expanded="false" aria-controls="workspace-menu"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>`);
  const menu=document.createElement('div');menu.id='workspace-menu';menu.hidden=true;menu.className='workspace-menu';
  for(const selector of ['.profile-control','#new-profile','#customize']) menu.append($(selector));
  header.append(menu);
  $('.compare-actions').append($('#save-look'));
  const left=document.createElement('div');left.className='studio-sidebar';
  $('#slots').before(left);left.append($('#slots'));
  left.insertAdjacentHTML('beforeend','<section class="worn-section" aria-labelledby="worn-heading"><div class="worn-heading"><h2 id="worn-heading" class="eyebrow">GARMENT RAIL</h2><button id="browse-all" class="text-button">Browse all ↗</button></div><div id="worn-rail" class="worn-rail"></div><button class="outlined add-piece" id="add-piece">+ Add garment</button></section>');
  const fit=document.createElement('details');fit.className='fit-panel';fit.open=innerWidth>700;
  fit.innerHTML='<summary><span>Fit &amp; Layer</span><span class="fit-hint">Adjust your look</span></summary>';
  $('.studio-body').append(fit);fit.append($('.outfit-controls'));
  $('.outfit-controls').insertAdjacentHTML('beforeend','<label class="shoe-control" id="head-control" hidden>Face<select id="mannequin-head" aria-label="Mannequin face"></select></label><label class="check-label shadow-control">Shadows<input id="shadow-toggle" type="checkbox" checked role="switch" aria-label="Shadows"></label>');
  $('.studio-heading').after($('#randomise'));
  $('.curated-section').after($('#agent-panel'));
  const browser=$('.browser');
  browser.append($('#add-garments'));
  $('#add-garments').textContent='Import garments';
  browser.setAttribute('role','dialog');browser.setAttribute('aria-modal','true');browser.tabIndex=-1;
  $('#wardrobe-heading').firstChild.textContent='My wardrobe ';
  browser.querySelector('.mode-controls').insertAdjacentHTML('beforeend',`<button id="close-browse" class="icon-button" aria-label="Close wardrobe">${icon('close')}</button>`);
  $('#search').placeholder='Search pieces, colours, tags…';
  $('.palette-row').insertAdjacentHTML('afterend','<div id="status-filters" class="status-filters" role="group" aria-label="Filter by status"></div>');
  $('#status-filters').innerHTML=[['all','Any status'],['ready','Preview ready'],['held','Held'],['faults','Open faults'],['product','Product only']].map(([id,label])=>`<button class="filter-chip" data-status="${id}" aria-pressed="${id==='all'}">${label}</button>`).join('');
  const previewFilters=document.createElement('section');previewFilters.className='preview-filters';previewFilters.setAttribute('aria-labelledby','preview-status-heading');
  previewFilters.innerHTML='<h3 id="preview-status-heading">Preview status</h3><p>Held: awaiting review. Open faults: preview needs attention.</p>';
  $('#status-filters').before(previewFilters);previewFilters.append($('#status-filters'));
  arrangeBrowseFilters();
  $('#result-count').setAttribute('aria-live','polite');
  document.body.insertAdjacentHTML('beforeend','<button id="browse-scrim" class="browse-scrim" aria-label="Close wardrobe" tabindex="-1" hidden></button><div class="phone-dock"><button id="dock-browse" class="primary">Browse wardrobe <span aria-hidden="true">↗</span></button><a class="outlined" id="dock-looks" href="lookbook.html">Looks</a></div>');
  for(const id of ['header-search','nav-browse','browse-all','add-piece','dock-browse']) $('#'+id).addEventListener('click',e=>{if(id!=='header-search')resetFilters();openBrowse(e.currentTarget,id==='header-search');});
  for(const id of ['close-browse','browse-scrim']) $('#'+id).onclick=closeBrowse;
  $('#status-filters').onclick=e=>{const b=e.target.closest('[data-status]');if(b){browse.status=b.dataset.status;browse.index=0;renderBrowse();}};
  $('#worn-rail').onclick=e=>{const change=e.target.closest('[data-change]'),remove=e.target.closest('[data-remove]');if(remove)remember(()=>delete state.look.selected[remove.dataset.remove]);else if(change){resetFilters();setFilter(change.dataset.change);openBrowse(change);}};
  $('#menu-toggle').onclick=()=>{menu.hidden=!menu.hidden;$('#menu-toggle').setAttribute('aria-expanded',String(!menu.hidden));};
  document.addEventListener('click',e=>{if(!header.contains(e.target)){menu.hidden=true;$('#menu-toggle').setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]'))return;
    if(e.key==='Escape'&&!menu.hidden){e.preventDefault();e.stopImmediatePropagation();menu.hidden=true;$('#menu-toggle').setAttribute('aria-expanded','false');$('#menu-toggle').focus();return;}
    if(e.key==='Escape'&&!browser.hidden){e.preventDefault();e.stopImmediatePropagation();closeBrowse();return;}
    if(e.key==='Tab'&&!browser.hidden){const focusable=[...browser.querySelectorAll('button,input,select,a,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  },true);
  $('#curated-list').onclick=e=>{const b=e.target.closest('[data-curated]');if(!b)return;if(b.dataset.curated==='random')randomise();else {const c=curated[+b.dataset.curated];if(c)remember(()=>state.look=cleanLook(c.look));}$('#current-stage').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
}
function openBrowse(trigger,focusSearch=false) {
  browseReturn=trigger || document.activeElement;
  $('#browse-panel').hidden=false;$('#browse-scrim').hidden=false;
  document.body.classList.add('browsing');
  for(const el of [$('.studio'),$('.topbar'),$('.curated-section'),$('#saved-section'),$('.phone-dock')]) el.inert=true;
  (focusSearch?$('#search'):$('#close-browse')).focus();
}
function closeBrowse() {
  $('#browse-panel').hidden=true;$('#browse-scrim').hidden=true;
  document.body.classList.remove('browsing');
  for(const el of [$('.studio'),$('.topbar'),$('.curated-section'),$('#saved-section'),$('.phone-dock')]) el.inert=false;
  if(browseReturn?.isConnected && browseReturn.getClientRects().length)browseReturn.focus();else $('#header-search').focus();
}
function arrangeBrowseFilters() {
  if(!$('#status-filters'))return;
  const tools=$('.browser-tools'),panel=$('#category-panel'),palette=$('.palette-row'),status=$('.preview-filters'),count=$('#result-count'),sort=$('.sort-control');
  if(innerWidth<=700){panel.append(sort,palette,status);tools.after(count);}
  else {tools.append(sort);panel.after(palette);panel.append(status);palette.append(count);}
}
function renderWorn() {
  $('#worn-rail').innerHTML=Object.entries(state.look.selected).map(([slot,id])=>{const item=manifest.items.find(i=>i.id===id);if(!item)return '';return `<div class="worn-card"><button data-change="${slot}" aria-label="Change ${escape(item.label)}">${productImage(item)?`<img src="${escape(productImage(item))}" alt="">`:'<span class="product-placeholder" aria-hidden="true">'+icon(slot)+'</span>'}<span><strong>${escape(item.shortLabel || item.label)}</strong><small>${escape(SLOT_LIST.find(s=>s[0]===slot)?.[1] || slot)}</small></span><span aria-hidden="true">⌄</span></button><button class="remove-worn" data-remove="${slot}" aria-label="Remove ${escape(item.label)}">${icon('close')}</button></div>`;}).join('') || '<p class="saved-empty">Add a piece to start your look.</p>';
}
async function prepareProductImages(generation) {
  productImages.clear();
  const entries=manifest.items.map(item=>[item,Object.values(item.variants || {}).find(v=>v.front)?.front]);
  let cursor=0;
  const prepare=async([item,src])=>{
    if(!src)return;
    try {
      const img=new Image();img.src=src;await img.decode();
      const scan=document.createElement('canvas');scan.width=144;scan.height=256;
      const sc=scan.getContext('2d',{willReadFrequently:true});sc.drawImage(img,0,0,144,256);
      const pixels=sc.getImageData(0,0,144,256).data;let x0=144,y0=256,x1=0,y1=0;
      for(let y=0;y<256;y++)for(let x=0;x<144;x++)if(pixels[(y*144+x)*4+3]>35){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
      if(x1<=x0)return;
      const output=document.createElement('canvas');output.width=360;output.height=420;
      const scale=Math.min(320/(x1-x0),380/(y1-y0));const w=(x1-x0)*scale,h=(y1-y0)*scale;
      output.getContext('2d').drawImage(img,x0*img.width/144,y0*img.height/256,(x1-x0)*img.width/144,(y1-y0)*img.height/256,(360-w)/2,(420-h)/2,w,h);
      if(generation===loadGeneration)productImages.set(item.id,output.toDataURL('image/webp',.88));
    }catch{if(item.image && generation===loadGeneration)productImages.set(item.id,item.image);}
  };
  await Promise.all(Array.from({length:4},async()=>{while(cursor<entries.length)await prepare(entries[cursor++]);}));
  if(generation===loadGeneration){renderBrowse();renderWorn();document.documentElement.dataset.productsReady='true';}
}
function buildCurated() {
  curated=[];
  // These are local, reproducible wardrobe combinations, generated by the same rules as Random outfit.
  for(let i=0;i<5;i++) {const {look}=smartShuffle(manifest,profile.rules,810+i*91);curated.push({name:['Everyday layers','Keep it simple','A different texture','Out & about','One more idea'][i],look:cleanLook(look),kind:'Wardrobe suggestion'});}
  renderCurated();
}
function renderCurated() {
  if(!manifest)return;
  const saved=state.saved.map(s=>({name:s.name,look:s.look,kind:'Saved look'}));
  const cards=[...saved,...curated.filter(c=>c.kind!=='Saved look')];curated=cards;
  $('#curated-list').innerHTML=cards.map((c,i)=>`<button class="curated-card" data-curated="${i}"><span class="curated-image"><span class="stage" id="curated-${i}" aria-hidden="true"></span></span><strong>${escape(c.name)}</strong><small>${c.kind}</small></button>`).join('')+'<button class="curated-card random-card" data-curated="random"><span class="curated-image"><span aria-hidden="true">↝</span><span>Something<br>unexpected</span></span><strong>Random outfit</strong><small>Mix your wardrobe</small></button>';
  cards.forEach((c,i)=>renderLook($('#curated-'+i),manifest,{...c.look,background:settings.background,shadows:settings.shadows}));
}

async function start() {
  setupStudio();
  $$('[data-icon]').forEach(node=>node.innerHTML=icon(node.dataset.icon));
  let last;
  try {last=localStorage.getItem('wardrobe:last-profile');} catch {}
  const requested=new URLSearchParams(location.search).get('profile');
  const id=await refreshProfiles(requested || last);
  bind();
  await loadProfile(id);
}
start().catch(error=>{$('#load-error').hidden=false;$('#error-detail').textContent=error.message;});

