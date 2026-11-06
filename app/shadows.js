// Runtime contact shadows. All distances below are in registered 576 px canvas units.
// Only effective (masked) alphas cast or receive light; the background never receives
// garment shadows. The small floor contact is a separate, explicit exception.
export const SHADOW_CONFIG = {
  base:   {blur:1.8, offset:2.0, opacity:0.29, falloff:0.20, ambient:0.025, tight:true},
  mid:    {blur:2.4, offset:3.0, opacity:0.46, falloff:0.18, ambient:0.14},
  outer:  {blur:2.6, offset:3.5, opacity:0.44, falloff:0.15, ambient:0.10},
  bottom: {blur:1.2, offset:2.0, opacity:0.06, falloff:0.15, ambient:0.01},
  one_piece: {blur:2.6, offset:3.0, opacity:0.24, falloff:0.25, ambient:0.08},
  socks:  {blur:1.2, offset:1.5, opacity:0.10, falloff:0.15, ambient:0.03},
  floor:  {blur:1.2, offset:0.5, opacity:0.08, falloff:0.65},
  tuck:   {blur:1.6, offset:3.0, opacity:0.34, falloff:0.12, ambient:0.035, upperOpacity:0.18, upperLift:0.8, upperBlur:0.4, inside:true},
  underlayer: {blur:2.2, offset:2.5, opacity:0.26, falloff:0.20, ambient:0.025, tight:true},
  rearOuter: {blur:3.0, offset:2.0, opacity:0.18, falloff:0.40, ambient:0.0},
  rearPadded: {blur:1.8, offset:2.5, opacity:0.30, falloff:0.16, ambient:0.04, tight:true},
  skin:   {receive:0.55},
  fabric: {pivot:0.45, darkBoost:1.8, maxOpacity:0.62},
};

