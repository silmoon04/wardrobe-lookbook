// Registered independent layers on one fixed canvas; no full-outfit image swaps.
// A view (front/back camera) swaps the canvas, mannequin and per-item variants. Items
// without layers for that view render nothing there, never the other view's pixels.
export function viewManifest(manifest, view) {
  const v = manifest.views?.[view];
  if (!v) return manifest;
  const byId = new Map((v.items || []).map(i => [i.id, i]));
  return {...manifest, canvas:v.canvas || manifest.canvas, mannequin:{...manifest.mannequin, ...v.mannequin},
    items:manifest.items.map(i => byId.has(i.id) && Object.keys(byId.get(i.id).variants || {}).length
      ? {...i, variants:byId.get(i.id).variants, renderable:true} : {...i, variants:{}, renderable:false})};
}

export function hasView(manifest, view) { return view === 'front' || !!manifest.views?.[view]; }
export function resolveLayers(manifest, look) {
  const equipped = Object.entries(look.selected).map(([slot,id]) => {
    const item = manifest.items.find(i => i.id === id && i.slot === slot);
    if (!item?.renderable || (slot === 'shoes' && look.shoes !== 'garment')) return null;
    const variants = item.variants;
    let requested = look.variants?.[slot];
    const tucked = !!look.tucked?.[slot] && !!look.selected.bottom && !!variants.solo_tucked;
    if (!requested) {
      if (slot === 'outer') requested = look.outerOpen === false ? 'closed' : 'open';
      else if (slot === 'bottom') {
        // Hem variant follows the shoe (af1, boots) and the finish (as worn or smooth).
        const shoe = look.shoes === 'af1' ? 'af1' : look.shoes === 'garment' && look.selected.shoes
          ? manifest.items.find(i => i.id === look.selected.shoes)?.hemVariant : null;
        const sm = look.finish === 'smooth' ? '_smooth' : '';
        requested = [shoe && `solo_${shoe}${sm}`, shoe && `solo_${shoe}`, `solo${sm}`, 'solo'].find(k => k && variants[k]);
      }
      else if (manifest.rules.topSlots.includes(slot)) {
        const covered=!!look.selected.outer || (slot===manifest.rules.topSlots[0] && !!look.selected.mid);
        requested=tucked ? 'solo_tucked' : covered && variants.under_outer ? 'under_outer' : 'solo_untucked';
      }
      else requested = 'solo';
    }
    const variant = variants[requested] ? requested : variants.default ? 'default' : Object.keys(variants)[0];
    return {item,slot,variant,asset:variants[variant],tucked};
  }).filter(Boolean);
  const order = equipped.some(l => l.tucked) ? manifest.rules.tuckedOrder : manifest.rules.frontOrder;
  const rank = l => order.indexOf(l.slot);
  equipped.sort((a,b) => rank(a)-rank(b));
  const result = [{src:look.background === 'neutral' || !look.background ? manifest.mannequin.bg : null,kind:'bg',key:'bg',role:'bg'}];
  const hair = manifest.mannequin.hairOptions?.[look.hair || manifest.mannequin.defaultHair] || null;
  result.push({src:hair ? hair.hair_back : manifest.mannequin.hair_back,kind:'hair-back',key:'hair_back',role:'hair_back'});
  const backRank = slot => {const rank=manifest.rules.backOrder.indexOf(slot);return rank<0 ? manifest.rules.backOrder.length : rank;};
  equipped.filter(l=>manifest.rules.backOrder.includes(l.slot)).sort((a,b) => backRank(a.slot)-backRank(b.slot)).forEach(l => {
    if (l.asset.back) result.push({src:l.asset.back,kind:'back',role:`${l.slot}.back`,key:`${l.item.id}:${l.variant}:back`});
  });
  // body_keep (alpha = keep) hides mannequin pixels that a garment's own render shows as covered or empty,
  // for example the arm strip between a generated sleeve and the torso.
  result.push({src:manifest.mannequin.body,kind:'body',key:'body',role:'body',
               masks:equipped.map(l => l.asset.body_keep).filter(Boolean)});
  let footwearAdded=false;
  const addFootwear=()=>{
    if (!footwearAdded && look.shoes === 'af1' && manifest.mannequin.af1) {
      result.push({src:manifest.mannequin.af1.shade,kind:'shade',role:'shoes',key:'af1:shade'});
      result.push({src:manifest.mannequin.af1.front,kind:'front',role:'shoes',key:'af1:front'});
    }
    footwearAdded=true;
  };
  for (const l of equipped) {
    if (order.indexOf(l.slot)>order.indexOf('shoes')) addFootwear();
    const masks = [];
    for (const upper of equipped) {
      if (upper === l) continue;
      const mask = l.asset.masks?.[`${upper.item.id}:${upper.variant}`];
      if (mask) masks.push(mask);
      if (upper.asset.inner_sleeve_mask && ((upper.slot === 'outer' && ['base','mid'].includes(l.slot)) || (upper.slot === 'mid' && l.slot === 'base')))
        masks.push(upper.asset.inner_sleeve_mask);
      // shoe_keep (alpha = keep) hides boot shafts that rise beside a narrow trouser hem
      if (l.slot === 'shoes' && upper.slot === 'bottom' && upper.asset.shoe_keep) masks.push(upper.asset.shoe_keep);
    }
    const prefix = `${l.item.id}:${l.variant}`;
    if (l.asset.shade) result.push({src:l.asset.shade,kind:'shade',role:l.slot,key:`${prefix}:shade`,masks});
    result.push({src:l.asset.front,kind:'front',role:l.slot,key:`${prefix}:front`,masks});
  }
  addFootwear();
  // Switchable hair sits over collars and below the hands.
  if (hair?.hair) result.push({src:hair.hair,kind:'hair',key:`hair:${look.hair || manifest.mannequin.defaultHair}`,role:'hair'});
  result.push({src:manifest.mannequin.over,kind:'over',key:'over',role:'over',
               masks:equipped.filter(l => !['bottom','socks','shoes'].includes(l.slot)).map(l => l.asset.over_effective).filter(Boolean)});
  // Hands hang over trousers, so only upper-body garments (sleeves) may cut the hands layer.
  return result.filter(l => l.src);
}

export function renderLook(target,manifest,look) {
  target.style.aspectRatio=`${manifest.canvas.width} / ${manifest.canvas.height}`;
  const layers = resolveLayers(manifest,look);
  const fragment = document.createDocumentFragment();
  for (const l of layers) {
    const img = document.createElement('img');
    img.className = `layer ${l.kind}`; img.src = l.src; img.alt = ''; img.draggable = false;
    img.dataset.layer = l.key; img.dataset.role = l.role;
    img.width = manifest.canvas.width; img.height = manifest.canvas.height;
    if (l.masks?.length) {
      img.style.maskImage = l.masks.map(p => `url("${p}")`).join(',');
      img.style.maskComposite = 'intersect';
    }
    fragment.append(img);
  }
  target.replaceChildren(fragment);
  target.dataset.stack = layers.map(l => l.key).join('|');
}
