const diskState={result:null,preview:null,selected:null,scanning:false,context:false,contextAvailable:false,consuming:false};
const bytesLabel=bytes=>{if(!bytes)return '0 B';const units=['B','KB','MB','GB','TB'];const i=Math.min(4,Math.floor(Math.log(bytes)/Math.log(1024)));return (bytes/1024**i).toFixed(i>0?1:0)+' '+units[i];};
async function mapFolder(directory){
  if(isBusy())return;
  $('#map-folder-dialog').close();switchPage('disk');diskState.scanning=true;$('#disk-status').textContent='Reading folders…';$('#disk-cancel').classList.remove('hidden');
  await task(async()=>{
    diskState.result=null;diskState.preview=null;diskState.selected=null;renderDisk();
    try{diskState.result=await api.invoke('diskMap',{directory});$('#disk-directory').value=diskState.result.root.path;renderDisk();}
    catch(error){$('#disk-status').textContent=error.message;throw error;}
    finally{diskState.scanning=false;diskState.preview=null;$('#disk-cancel').classList.add('hidden');}
  });
}
function diskMenu(node,event){event.preventDefault();event.stopPropagation();api.invoke('diskMenu',{id:node.id}).then(result=>{if(result?.action==='map')mapFolder(node.path);if(result?.action==='reveal')api.invoke('diskReveal',{id:node.id}).catch(e=>notice(e.message,true));if(result?.action==='delete')deleteDiskNode(node);}).catch(e=>notice(e.message,true));}
async function selectDiskNode(node){
  diskState.selected=node;$('#disk-selected').textContent=node.path;$('#disk-selected-size').textContent=bytesLabel(node.size)+' · '+(node.kind==='directory'?'Folder':'File');
  $('#disk-delete').classList.add('hidden');$('#disk-selection').classList.remove('hidden');$('#disk-map-selected').classList.toggle('hidden',node.kind!=='directory');
  $('#disk-protection').textContent='Checking deletion protections…';
  try{const decision=await api.invoke('diskPolicy',{id:node.id});if(diskState.selected!==node)return;$('#disk-protection').textContent=decision.reason;$('#disk-delete').classList.toggle('hidden',!decision.allowed);}catch(e){$('#disk-protection').textContent=e.message;}
}
async function deleteDiskNode(node){
  const folder=diskState.result.root.path;
  await task(async()=>{await api.invoke('diskDelete',{id:node.id});diskState.result=null;diskState.preview=null;diskState.selected=null;renderDisk();notice('Moved to the Recycle Bin. Map the folder again to refresh its sizes.');$('#disk-directory').value=folder;});
}
function renderDisk(){
  const result=diskState.result||diskState.preview,tree=$('#disk-treemap');$('#disk-root-path').textContent=result?.root.path||'No folder mapped';tree.replaceChildren();$('#disk-selection').classList.toggle('hidden',!result||!diskState.selected);
  if(!result){tree.append(el('div','disk-empty',diskState.scanning?'Mapping your folder. You can cancel at any time.':'Choose a folder to see where its space goes.'));$('#disk-summary').textContent='Logical file sizes · links are not followed';$('#disk-rows').replaceChildren();return;}
  $('#disk-status').textContent=(result.preview?'Scanning — live totals so far. ':result.limited?'Partial map — requested scan limit reached. ':'Map complete. ')+result.skipped+' unreadable entries · '+result.links+' links skipped';
  $('#disk-summary').textContent=bytesLabel(result.root.size)+' mapped · '+result.entries.toLocaleString()+' entries · '+(result.elapsed/1000).toFixed(1)+'s';
  const children=result.root.children||[];const w=tree.clientWidth,h=400;
  const colors=['blue','teal','purple','amber','slate'];
  let budget=0;
  function draw(node,container,width,height,depth,color){
    const all=(node.children||[]).filter(n=>n.size>0).sort((a,b)=>b.size-a.size);const items=all.slice(0,70);
    if(all.length>70)items.push({name:'Other entries ('+(all.length-70)+')',size:all.slice(70).reduce((s,n)=>s+n.size,0),aggregate:true});
    // Reserve sibling tiles before drawing descendants so one branch cannot hide the others.
    if(budget+items.length>500)return;budget+=items.length;
    for(const [index,r] of System69Treemap.layout(items,width,height).entries()){
      const n=r.item,block=el('div','disk-block '+(color||colors[index%colors.length]));
      block.style.left=r.x+'px';block.style.top=r.y+'px';block.style.width=r.width+'px';block.style.height=r.height+'px';
      if(!n.aggregate){block.dataset.nodeid=n.id;block.addEventListener('click',e=>{e.stopPropagation();selectDiskNode(n);});block.addEventListener('contextmenu',e=>diskMenu(n,e));}
      if(r.width>55&&r.height>28){const label=el(n.aggregate?'span':'button','disk-tile-label',n.name+(r.height>48?' · '+bytesLabel(n.size):''));if(!n.aggregate){label.type='button';label.title=n.path+' · '+bytesLabel(n.size);label.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))diskMenu(n,e);});}block.append(label);}
      container.append(block);
      if(!n.aggregate&&depth<Number($('#disk-depth').value)-1&&n.children?.length&&r.width>115&&r.height>85){const inside=el('div','disk-inside');inside.style.width=(r.width-8)+'px';inside.style.height=(r.height-30)+'px';block.append(inside);draw(n,inside,r.width-8,r.height-30,depth+1,color||colors[index%colors.length]);}
    }
  }
  if(result.root.size)draw(result.root,tree,w,h,0,null);else tree.append(el('div','disk-empty','No readable file bytes found. Empty folders are listed below.'));
  const list=$('#disk-rows');list.replaceChildren();for(const n of children.slice().sort((a,b)=>b.size-a.size).slice(0,100)){
    const row=el('tr'),name=el('td');if(n.aggregate){name.textContent=n.name;}else{const button=el('button','text-button disk-list-name',n.name);button.type='button';button.addEventListener('click',()=>selectDiskNode(n));button.addEventListener('contextmenu',e=>diskMenu(n,e));button.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))diskMenu(n,e);});name.append(button);}row.append(name,el('td','',result.preview?'Scanning…':n.aggregate?'Summary — map this folder for detail':n.kind==='directory'?'Folder':'File'),el('td','mono',bytesLabel(n.size)));list.append(row);
  }
}
async function loadContextStatus(){try{const status=await api.invoke('contextStatus');diskState.context=status.enabled;diskState.contextAvailable=status.available;$('#disk-context-toggle').textContent=status.enabled?'Remove Explorer menu entry':'Add “Map with System69” to Explorer';lockButton($('#disk-context-toggle'),!status.available);$('#disk-context-status').textContent=status.available?(status.enabled?'Enabled for this Windows user.':'Optional · currently disabled for this Windows user.'):'Available in the installed build. Disabled by default.';}catch(e){$('#disk-context-status').textContent=e.message;}}
async function consumeMapRequest(){if(isBusy()||diskState.consuming)return;diskState.consuming=true;try{const folder=await api.invoke('pendingMap');if(folder){await mapFolder(folder);setTimeout(consumeMapRequest,0);}}finally{diskState.consuming=false;}}
$('#disk-open-picker').addEventListener('click',()=>{$('#map-folder-dialog').showModal();});
$('#disk-browse').addEventListener('click',async()=>{try{const selected=await api.invoke('diskChoose',{directory:$('#disk-directory').value});if(selected)$('#disk-directory').value=selected;}catch(e){notice(e.message,true);}});
$('#disk-map-start').addEventListener('click',()=>mapFolder($('#disk-directory').value.trim()||'C:\\'));
$('#disk-remap').addEventListener('click',()=>mapFolder($('#disk-directory').value.trim()||'C:\\'));
$('#disk-cancel').addEventListener('click',()=>api.invoke('diskCancel').catch(e=>notice(e.message,true)));
$('#disk-map-selected').addEventListener('click',()=>{if(diskState.selected)mapFolder(diskState.selected.path);});
$('#disk-reveal').addEventListener('click',()=>{if(diskState.selected)api.invoke('diskReveal',{id:diskState.selected.id}).catch(e=>notice(e.message,true));});
$('#disk-delete').addEventListener('click',()=>{if(diskState.selected)deleteDiskNode(diskState.selected);});
$('#disk-context-toggle').addEventListener('click',()=>task(async()=>{await api.invoke('contextSet',{enabled:!diskState.context});await loadContextStatus();}));
document.querySelector('[data-page="disk"]').addEventListener('click',()=>{loadContextStatus();if(!diskState.result&&!isBusy())$('#map-folder-dialog').showModal();else if(diskState.result)renderDisk();});
window.addEventListener('manager-ready',consumeMapRequest);
api.onEvent(e=>{if(e.type==='disk-progress'&&diskState.scanning){$('#operation-status').textContent=e.message;if(diskState.scanning&&e.preview&&!diskState.result){diskState.preview=e.preview;if(state.page==='disk')renderDisk();}else $('#disk-status').textContent=e.message;}if(e.type==='map-request')consumeMapRequest();});
let diskResizeTimer;new ResizeObserver(()=>{clearTimeout(diskResizeTimer);diskResizeTimer=setTimeout(()=>{if(state.page==='disk'&&diskState.result)renderDisk();},100);}).observe($('#disk-treemap'));
$('#disk-depth').addEventListener('change',renderDisk);
renderDisk();

loadContextStatus();
