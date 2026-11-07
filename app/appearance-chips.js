// Small registered head crops, made from the existing layers in the browser.
const cache=new Map();
async function crop(manifest,head,hair,faceOnly=false) {
  const m=manifest.mannequin,h=m.headOptions?.[head],a=m.hairOptions?.[hair];
  const sources=(faceOnly?[h?.head||m.body]:[a?.hair_back,h?.head||m.body,a?.hair]).filter(Boolean);
  const key=String(faceOnly)+sources.join('|');
  if(!cache.has(key))cache.set(key,(async()=>{
    const images=await Promise.all(sources.map(async src=>{const i=new Image();i.src=src;await i.decode();return i;}));
    const {width:w,height:h}=manifest.canvas;
    const x=w*(faceOnly ? .395 : .36),y=h*(faceOnly ? .04 : .012);
    const cw=w*(faceOnly ? .215 : .28),ch=h*(faceOnly ? .15 : .19);
    const c=document.createElement('canvas');c.width=144;c.height=Math.round(144*ch/cw);
    const ctx=c.getContext('2d');
    for(const i of images)ctx.drawImage(i,x,y,cw,ch,0,0,c.width,c.height);
    return c.toDataURL('image/webp',.9);
  })());
  return cache.get(key);
}
export function renderAppearance(manifest,look,escape,label) {
  for(const [kind,options,value] of [
    ['hair',manifest.mannequin.hairOptions,look.hair||manifest.mannequin.defaultHair],
    ['face',manifest.mannequin.headOptions,look.head||manifest.mannequin.defaultHead]
  ]) {
    const target=document.querySelector('#'+kind+'-chips');
    const signature=JSON.stringify([manifest.mannequin.folder,options,value,look.head,look.hair]);
    if(target.dataset.signature===signature)continue;
    target.dataset.signature=signature;
    const names={F0:'Oval',F4:'Defined',G1:'Broad',G2:'Milder',G3:'Stronger'};
    target.innerHTML=Object.entries(options||{}).map(([id,o])=>`<button class="appearance-chip" data-action="choose-${kind}" data-appearance="${kind==='face'?'head':'hair'}" data-value="${escape(id)}" aria-label="${escape(label(o.label||id))}" aria-pressed="${id===value}" title="${escape(label(o.label||id))}">${kind==='face'?'<span>'+escape(names[id]||label(o.label||id))+'</span>':''}</button>`).join('');
    for(const button of target.children) {
      crop(manifest,kind==='face'?button.dataset.value:look.head||manifest.mannequin.defaultHead,kind==='hair'?button.dataset.value:look.hair||manifest.mannequin.defaultHair,kind==='face')
        .then(async src=>{const img=new Image();img.alt='';img.src=src;await img.decode();if(button.isConnected)button.prepend(img);}).catch(()=>{button.textContent=button.title;});
    }
  }
  document.querySelectorAll('[data-theme-value]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeValue===document.documentElement.dataset.theme)));
}
