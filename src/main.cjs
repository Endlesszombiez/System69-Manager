const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Manager } = require('./core/manager.cjs');
const win = require('./core/windows.cjs');
const { Bridge } = require('./core/bridge.cjs');
const { ApplicationManager } = require('./core/application-manager.cjs');
const { DiskManager, mapArgument } = require('./core/disk-manager.cjs');
const explorer = require('./core/explorer-integration.cjs');
let window, manager, bridge, applications, disk;
let pendingMap=mapArgument(process.argv);
let demoApps = [
 {key:'Winget:7zip.7zip',id:'7zip.7zip',name:'7-Zip',version:'24.09',publisher:'Igor Pavlov',source:'Winget',sourceLabel:'WinGet',sizeLabel:'6 MB',supportsQuiet:true,protected:false,hidden:false},
 {key:'Winget:VideoLAN.VLC',id:'VideoLAN.VLC',name:'VLC media player',version:'3.0.21',publisher:'VideoLAN',source:'Winget',sourceLabel:'WinGet',sizeLabel:'196 MB',supportsQuiet:true,protected:false,hidden:false},
 {key:'Windows:Code',id:'Code',name:'Visual Studio Code',version:'1.95.3',publisher:'Microsoft',source:'Windows',sourceLabel:'Windows',sizeLabel:'412 MB',supportsQuiet:false,protected:false,hidden:false},
 {key:'Chocolatey:git',id:'git',name:'Git',version:'2.47.0',publisher:'Git for Windows',source:'Chocolatey',sourceLabel:'Chocolatey',sizeLabel:'344 MB',supportsQuiet:true,protected:false,hidden:false}
];
const demo = process.argv.includes('--demo');
if (process.argv.includes('--smoke-test') && process.env.NODE_MANAGER_TEST_DATA) app.setPath('userData', process.env.NODE_MANAGER_TEST_DATA);
const uiFile = path.join(__dirname, 'ui', 'index.html');
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
app.on('second-instance', (_event,argv) => { const requested=mapArgument(argv);if(requested){pendingMap=requested;window?.webContents.send('manager:event',{type:'map-request'});} if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
async function confirm(title, message, detail) {
  const result = await dialog.showMessageBox(window, { type: 'warning', title, message, detail, buttons: ['Cancel', title], defaultId: 0, cancelId: 0, noLink: true });
  if (result.response !== 1) throw new Error('Cancelled.');
}
function demoSnapshot() {
  return {
    installations: [
      { version:'v24.11.0', directory:'C:\\Users\\you\\AppData\\Roaming\\System69 Manager\\versions\\v24.11.0-win-x64', source:'System69 Manager', managed:true, installed:'2026-10-12', lastUsed:'2026-10-29T12:20:00Z', pathPosition:3, active:true, inUserPath:true, latest:'v24.12.0' },
      { version:'v22.20.0', directory:'C:\\Program Files\\nodejs', source:'Chocolatey', managed:false, installed:'2026-09-18', lastUsed:null, pathPosition:null, latest:'v22.20.0', choco:'nodejs-lts' },
      { version:'v20.19.5', directory:'C:\\Users\\you\\AppData\\Roaming\\nvm\\v20.19.5', source:'nvm', managed:false, installed:'2026-06-04', installDateEstimated:true, lastUsed:null, pathPosition:null, latest:'v20.20.0' }
    ], userPath:'%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Users\\you\\AppData\\Roaming\\System69 Manager\\versions\\v24.11.0-win-x64', machinePath:'C:\\Windows\\system32;C:\\Windows', admin:false, packages:[{name:'nodejs-lts',version:'22.20.0'}], chocoInstalled:true, root:'C:\\Users\\you\\AppData\\Roaming\\System69 Manager\\versions', dataDir:'Demo data', architecture:'x64', demo:true
  };
}
async function invoke(action, payload = {}) {
  if(action==='pendingMap'){const value=pendingMap;pendingMap=null;return value;}
  if(action==='diskCancel'){disk.cancel();return true;}
  if(action==='diskChoose'){
    const selected=await dialog.showOpenDialog(window,{title:'Choose a folder to map',defaultPath:mapArgument(['--map',payload.directory])||'C:\\',properties:['openDirectory']});
    return selected.canceled?null:selected.filePaths[0];
  }
  if(action==='diskMap')return manager.exclusive('Mapping disk space',()=>disk.scan(payload.directory||'C:\\'));
  if(action==='diskMenu'){
    const node=disk.node(payload.id);let decision={allowed:false,reason:manager.busy?'An operation is running.':demo?'Preview mode: deletion disabled.':'The mapped root is protected.'};
    if(!manager.busy&&!demo&&node!==disk.result?.root){try{decision=await bridge.call('diskPolicy',{path:node.path});}catch{decision={allowed:false,reason:'Protection checks unavailable.'};}}
    return new Promise(resolve=>{
      const items=[{label:'Map this folder',enabled:node.kind==='directory'&&!manager.busy,click:()=>resolve({action:'map'})},{label:'Reveal in File Explorer',click:()=>resolve({action:'reveal'})},{type:'separator'}];
      if(decision.allowed)items.push({label:'Delete… (Recycle Bin)',enabled:!manager.busy,click:()=>resolve({action:'delete'})});
      else items.push({label:'Protected — deletion unavailable',enabled:false});
      Menu.buildFromTemplate(items).popup({window,callback:()=>resolve(null)});
    });
  }
  if(action==='diskPolicy'){
    const node=disk.node(payload.id);
    if(demo)return {allowed:false,reason:'Deletion is disabled in preview mode.'};
    if(node===disk.result?.root)return {allowed:false,reason:'The mapped root is protected from deletion.'};
    return bridge.call('diskPolicy',{path:node.path});
  }
  if(action==='diskReveal'){shell.showItemInFolder(disk.node(payload.id).path);return true;}
  const contextCommand=explorer.explorerCommand(process.execPath,app.isPackaged?null:app.getAppPath());
  if(action==='contextStatus')return {...await explorer.contextStatus(contextCommand),available:app.isPackaged&&!demo};

  if (action === 'applications') return demo ? {apps:demoApps,notices:[]} : manager.exclusive('Scanning applications',()=>applications.scan(!!payload.brew));
  if (action === 'queue') return applications.queue;
  if (action === 'stopQueue') { applications.stopRequested=true; return true; }
  if (demo && action === 'discardQueue') { applications.queue=[];return true; }
  if (demo && action === 'hideApps') { for(const a of demoApps) if(payload.keys.includes(a.key)) a.hidden=!!payload.hide;return demoApps; }
  if (demo && action === 'prepareQueue') {
    applications.queue=demoApps.filter(a=>payload.keys.includes(a.key)&&!a.hidden).map(a=>({...a,eligible:!a.protected&&(!payload.silent||a.supportsQuiet),status:!a.protected&&(!payload.silent||a.supportsQuiet)?'Ready':'Blocked',reason:'No documented silent command.',mode:a.supportsQuiet?'Silent requested':'May show a window',cleanup:'Off — preview mode',command:'Preview only'}));
    return applications.queue;
  }
  if (action === 'snapshot') return demo ? demoSnapshot() : manager.exclusive('Scanning installations', () => manager.discover());
  if (action === 'catalog') {
    if (demo) return { date:new Date().toISOString(), releases:[{version:'v26.1.0', date:'2026-10-27', lts:false, files:['win-x64-zip']},{version:'v24.12.0',date:'2026-10-20',lts:'Krypton',files:['win-x64-zip']},{version:'v22.20.0',date:'2026-10-15',lts:'Jod',files:['win-x64-zip']},{version:'v20.20.0',date:'2026-10-10',lts:'Iron',files:['win-x64-zip']}] };
    return manager.exclusive('Checking nodejs.org releases', () => manager.catalog());
  }
  if (action === 'logs') {
    if (demo) return 'Preview mode — sample data. System changes are disabled.';
    try { return (await fs.readFile(path.join(manager.dataDir, 'activity.log'), 'utf8')).slice(-80000); } catch (e) { if (e.code === 'ENOENT') return 'No activity yet.'; throw e; }
  }
  if (demo) throw new Error('Preview mode uses sample data. Restart without --demo to manage this computer.');
  if (applications.halted && !['openData'].includes(action)) throw new Error('Resolve the previous uninstall or restart Windows before making further changes.');
  if(action==='contextSet'){
    if(!app.isPackaged)throw Error('Explorer integration is available in the installed build.');
    return manager.exclusive('Updating Explorer menu',()=>explorer.setContextMenu(!!payload.enabled,contextCommand,process.execPath));
  }
  if(action==='diskDelete')return manager.exclusive('Reviewing disk-map deletion',async()=>{
    const node=disk.deleteNode(payload.id);
    const review=await bridge.call('diskReview',{path:node.path});
    await confirm('Move to Recycle Bin',`Delete ${node.name}?`,review.path+'\n\n'+review.entries.toLocaleString()+' entries · '+(review.bytes/1048576).toFixed(1)+' MB\n\nMoves this reviewed item to the Recycle Bin. Protected content is never eligible.');
    await manager.log('Disk map deletion approved: '+review.path);
    const moved=await bridge.call('diskQuarantine',{token:review.token});
    try{await manager.log('Preparing Recycle Bin move: '+moved.path+' (original '+moved.original+')');await shell.trashItem(moved.path);}
    catch(error){
      try{await bridge.call('diskRestore',{token:review.token});await manager.log('Recycle Bin failed; restored '+moved.original);}
      catch(restoreError){throw Error('Recycle Bin move failed. Remaining content: '+moved.path+'. '+restoreError.message);}
      throw Error('Recycle Bin move failed; the item was restored. '+error.message);
    }
    await bridge.call('diskForget',{token:review.token});disk.nodes.clear();disk.result=null;
    await manager.log('Moved to Recycle Bin: '+moved.original);return true;
  });
  if (action === 'discardQueue') return manager.exclusive('Clearing uninstall queue',()=>applications.discard());
  if (action === 'hideApps') return manager.exclusive('Saving hidden applications',()=>applications.hide(payload.keys,!!payload.hide));
  if (action === 'prepareQueue') return manager.exclusive('Preparing uninstall review',()=>applications.prepare(payload.keys,!!payload.silent,!!payload.advanced));
  if (action === 'runQueue') {
    const reviewed=JSON.stringify(applications.queue);
    const ready=applications.queue.filter(x=>x.status==='Ready');
    if(!ready.length) throw new Error('No eligible queue entries.');
    await confirm('Uninstall applications', `Uninstall ${ready.length} reviewed application(s)?`, ready.map(x=>`${x.name} (${x.sourceLabel}) — ${x.mode}\nCleanup: ${x.cleanup}`).join('\n\n')+'\n\nOnly documented silent behavior can be requested. A vendor uninstaller may still display a window.');
    if(reviewed!==JSON.stringify(applications.queue)) throw new Error('Queue changed. Review again.');
    return manager.exclusive('Running uninstall queue',()=>applications.run());
  }
  if (action === 'folder') {
    const selected = await dialog.showOpenDialog(window, { title:'Choose a folder containing node.exe', properties:['openDirectory'] });
    if (!selected.canceled) await manager.exclusive('Adding installation folder', () => manager.addFolder(selected.filePaths[0]));
    return !selected.canceled;
  }
  if (action === 'openData') return shell.openPath(manager.dataDir);
  if (action === 'admin') {
    if (manager.busy) throw new Error('Wait for the current operation to finish.');
    await confirm('Restart as administrator', 'Restart System69 Manager with administrator access?', 'Windows will show a User Account Control prompt. Your current PATH draft and pending uninstall queue will be discarded.');
    const args = app.isPackaged ? '' : ` -ArgumentList ${win.psQuote('"' + app.getAppPath() + '"')}`;
    app.releaseSingleInstanceLock();
    try { await win.ps(`Start-Process -FilePath ${win.psQuote(process.execPath)}${args} -Verb RunAs -WindowStyle Hidden`); }
    catch (error) { app.requestSingleInstanceLock(); throw error; }
    window.destroy(); app.quit(); return;
  }
  if (action === 'install') {
    await confirm('Install version', `Install Node.js ${payload.version}?`, 'Downloads an official ZIP from nodejs.org, verifies its SHA-256 checksum, and installs it side by side. PATH is unchanged until you save it in the PATH editor.');
    return manager.exclusive(`Installing ${payload.version}`, () => manager.install(payload.version));
  }
  if (action === 'uninstall') {
    await confirm('Uninstall version', 'Remove this Node.js installation?', payload.directory + '\n\nRemove its PATH entries first. Managed files will be deleted; Chocolatey or Windows Installer installations use their own uninstallers.');
    return manager.exclusive('Uninstalling Node.js', () => manager.uninstall(payload.directory));
  }
  if (action === 'savePath') {
    await confirm('Save PATH', `Save ${payload.scope} PATH?`, 'New terminals will use the new PATH order. Existing terminals keep their current environment. A backup is saved before changing PATH.\n\n' + (Array.isArray(payload.entries) ? payload.entries.join('\n') : ''));
    return manager.exclusive('Saving PATH', () => win.savePath(payload.scope, payload.entries, payload.expected, manager.dataDir));
  }
  if (action === 'restorePath') {
    await confirm('Restore PATH', 'Undo the most recent PATH save?', 'Restores the previous PATH only if it has not changed since that save.');
    return manager.exclusive('Restoring PATH', () => manager.restorePath());
  }
  if (action === 'choco') {
    await confirm('Run Chocolatey', `${payload.action} ${payload.name}${payload.version ? ' ' + payload.version : ''}?`, 'Chocolatey runs package scripts as administrator and may replace the shared Node.js installation. Its packages do not provide side-by-side versions. Package dependencies may also change.');
    return manager.exclusive(`Chocolatey ${payload.action} ${payload.name}`, () => manager.chocolatey(payload.action, payload.name, payload.version));
  }
  if (action === 'setupChoco') {
    await confirm('Set up Chocolatey', 'Install Chocolatey on this computer?', 'Downloads and runs the official setup script from https://community.chocolatey.org/install.ps1 as administrator. Chocolatey is a separate package manager with its own terms.');
    return manager.exclusive('Setting up Chocolatey', () => manager.setupChocolatey());
  }
  throw new Error('Unknown action.');
}
app.whenReady().then(() => {
  app.setAppUserModelId('dev.system69.manager');
  manager = new Manager(app.getPath('userData'), event => { if (window && !window.isDestroyed()) window.webContents.send('manager:event', event); });
  const emit = event => { if(window&&!window.isDestroyed())window.webContents.send('manager:event',event); };
  bridge = new Bridge(path.join(app.isPackaged?process.resourcesPath:app.getAppPath(),app.isPackaged?'bridge':'native-publish','System69.Bridge.exe'),manager.dataDir,app.isPackaged?path.dirname(process.execPath):app.getAppPath(),emit);
  applications = new ApplicationManager(manager,bridge,emit);
  disk=new DiskManager(emit);
  ipcMain.handle('manager:invoke', async (event, action, payload) => {
    if (event.sender !== window.webContents || event.senderFrame.url !== pathToFileURL(uiFile).href) throw new Error('Untrusted request.');
    try { return { ok:true, value:await invoke(action, payload) }; }
    catch (error) { return { ok:false, error:error.message }; }
  });
  window = new BrowserWindow({ width:1260, height:850, minWidth:1000, minHeight:700, backgroundColor:'#F3F6FA', icon:path.join(__dirname,'..','assets','icon.png'), title:'System69 Manager', autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true, spellcheck:false } });
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(window, { type:'question', message:'Discard unsaved PATH changes and close?', buttons:['Keep editing','Discard and close'], defaultId:0, cancelId:0 });
    if (response === 1) event.preventDefault();
  });
  window.on('close', event => { if (manager.busy) { event.preventDefault(); dialog.showMessageBox(window, {type:'info',message:'An operation is still running. Please wait before closing System69 Manager.'}); } });
  window.loadFile(uiFile);
});
app.on('before-quit',()=>{ if(!manager?.busy)bridge?.close(); });
app.on('window-all-closed', () => app.quit());
