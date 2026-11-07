// Generate consistent product cutouts without altering registered garment layers.
export async function prepareProducts(manifest, productImages, isCurrent, onReady) {
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
      if(isCurrent())productImages.set(item.id,output.toDataURL('image/webp',.88));
    }catch{if(item.image && isCurrent())productImages.set(item.id,item.image);}
  };
  await Promise.all(Array.from({length:4},async()=>{while(cursor<entries.length)await prepare(entries[cursor++]);}));
  if(isCurrent())onReady();
}
