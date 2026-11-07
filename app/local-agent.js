// Local suggestion tools are kept separate from the choosing interface.
export function createLocalAgent(h) {
  const {$,clone,cleanLook,filtered,api,updateOutfit,remember,persist,renderSaved,toast}=h;
  let suggestionBatch=[],suggestionIndex=0,beforeSuggestion,agentRequest;
function showSuggestion() {
  const outfit=suggestionBatch[suggestionIndex];
  if (!outfit) return;
  const selected={};
  for (const id of outfit.ids) {
    const item=h.manifest.items.find(i=>i.id===id);
    if (item) selected[item.slot]=id;
  }
  h.state.look=cleanLook({selected,shoes:h.settings.shoes});
  updateOutfit();
  $('#suggestion').hidden=false;
  $('#suggestion-reason').textContent=outfit.reason;
  const missing=outfit.ids.filter(id=>!h.manifest.items.find(i=>i.id===id)?.renderable);
  $('#suggestion-pieces').textContent=outfit.ids.map(id=>h.manifest.items.find(i=>i.id===id)?.label).join(' + ')+(missing.length ? ' · Some pieces have no preview layers.' : '');
  $('#suggestion-index').textContent=`${suggestionIndex+1} of ${suggestionBatch.length}`;
  $('#next-suggestion').disabled=suggestionBatch.length<2;
  $('#accept-suggestion').disabled=false;
}

function bind() {
  $('#agent-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const pid=h.profile.id;
    agentRequest?.abort();
    const controller=agentRequest=new AbortController();
    const piece=filtered()[h.browse.index];
    $('#suggest').disabled=true; $('#suggest').setAttribute('aria-busy','true');
    $('#agent-status').textContent='Considering your wardrobe and previous outfits…';
    try {
      const result=await api('suggest',{prompt:$('#agent-prompt').value,requiredIds:$('#use-piece').checked && piece ? [piece.id] : [],decided:h.state.saved.map(s=>Object.values(s.look.selected))},controller.signal);
      if (pid!==h.profile.id) return;
      $('#agent-status').textContent=result.mode==='local fallback' ? 'Local fallback · category and colour rules' : 'Outfit assistant · new combinations checked';
      if (!result.outfits.length) {$('#agent-status').textContent += ' · '+result.message;return;}
      beforeSuggestion ||= clone(h.state.look);
      suggestionBatch=result.outfits; suggestionIndex=0; showSuggestion();
    } catch(error) {if (error.name!=='AbortError' && h.profile.id===pid) $('#agent-status').textContent=error.message;}
    finally {if (agentRequest===controller) {$('#suggest').disabled=false;$('#suggest').removeAttribute('aria-busy');}}
  });
  $('#next-suggestion').addEventListener('click',()=>{suggestionIndex=(suggestionIndex+1)%suggestionBatch.length;showSuggestion();});
  $('#close-suggestion').addEventListener('click',()=>{
    if (beforeSuggestion) remember(()=>h.state.look=clone(beforeSuggestion));
    beforeSuggestion=null; $('#suggestion').hidden=true;
  });
  $('#accept-suggestion').addEventListener('click',async()=>{
    const outfit=suggestionBatch[suggestionIndex], pid=h.profile.id;
    if (!outfit) return;
    $('#accept-suggestion').disabled=true;
    try {
      const name=`Suggested look ${h.state.saved.length+1}`;
      await api('accept',{ids:outfit.ids,name});
      if (pid!==h.profile.id) return;
      // Save the exact suggestion recipe, even if the stage was edited meanwhile.
      const selected=Object.fromEntries(outfit.ids.map(id=>[h.manifest.items.find(i=>i.id===id).slot,id]));
      h.state.saved.push({id:crypto.randomUUID(),name,look:cleanLook({selected,shoes:h.settings.shoes})});
      persist();renderSaved();beforeSuggestion=null;
      $('#suggestion').hidden=true; $('#agent-status').textContent='Saved as a decided look.';toast('Suggestion saved');
    } catch(error) {$('#agent-status').textContent=error.message;$('#accept-suggestion').disabled=false;}
  });
}
  return {bind,reset(){
    agentRequest?.abort();suggestionBatch=[];suggestionIndex=0;beforeSuggestion=null;
  }};
}
