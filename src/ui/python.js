const pythonState={snapshot:null,catalog:null};
const pythonMinor=version=>version.split('.').slice(0,2).join('.');
async function loadPython() {
  pythonState.snapshot=await api.invoke('pythonSnapshot');
  renderPython();renderPath();
}
async function loadPythonCatalog() {
  pythonState.catalog=await api.invoke('pythonCatalog');
  renderPython();
  $('#python-catalog-status').textContent=`${pythonState.catalog.offline?'Offline · cached releases':'python.org · releases checked'} ${date(pythonState.catalog.date)}`;
  if(pythonState.catalog.offline)notice('Using cached Python releases. '+pythonState.catalog.warning);
}
function pythonPaths(item) { return [item.directory,item.directory.replace(/[\\/]$/,'')+'\\Scripts']; }
function pythonAddPath(item) {
  if(item.inMachinePath||item.inUserPath)state.scope=item.inMachinePath?'Machine':'User';
  else {
    if(!state.snapshot.admin)state.scope='User';
    for(const entry of pythonPaths(item).reverse())if(!state.drafts[state.scope].some(p=>samePath(p,entry)))state.drafts[state.scope].unshift(entry);
  }
  switchPage('path');renderPath();
}
function renderPython() {
  const snapshot=pythonState.snapshot;if(!snapshot)return;
  const items=snapshot.installations;
  for(const item of items)if(pythonState.catalog)item.latest=pythonState.catalog.releases.find(r=>pythonMinor(r.version)===pythonMinor(item.version))?.version||null;
  $('#python-nav-count').textContent=items.length;
  $('#python-installed-count').textContent=String(items.length).padStart(2,'0');
  $('#python-active-version').textContent=items.find(i=>i.active)?.version||'No match';
  $('#python-update-count').textContent=pythonState.catalog?items.filter(i=>i.latest&&compare(i.latest,i.version)>0).length:'—';
  $('#python-list-count').textContent=items.length;
  const query=$('#python-search').value.toLowerCase(),filter=$('#python-filter').value;
  const filtered=items.filter(i=>`${i.version} ${i.directory} ${i.source}`.toLowerCase().includes(query)&&(filter==='all'||filter==='updates'&&i.latest&&compare(i.latest,i.version)>0||filter==='path'&&(i.inUserPath||i.inMachinePath)||filter==='managed'&&i.managed));
  const list=$('#python-list');list.replaceChildren();
  if(!filtered.length) {
    const empty=el('div','empty');empty.append(el('h2','',items.length?'No matching versions':'Add Python to your workspace.'),el('p','',items.length?'Try another search or filter.':'Install an official runtime with pip, or add a folder containing python.exe.'));list.append(empty);
  }
  for(const item of filtered) {
    const card=el('article',`version-card${item.active?' active':''}`),top=el('div','version-top'),identity=el('div','version-identity');
    identity.append(el('span','node-icon','Py'),el('span','version-number',item.version));
    if(item.active)identity.append(el('span','badge green','● Active in PATH'));
    else if(item.inUserPath||item.inMachinePath)identity.append(el('span','badge','In PATH'));
    const actions=el('div','version-actions');
    actions.append(button(item.inUserPath||item.inMachinePath?'Edit PATH':'Add to PATH',()=>pythonAddPath(item)));
    actions.append(button('Uninstall',()=>pythonMutate('pythonUninstall',{directory:item.directory},'Python uninstalled.'),'button danger',!item.managed||item.inUserPath||item.inMachinePath||item.running,!item.managed?'Remove this installation through Applications or its original installer.':'Remove Python and Scripts from both PATH scopes and stop running processes first.'));
    top.append(identity,actions);card.append(top,el('div','directory',item.directory));
    const meta=el('div','version-meta');
    for(const [label,value] of [['Installed',date(item.installed)+(item.installDateEstimated?' (estimated)':'')],['Last observed use',date(item.lastUsed)],['Source',item.source]]){const field=el('span','',label);field.append(el('b','',value));meta.append(field);}
    card.append(meta);
    if(item.latest&&compare(item.latest,item.version)>0)card.append(el('div','version-update',`${item.latest} available · Remove this minor version before installing its newer patch.`));
    list.append(card);
  }
  updateBusy();
}
async function pythonMutate(action,payload,message) {
  await task(async()=>{
    if(dirty('User')||dirty('Machine'))throw Error('Save or discard your PATH draft before changing Python installations.');
    const result=await api.invoke(action,payload);await loadSnapshot();notice(message+(result?.rebootRequired?' Restart Windows before continuing.':''));
  });
}
async function openPythonInstall() {
  await task(async()=>{if(!pythonState.catalog)await loadPythonCatalog();const select=$('#python-release');select.replaceChildren();for(const release of pythonState.catalog.releases){const option=el('option','',release.version);option.value=release.version;select.append(option);}$('#python-custom-version').value='';$('#python-install-dialog').showModal();});
}
$('#python-refresh').addEventListener('click',()=>task(loadPython));
$('#python-check-updates').addEventListener('click',()=>task(loadPythonCatalog));
$('#python-open-install').addEventListener('click',openPythonInstall);
$('#python-search').addEventListener('input',renderPython);
$('#python-filter').addEventListener('change',renderPython);
$('#python-add-folder').addEventListener('click',()=>task(async()=>{await api.invoke('pythonFolder');await loadPython();}));
$('#python-install-selected').addEventListener('click',()=>{
  const version=$('#python-custom-version').value.trim()||$('#python-release').value;
  if(!/^3\.\d+\.\d+$/.test(version)){notice('Enter a stable Python version such as 3.14.0.',true);return;}
  $('#python-install-dialog').close();pythonMutate('pythonInstall',{version},`Installed Python ${version} with pip. Add it to PATH when ready.`);
});