let enabled = true;
const images = new Map(), alphas = new Map(), looks = new Map(), renders = new WeakMap();
const blurs = new WeakMap();
const layouts = new WeakMap();
const LIMIT = 96;
const cache = (map, key, value) => {
  map.delete(key); map.set(key, value);
  if (map.size > LIMIT) map.delete(map.keys().next().value);
  return value;
};
export function setShadowsEnabled(value) {
  enabled = value !== false;
  document.documentElement.dataset.shadows = String(enabled);
  for (const node of document.querySelectorAll('[data-shadow]')) node.style.display = enabled ? '' : 'none';
}
function surface(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  // These buffers are encoded as bitmaps. Avoid GPU readback for every layer.
  c.getContext('2d',{willReadFrequently:true});
  return c;
}
function load(src) {
  if (images.has(src)) return images.get(src);
  const img = new Image(); img.src = src;
  const ready = img.decode().then(() => img).catch(error => {images.delete(src); throw error;});
  return cache(images, src, ready);
}
function alpha(layer, w, h) {
  const key = JSON.stringify([w,h,layer.src,layer.masks || []]);
  if (alphas.has(key)) return alphas.get(key);
  const result = Promise.all([layer.src,...layer.masks || []].map(load)).then(parts => {
    const c = surface(w,h), ctx = c.getContext('2d');
    ctx.drawImage(parts[0],0,0,w,h);
    ctx.globalCompositeOperation = 'destination-in';
    for (const mask of parts.slice(1)) ctx.drawImage(mask,0,0,w,h);
    {
      const tiny=surface(72,128), sample=tiny.getContext('2d',{willReadFrequently:true});
      sample.drawImage(c,0,0,72,128);const data=sample.getImageData(0,0,72,128).data;
      let first=128,total=0,count=0,left=72,right=0,top=128,bottom=0;
      for (let y=0;y<128;y++) for (let x=0;x<72;x++) {
        const at=(y*72+x)*4;
        if(data[at+3]>1){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
        if (data[at+3]>160) {
          first=Math.min(first,y);total+=0.2126*data[at]+0.7152*data[at+1]+0.0722*data[at+2];count++;
        }
      }
      c.tone=count ? total/count/255 : 1;
      // Bounds belong to the alpha, even when an asset is reused in another slot.
      c.waist=first*h/128;
      c.bounds=right>left ? {left:left*w/72,right:right*w/72,top:top*h/128,bottom:bottom*h/128} : null;
      if(w<=256) {
        const pixels=ctx.getImageData(0,0,w,h).data;c.coverage=new Uint8Array(w*h);
        for(let i=0;i<c.coverage.length;i++)c.coverage[i]=pixels[i*4+3];
      }
      c.feet=new Uint8Array(72*28);
      for(let i=0;i<c.feet.length;i++) c.feet[i]=data[(100*72+i)*4+3];
    }
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
    return c;
  }).catch(error => {alphas.delete(key); throw error;});
  return cache(alphas, key, result);
}
function plane(w,h,role) {
  const c=surface(w,h), output=new Image();
  output.className='layer contact-shadow';output.dataset.shadow=role;
  output.setAttribute('aria-hidden','true');output.alt='';output.draggable=false;
  output.width=w;output.height=h;output.style.display=enabled ? '' : 'none';
  output.src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';
  output.shadowBuffer=c;c.output=output;
  return c;
}
function layoutShadows(target) {
  const s=getComputedStyle(target), n=p=>parseFloat(s[p]) || 0;
  const width=n('width')+(s.boxSizing==='border-box' ? -n('borderLeftWidth')-n('borderRightWidth') : n('paddingLeft')+n('paddingRight'));
  const height=n('height')+(s.boxSizing==='border-box' ? -n('borderTopWidth')-n('borderBottomWidth') : n('paddingTop')+n('paddingBottom'));
  for(const img of target.querySelectorAll('[data-shadow]')) {
    const f=img.shadowFrame;if(!f)continue;
    const fit=Math.min(width/f.width,height/f.height);
    Object.assign(img.style,{
      left:`${(width-f.width*fit)/2+f.x*fit}px`,top:`${(height-f.height*fit)/2+f.y*fit}px`,
      width:`${f.cropWidth*fit}px`,height:`${f.cropHeight*fit}px`,right:'auto',bottom:'auto',objectFit:'fill',visibility:'',
    });
  }
}
async function rasterAll(buffers) {
  // Visible canvas textures change Chromium's sampling of neighbouring blend
  // layers. A lossless bitmap keeps the existing garment raster path intact.
  await Promise.all(buffers.map(async c=>{
    const {x=0,y=0,width=c.width,height=c.height}=c.crop || {};
    const part=c.rasterPart || surface(width,height);
    if(!c.rasterPart)part.getContext('2d').drawImage(c,x,y,width,height,0,0,width,height);
    const img=c.output.cloneNode(false);img.shadowBuffer=c;
    img.shadowFrame={width:c.width,height:c.height,x,y,cropWidth:width,cropHeight:height};
    img.style.visibility='hidden';img.src=part.toDataURL('image/png');await img.decode();c.bitmap=img;
  }));
}
function blurred(caster,radius,tight=false) {
  let entries=blurs.get(caster);
  if (!entries) {entries=new Map();blurs.set(caster,entries);}
  const key=`${radius}:${tight}`;
  if (entries.has(key)) return entries.get(key);
  // Broad penumbrae need fewer samples than the receiving edge. Tight AO keeps
  // the working resolution; soft blurs use half that width.
  const ratio=radius<0.8 ? 1 : 0.5;
  const c=surface(Math.ceil(caster.width*ratio),Math.ceil(caster.height*ratio));
  const ctx=c.getContext('2d');ctx.filter=`blur(${radius*ratio}px)`;
  ctx.drawImage(caster,0,0,c.width,c.height);ctx.filter='none';
  // Suppress faint, distant tails while retaining opaque contact. This avoids
  // broad grey bands on light trousers without making a hard cutoff.
  if (tight) {ctx.globalCompositeOperation='destination-in';ctx.drawImage(c,0,0);ctx.globalCompositeOperation='source-over';}
  entries.set(key,c);
  while(entries.size>6)entries.delete(entries.keys().next().value);
  return c;
}
function cast(c, caster, receiver, config, scale) {
  const ctx = c.getContext('2d'), {width:w,height:h} = c;
  // A tight contact and a weaker soft penumbra share the same light direction.
  ctx.globalAlpha = config.opacity * (1-config.falloff);
  ctx.drawImage(blurred(caster,config.blur*scale,config.tight),0,config.offset*scale,w,h);
  ctx.globalAlpha = config.opacity * config.falloff;
  ctx.drawImage(blurred(caster,config.blur*2*scale,config.tight),0,config.offset*scale,w,h);
  // Symmetric, very tight occlusion also reaches the tucked waistband seam.
  ctx.globalAlpha = config.ambient;
  ctx.drawImage(blurred(caster,1.3*scale,config.tight),0,0,w,h);
  ctx.filter = 'none'; ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(receiver,0,0);
  // Matte transparency inside cloth must not reveal a shadow cast by that same
  // cloth. Tucked contact is explicitly on the receiving trouser rim instead.
  if (!config.inside) {ctx.globalCompositeOperation='destination-out';ctx.drawImage(caster,0,0);}
  ctx.globalCompositeOperation = 'source-over';
  if (caster.bounds) {
    const pad=Math.ceil((config.offset+6*config.blur+4)*scale)+2,b=caster.bounds;
    const x=Math.max(0,Math.floor(b.left-pad)),y=Math.max(0,Math.floor(b.top-pad));
    c.crop={x,y,width:Math.max(1,Math.min(w,Math.ceil(b.right+pad))-x),height:Math.max(1,Math.min(h,Math.ceil(b.bottom+pad))-y)};
  }
}
function floor(c, shapes, scale) {
  // Sample the silhouette at low resolution to find the actual two sole contacts.
  const pixels=new Uint8Array(72*28);
  for(const shape of shapes) if(shape?.feet) for(let i=0;i<pixels.length;i++) pixels[i]=Math.max(pixels[i],shape.feet[i]);
  const occupied=(x,y)=>pixels[(y-100)*72+x]>160;
  let bottom = -1;
  for (let y=127;y>=100 && bottom<0;y--) for (let x=0;x<72;x++) if (occupied(x,y)) {bottom=y;break;}
  if (bottom<0) return;
  const cropY=Math.max(0,Math.floor((bottom-4)*c.height/128-16*scale));
  c.crop={x:0,y:cropY,width:c.width,height:c.height-cropY};
  const runs=[]; let start=-1;
  for (let x=0;x<=72;x++) {
    let hasSole=false;
    if (x<72) for (let y=Math.max(100,bottom-2);y<=bottom;y++) if (occupied(x,y)) hasSole=true;
    if (hasSole && start<0) start=x;
    if (!hasSole && start>=0) {if (x-start>=2) runs.push([start,x]);start=-1;}
  }
  const out=c.getContext('2d'), config=SHADOW_CONFIG.floor, sx=c.width/72, sy=c.height/128;
  out.filter=`blur(${config.blur*scale}px)`;
  for (const [left,right] of runs) {
    const x=(left+right)*sx/2, y=(bottom+0.5)*sy+config.offset*scale;
    const rx=(right-left)*sx*0.42, ry=1.6*scale;
    const gradient=out.createRadialGradient(x,y,0,x,y,rx);
    gradient.addColorStop(0,`rgba(0,0,0,${config.opacity})`);
    gradient.addColorStop(config.falloff,`rgba(0,0,0,${config.opacity*0.45})`);
    gradient.addColorStop(1,'rgba(0,0,0,0)');
    out.save(); out.translate(x,y); out.scale(1,ry/rx); out.translate(-x,-y);
    out.fillStyle=gradient; out.fillRect(x-rx,y-rx,2*rx,2*rx); out.restore();
  }
  out.filter='none';
}

export function attachShadows(target, layers, nodes, size, items=[]) {
  // Soft fields use 192 px; fine waistband contact retains native resolution.
  const w=Math.round(size.width/3), h=Math.round(size.height/3), scale=w/576;
  const token = {}; renders.set(target,token); target.dataset.shadowReady='false';
  if(!layouts.has(target)) {
    const observer=new ResizeObserver(()=>{
      if(!target.isConnected){observer.disconnect();layouts.delete(target);return;}
      layoutShadows(target);
    });
    layouts.set(target,observer);observer.observe(target);
  }
  delete target.dataset.shadowError;
  const floorPlane = plane(w,h,'floor');
  const first = layers.findIndex(l => l.kind !== 'bg');
  if (first>=0) target.insertBefore(floorPlane.output,nodes[first]);
  else target.append(floorPlane.output);
  const casters = new Map();
  const tucks=[];
  layers.forEach((layer,i) => {
    if (layer.kind==='front' && SHADOW_CONFIG[layer.role] && layer.role!=='floor') {
      const c=plane(w,h,layer.role); target.insertBefore(c.output,nodes[i]); casters.set(i,c);
    }
  });
  // A tucked shirt is behind the waistband. Its normal cast is consequently
  // covered by the trousers. Keep a tight contact on the receiving waistband,
  // after its image and before any higher garment, without changing stack rules.
  layers.forEach((layer,i)=>{
    if (layer.kind!=='front' || layer.role!=='bottom') return;
    const tops=layers.slice(0,i).map((l,j)=>({l,j})).filter(({l})=>l.kind==='front' && ['base','mid'].includes(l.role) && l.key.includes(':solo_tucked:'));
    if (!tops.length) return;
    const key=`tuck:${i}`, c=plane(size.width,size.height,'tuck');
    target.insertBefore(c.output,nodes[i].nextSibling);casters.set(key,c);
    tucks.push({key,top:tops[tops.length-1].j,bottom:i});
  });
  const start=performance.now();
  const rear=layers.some(l=>l.kind==='body' && l.src.includes('/back/'));
  const outer=rear && items.find(i=>i.slot==='outer' && layers.some(l=>l.role==='outer' && l.key.startsWith(i.id+':')));
  const padded=!!outer && /puffer|puffy|padded|hoodie|fleece/i.test(outer.label || '');
  const key=JSON.stringify([size.width,size.height,w,h,padded,SHADOW_CONFIG,layers.map(l=>[l.src,l.kind,l.role,l.masks])]);
  let prepared=looks.get(key);
  if (!prepared) {
    const work=layers.map(l => ['bg','shade','hair-back','hair'].includes(l.kind) ? Promise.resolve(null) : alpha(l,w,h));
    const nativeTucks=tucks.map(async tuck=>({...tuck,shapes:await Promise.all([tuck.top,tuck.bottom].map(i=>alpha(layers[i],size.width,size.height)))}));
    prepared=Promise.all([Promise.all(work),Promise.all(nativeTucks)]).then(([shapes,tuckShapes]) => {
      const receiver=surface(w,h), ctx=receiver.getContext('2d'), contacts=new Map();
      const visibility=new Float32Array(w*h);
      const active=[],seen=new Uint8Array(w*h);
      // Aligned shadows from one studio light do not block that light twice.
      // Track only currently exposed shadow pixels as garment images cover them.
      const cap=(c,roi=null)=>{
        const r=roi || c.crop || {x:0,y:0,width:c.width,height:c.height};
        const out=c.getContext('2d'), image=out.getImageData(r.x,r.y,r.width,r.height),p=image.data;
        let changed=false;
        for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
          const at=(y*r.width+x)*4+3,a=p[at]/255;if(!a)continue;
          const k=roi ? Math.min(h-1,Math.floor((y+r.y)*h/c.height))*w+Math.min(w-1,Math.floor((x+r.x)*w/c.width)) : (y+r.y)*w+x+r.x;
          const old=visibility[k],next=a>old ? Math.round(255*(a-old)/(1-old)) : 0;
          if(p[at]!==next){p[at]=next;changed=true;}
          if(!roi){visibility[k]=old+next/255*(1-old);if(!seen[k]){seen[k]=1;active.push(k);}}
        }
        if(changed)out.putImageData(image,r.x,r.y);
      };
      let receiverTone=1;
      layers.forEach((layer,i) => {
        if (casters.has(i)) {
          const coveredBase=layer.role==='base' && layers.slice(i+1).some(l=>l.kind==='front' && ['mid','outer'].includes(l.role));
          const original=coveredBase ? SHADOW_CONFIG.underlayer : rear && layer.role==='outer' ? SHADOW_CONFIG[padded ? 'rearPadded' : 'rearOuter'] : SHADOW_CONFIG[layer.role], material=SHADOW_CONFIG.fabric;
          // Dark cloth needs a little more relative contact contrast. Distance and
          // falloff stay local; pale cloth keeps the restrained base density.
          const gain=['base','mid'].includes(layer.role) ? 1+Math.max(0,material.pivot-receiverTone)*material.darkBoost : 1;
          const config={...original,opacity:Math.min(material.maxOpacity,original.opacity*gain),ambient:original.ambient*gain};
          const c=casters.get(i);cast(c,shapes[i],receiver,config,scale);cap(c);contacts.set(i,c);
        }
        if (shapes[i]) {
          ctx.globalAlpha=['body','head','over'].includes(layer.kind) ? SHADOW_CONFIG.skin.receive : 1;
          ctx.drawImage(shapes[i],0,0);ctx.globalAlpha=1;
          if (layer.kind==='front' && !['shoes','socks'].includes(layer.role)) receiverTone=shapes[i].tone ?? 1;
          const coverage=shapes[i].coverage;
          if(coverage)for(const k of active)visibility[k]*=1-coverage[k]/255;
        }
      });
      for(const {key,shapes:[top,bottom]} of tuckShapes) {
        // The tucked source can retain a long hidden shirt tail. Receive only
        // inside the top rim, never across the jeans behind that hidden tail.
        const nw=size.width,nh=size.height,ns=nw/576,config=SHADOW_CONFIG.tuck;
        // Filter a native strip, with generous kernel padding, rather than the
        // whole registered image. The output plane still keeps the full canvas.
        const y=Math.max(0,Math.floor(((bottom.waist || 0)-24*ns)/2)*2);
        const rh=Math.min(nh-y,Math.ceil(112*ns/2)*2);
        const cut=source=>{const c=surface(nw,rh);c.getContext('2d').drawImage(source,0,y,nw,rh,0,0,nw,rh);return c;};
        const localTop=cut(top),localBottom=cut(bottom),limit=Math.ceil((bottom.waist || 0)-y+48*ns);
        const rim=surface(nw,rh), rc=rim.getContext('2d');
        rc.drawImage(localBottom,0,0);rc.globalCompositeOperation='destination-out';
        rc.globalAlpha=0.5;rc.drawImage(localBottom,0,2*ns);
        rc.globalAlpha=1;rc.drawImage(localBottom,0,4*ns);
        rc.clearRect(0,limit,nw,rh);
        const contact=surface(nw,rh);cast(contact,localTop,rim,config,ns);
        // Native-resolution upper contact is less than one registered pixel tall.
        // There is no Gaussian halo above the waistband or sideways onto the hips.
        const upper=surface(nw,rh), uc=upper.getContext('2d');
        uc.filter=`blur(${config.upperBlur*ns}px)`;uc.drawImage(localBottom,0,-config.upperLift*ns);uc.filter='none';
        uc.globalCompositeOperation='destination-out';uc.drawImage(localBottom,0,0);
        uc.globalCompositeOperation='destination-in';uc.drawImage(localTop,0,0);
        uc.clearRect(0,limit,nw,rh);
        const local=contact.getContext('2d');local.globalAlpha=config.upperOpacity;local.drawImage(upper,0,0);local.globalAlpha=1;
        const c=casters.get(key);c.getContext('2d').drawImage(contact,0,y);
        cap(c,{x:0,y,width:nw,height:rh});
        contact.getContext('2d').clearRect(0,0,nw,rh);contact.getContext('2d').drawImage(c,0,y,nw,rh,0,0,nw,rh);
        c.crop={x:0,y,width:nw,height:rh};c.rasterPart=contact;
        contacts.set(key,c);
      }
      // Grounding is measured from solid soles, independently of skin attenuation.
      const ground=floorPlane;floor(ground,shapes,scale);
      return rasterAll([...contacts.values(),ground]).then(()=>({
        contacts:new Map([...contacts].map(([i,c])=>[i,c.bitmap])),ground:ground.bitmap,
      }));
    }).catch(error=>{looks.delete(key);throw error;});
    cache(looks,key,prepared);
    while (looks.size>12) looks.delete(looks.keys().next().value);
  }
  const ready=prepared.then(async({contacts,ground}) => {
    if (renders.get(target)!==token || !floorPlane.output.parentNode) return;
    const publish=async(placeholder,prepared)=>{
      if (placeholder===prepared) return;
      // Revisit a detached cached plane without copying its pixels. A pinned look
      // or thumbnail that still owns the plane gets an independent image node.
      if (!prepared.parentNode) {
        prepared.style.display=enabled ? '' : 'none';prepared.style.visibility='hidden';placeholder.replaceWith(prepared);
      } else {
        const copy=prepared.cloneNode(false);copy.shadowBuffer=prepared.shadowBuffer;copy.shadowFrame=prepared.shadowFrame;
        copy.style.display=enabled ? '' : 'none';copy.style.visibility='hidden';
        if (!copy.complete || !copy.naturalWidth) await copy.decode();
        placeholder.replaceWith(copy);
      }
    };
    await Promise.all([publish(floorPlane.output,ground),...[...contacts].map(([i,c])=>publish(casters.get(i).output,c))]);
    if (renders.get(target)!==token) return;
    layoutShadows(target);
    target.dataset.shadowMs=(performance.now()-start).toFixed(2);
    target.dataset.shadowTotalMs=(performance.now()-start).toFixed(2);
    target.dataset.shadowReady='true';
  }).catch(error => {
    if (renders.get(target)!==token) return;
    // Missing assets keep the original image stack usable; expose failure to checks.
    target.dataset.shadowError=String(error); target.dataset.shadowReady='true';
  });
  target.shadowReady=ready;
  return ready;
}
