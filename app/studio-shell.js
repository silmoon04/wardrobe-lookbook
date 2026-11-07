// Navigation for the static workspace shell. Outfit changes stay in app.js.
export function setupShell(h) {
  const $=s=>document.querySelector(s), body=document.body;
  const menu=$('#workspace-menu'), browser=$('#browse-panel');
  browser.hidden=innerWidth<=700;
  menu.append($('#pin-look'));
  $('.stage-quick-actions').append($('#compare'),$('#customize'));
  const placeActions=()=>{
    const actions=$('.header-actions');
    actions.insertBefore($('#open-looks'),$('#save-look'));
    if(innerWidth<=700){
      actions.prepend($('#header-search'));
      $('.stage-panel').append($('#randomise'));
      menu.append($('.history-controls'));
      if($('#compare').getAttribute('aria-pressed')==='true')actions.insertBefore($('#compare'),$('#open-looks'));
      else menu.insertBefore($('#compare'),menu.querySelector('a'));
      $('#phone-settings').append($('#customize'));
    } else {
      actions.prepend($('#header-search'),$('#randomise'));
      $('.top-views').append($('.history-controls'));
      $('.stage-quick-actions').append($('#compare'),$('#customize'));
    }
    $('.stage-panel').append($('#show-layers'));
  };
  placeActions();window.addEventListener('resize',placeActions);
  $('#search').addEventListener('input',h.allSearch);
  $('#open-agent').onclick=()=>{menu.hidden=true;$('#agent-dialog').showModal();};
  const openMenu=on=>{menu.hidden=!on;$('#menu-toggle').setAttribute('aria-expanded',String(on));};
  for(const id of ['pin-look','compare'])$('#'+id).addEventListener('click',()=>openMenu(false));
  $('#menu-toggle').onclick=()=>openMenu(menu.hidden);
  $('#customize').addEventListener('click',()=>openMenu(false));
  const openLooks=()=>{h.close();openMenu(false);$('#looks-gallery').hidden=false;$('#saved-section').hidden=false;$('.curated-section').hidden=false;$('#main').inert=true;$('#close-looks').focus();};
  for(const button of document.querySelectorAll('[data-action=looks]'))button.onclick=openLooks;
  $('#close-looks').onclick=()=>{$('#looks-gallery').hidden=true;$('#main').inert=false;$('#menu-toggle').focus();};
  $('#header-search').onclick=()=>{openMenu(false);h.reset();h.open($('#header-search'),true);};
  $('#nav-browse').onclick=()=>{h.reset();h.open($('#nav-browse'));openMenu(false);};
  $('#close-browse').onclick=h.close;
  $('#close-layers').onclick=()=>body.classList.remove('show-layers');
  $('#show-layers').onclick=()=>{h.close();body.classList.toggle('show-layers');};
  $('#stage-previous').onclick=()=>h.step(-1);$('#stage-next').onclick=()=>h.step(1);
  $('#status-filters').onclick=e=>{const b=e.target.closest('[data-status]');if(b)h.status(b.dataset.status);};
  $('#worn-rail').onclick=e=>h.layerClick(e);
  $('#category-options').onclick=e=>h.layerClick(e);
  window.addEventListener('resize',h.resize);
  new ResizeObserver(([entry])=>body.style.setProperty('--settings-height',entry.target.getBoundingClientRect().height+'px')).observe($('#settings-dialog'));
  $('#curated-list').onclick=e=>{const b=e.target.closest('[data-curated]');if(b){h.curated(b.dataset.curated);$('#close-looks').click();}};
  $('#saved-list').addEventListener('click',e=>{if(e.target.closest('[data-look]'))$('#close-looks').click();});
  let start;
  $('#current-stage').addEventListener('pointerdown',e=>{start=[e.clientX,e.clientY];$('#current-stage').setPointerCapture(e.pointerId);});
  $('#current-stage').addEventListener('pointerup',e=>{if(start&&Math.abs(e.clientX-start[0])>45&&Math.abs(e.clientX-start[0])>Math.abs(e.clientY-start[1]))h.step(e.clientX<start[0]?1:-1);start=null;});
  $('#current-stage').addEventListener('pointercancel',()=>start=null);
  document.addEventListener('click',e=>{if(!menu.contains(e.target)&&!$('#menu-toggle').contains(e.target))openMenu(false);});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){openMenu(false);if(!$('#looks-gallery').hidden)$('#close-looks').click();body.classList.remove('show-layers');h.close();}
    if(e.target.matches('input,select,textarea')||document.querySelector('dialog[open]'))return;
    if(e.key==='/'){e.preventDefault();$('#header-search').click();}
    if(e.key.toLowerCase()==='f')$('[data-view=front]').click();
    if(e.key.toLowerCase()==='b')$('[data-view=back]').click();
    if(e.key.toLowerCase()==='z'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();$(e.shiftKey?'#redo':'#undo').click();}
    if(['ArrowLeft','ArrowRight'].includes(e.key)&&!$('#rail-scene').contains(document.activeElement)){e.preventDefault();h.step(e.key==='ArrowRight'?1:-1);}
  });
  // Dialogs close on backdrop; native dialogs provide focus containment.
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
}
