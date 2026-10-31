const appState={apps:[],selected:new Set(),review:[],queue:[],running:false,halted:false,loaded:false};
async function loadApplications(){
  const result=await api.invoke('applications',{brew:$('#include-brew').checked});
  appState.apps=result.apps;appState.selected.clear();appState.review=[];appState.queue=[];appState.loaded=true;
  $('#app-notices').textContent=result.notices.join(' · ');renderApplications();renderQueue();
}
function visibleApps(){const q=$('#app-search').value.toLowerCase(),source=$('#app-source').value;return appState.apps.filter(a=>(!a.hidden||$('#show-hidden').checked)&&(!source||a.source===source)&&(`${a.name} ${a.publisher} ${a.id}`.toLowerCase().includes(q)));}
function renderApplications(){
  const rows=$('#app-rows');rows.replaceChildren();const apps=visibleApps();
  $('#apps-count').textContent=apps.length;$('#apps-nav-count').textContent=appState.apps.filter(a=>!a.hidden).length;
  $('#app-select-all').checked=apps.length>0&&apps.filter(a=>!a.protected).every(a=>appState.selected.has(a.key));
  for(const a of apps){
    const row=el('tr',appState.selected.has(a.key)?'app-selected':'');
    const cell=el('td'),label=el('label','app-identity'),check=el('input');check.type='checkbox';check.checked=appState.selected.has(a.key);check.dataset.locked=String(a.protected);check.disabled=a.protected||isBusy();check.setAttribute('aria-label','Select '+a.name);
    check.addEventListener('change',()=>{check.checked?appState.selected.add(a.key):appState.selected.delete(a.key);renderApplications();});
    const identity=el('span');identity.append(el('strong','',a.name),el('small','',a.publisher));label.append(check,identity);cell.append(label);row.append(cell,el('td','mono',a.version||'—'),el('td','',a.sourceLabel),el('td','',a.sizeLabel),el('td','',a.protected?'Protected':a.hidden?'Hidden':a.supportsQuiet?'Silent available':'May be interactive'));rows.append(row);
  }
  if(!apps.length){const row=el('tr'),cell=el('td','empty-cell',appState.loaded?'No applications match. Change your search or show hidden applications.':'Reading your installed applications…');cell.colSpan=5;row.append(cell);rows.append(row);}
  const count=appState.selected.size;$('#app-selection').textContent=count+' application'+(count===1?'':'s')+' selected';
  lockButton($('#review-apps'),count===0||appState.halted);lockButton($('#hide-apps'),!appState.apps.some(a=>appState.selected.has(a.key)&&!a.hidden));lockButton($('#unhide-apps'),!appState.apps.some(a=>appState.selected.has(a.key)&&a.hidden));
}
async function setHidden(hide){await task(async()=>{const keys=[...appState.selected];appState.apps=await api.invoke('hideApps',{keys,hide});appState.selected.clear();appState.review=[];appState.queue=[];renderApplications();renderQueue();notice(hide?'Applications hidden. Enable “Show hidden apps” to restore them.':'Applications unhidden.');});}
async function prepareApplications(){await task(async()=>{appState.review=await api.invoke('prepareQueue',{keys:[...appState.selected],silent:$('#silent-only').checked,advanced:$('#advanced-cleanup').checked});appState.queue=appState.review.map(a=>({...a,status:a.eligible?'Ready':'Blocked',detail:a.reason||a.mode}));renderQueue();switchPage('queue');$('#queue-reviewed').checked=false;});}
function renderQueue(){
  $('#queue-nav-count').textContent=appState.queue.filter(a=>a.status==='Ready'||a.status==='Running').length;
  const list=$('#queue-list');list.replaceChildren();
  for(const a of appState.queue){const card=el('article','queue-item');const top=el('div','queue-top');top.append(el('h2','',a.name),el('span',a.status==='Failed'||a.status==='Blocked'?'badge amber':'badge',a.status));card.append(top,el('p','',a.sourceLabel+' · '+(a.mode||a.reason||'')));
    if(a.eligible){card.append(el('p','queue-path','Cleanup: '+a.cleanup));const details=el('details');details.append(el('summary','','Uninstall command'),el('code','',a.command));card.append(details);}
    if(a.detail&&a.detail!==a.mode)card.append(el('p','queue-detail',a.detail));list.append(card);
  }
  if(!appState.queue.length)list.append(el('div','empty','Your queue is clear. Select applications and choose Review queue.'));
  lockButton($('#start-queue'),appState.running||appState.halted||!$('#queue-reviewed').checked||!appState.queue.some(a=>a.status==='Ready'));
  lockButton($('#clear-queue'),appState.running);$('#stop-queue').classList.toggle('hidden',!appState.running);
  $('#queue-warning').textContent=appState.halted?'Queue stopped. Resolve the running uninstaller or restart Windows, then restart System69.':'Select one source per app. A package-manager entry may describe the same app as a Windows entry.';
}
$('#app-search').addEventListener('input',renderApplications);$('#app-source').addEventListener('change',()=>{appState.selected.clear();renderApplications();});
$('#show-hidden').addEventListener('change',()=>{if(!$('#show-hidden').checked)for(const a of appState.apps.filter(a=>a.hidden))appState.selected.delete(a.key);renderApplications();});
$('#app-select-all').addEventListener('change',event=>{for(const a of visibleApps().filter(a=>!a.protected))event.target.checked?appState.selected.add(a.key):appState.selected.delete(a.key);renderApplications();});
$('#refresh-apps').addEventListener('click',()=>task(loadApplications));$('#hide-apps').addEventListener('click',()=>setHidden(true));$('#unhide-apps').addEventListener('click',()=>setHidden(false));$('#review-apps').addEventListener('click',prepareApplications);
$('#queue-reviewed').addEventListener('change',renderQueue);
$('#start-queue').addEventListener('click',()=>task(async()=>{appState.running=true;renderQueue();try{appState.queue=await api.invoke('runQueue');appState.selected.clear();notice('Queue finished. Review the results, then refresh your inventory.');}finally{appState.running=false;renderQueue();}}));
$('#stop-queue').addEventListener('click',async()=>{try{await api.invoke('stopQueue');notice('Stopping after the current uninstaller finishes.');}catch(error){notice(error.message,true);}});
$('#clear-queue').addEventListener('click',()=>task(async()=>{await api.invoke('discardQueue');appState.queue=[];appState.review=[];$('#queue-reviewed').checked=false;renderQueue();}));
api.onEvent(event=>{if(event.type==='queue'){appState.queue=event.queue;appState.running=event.running;appState.halted=event.halted;renderQueue();}if(event.type==='idle')renderApplications();});
switchPage('applications');renderApplications();renderQueue();
