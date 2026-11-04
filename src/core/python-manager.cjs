const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { createWriteStream } = require('node:fs');
const { Manager } = require('./manager.cjs');
const { normalizePath, splitPath } = require('./model.cjs');
const win = require('./windows.cjs');
const VERSION = /^3\.(?:[9]|[1-9]\d)\.\d+$/;
const compare = (a,b) => a.localeCompare(b, undefined, {numeric:true});
const minor = v => v.split('.').slice(0,2).join('.');
const isManagedDirectory = (root,directory) => /^3\.\d+\.\d+-(amd64|arm64)$/.test(path.relative(root,directory));
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function read(file, fallback) { try { return JSON.parse(await fs.readFile(file,'utf8')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } }
async function write(file, value) { await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2)); await fs.rename(file+'.tmp',file); }
class PythonManager extends Manager {
  constructor(dataDir, emit) { super(dataDir,emit); this.root=path.join(dataDir,'python','versions'); this.store=path.join(dataDir,'python'); this.halted=false; }
  async catalog() {
    try {
      const response=await fetch('https://www.python.org/ftp/python/',{signal:AbortSignal.timeout(20000)});
      if(!response.ok) throw Error(`python.org returned ${response.status}`);
      const versions=[...new Set([... (await response.text()).matchAll(/href="(3\.\d+\.\d+)\/"/g)].map(m=>m[1]))].filter(v=>VERSION.test(v));
      if(!versions.length) throw Error('Invalid Python release catalog.');
      // Only versions with a full Windows installer are offered. Security-only releases have none.
      const groups=new Map();
      for(const version of versions.sort((a,b)=>compare(b,a))) { const key=minor(version); if(!groups.has(key))groups.set(key,[]); groups.get(key).push(version); }
      const arch=process.arch==='arm64'?'arm64':'amd64';
      const releases=(await Promise.all([...groups.values()].map(async candidates=>{
        for(const version of candidates) {
          const check=await fetch(`https://www.python.org/ftp/python/${version}/python-${version}-${arch}.exe`,{method:'HEAD',signal:AbortSignal.timeout(15000)});
          if(check.ok)return {version};
          if(check.status!==404)throw Error(`Python release check returned ${check.status}`);
        }
        return null;
      }))).filter(Boolean).sort((a,b)=>compare(b.version,a.version));
      if(!releases.length)throw Error('No full Windows installers found for this architecture.');
      const result={releases,date:new Date().toISOString()};
      await write(path.join(this.store,'catalog.json'),result); this.releases=releases;
      return {...result,offline:false};
    } catch(error) {
      const cached=await read(path.join(this.store,'catalog.json'),null);
      if(!cached)throw Error(`Cannot check Python releases: ${error.message}. Installed versions and PATH still work.`);
      this.releases=cached.releases; return {...cached,offline:true,warning:error.message};
    }
  }
  async discover() {
    const facts=await win.pythonFacts();
    const state=await read(path.join(this.store,'state.json'),{folders:[],observed:{}});
    const directories=new Map();
    const add=(directory,source='Detected')=>{
      if(!directory)return;
      const expanded=win.expandEnv(directory.replace(/^"|"$/g,''));
      if(!path.win32.isAbsolute(expanded))return;
      const actual=/[\\/]Scripts[\\/]?$/i.test(expanded)?path.dirname(expanded):expanded;
      const key=normalizePath(actual); if(!directories.has(key))directories.set(key,{directory:actual,source});
    };
    const scan=async(parent,source)=>{try{for(const item of await fs.readdir(parent,{withFileTypes:true}))if(item.isDirectory())add(path.join(parent,item.name),source);}catch(e){if(!['ENOENT','EACCES','EPERM'].includes(e.code))throw e;}};
    await scan(this.root,'System69 Manager');
    for(const folder of state.folders)add(folder,'Added folder');
    for(const folder of [...splitPath(facts.machinePath||''),...splitPath(facts.userPath||''),...splitPath(process.env.PATH||'')])add(folder);
    for(const folder of facts.directories||[])add(folder);
    for(const app of facts.apps||[])add(app.InstallLocation);
    await scan(path.join(process.env.LOCALAPPDATA||'','Programs','Python'),'Python installer');
    await scan((process.env.SystemDrive||'C:')+'\\','Python installer');
    await scan(path.join(process.env.USERPROFILE||'','.pyenv','pyenv-win','versions'),'pyenv');
    const machine=win.resolveEntries(facts.machinePath),user=win.resolveEntries(facts.userPath),effective=[...machine,...user];
    const installations=[];
    for(const item of directories.values()) {
      const executable=path.join(item.directory,'python.exe'); if(!await exists(executable))continue;
      // WindowsApps aliases can open the Store instead of reporting a version.
      if(normalizePath(item.directory).includes('\\microsoft\\windowsapps'))continue;
      try {
        const result=await win.run(executable,['-I','--version'],{timeout:5000});
        const version=/^Python (3\.\d+\.\d+)$/.exec(result.output)?.[1]; if(result.code!==0||!version)continue;
        const manifest=await read(path.join(item.directory,'.python-manager.json'),null);
        const managed=isManagedDirectory(this.root,item.directory)&&manifest?.version===version;
        const paths=[item.directory,path.join(item.directory,'Scripts')].map(normalizePath);
        const key=normalizePath(item.directory),position=effective.indexOf(key);
        const running=(facts.running||[]).some(p=>paths[0]===normalizePath(path.dirname(p)));
        if(running)state.observed[key]=new Date().toISOString();
        const stat=await fs.stat(executable);
        installations.push({...item,version,managed,source:managed?'System69 Manager':item.source,
          installed:manifest?.installed||stat.birthtime.toISOString(),installDateEstimated:!managed,lastUsed:state.observed[key]||null,running,
          inMachinePath:paths.some(p=>machine.includes(p)),inUserPath:paths.some(p=>user.includes(p)),pathPosition:position<0?null:position,
          latest:this.releases.find(r=>minor(r.version)===minor(version))?.version||null});
      }catch(error){await this.log(`Skipped Python ${executable}: ${error.message}`);}
    }
    installations.sort((a,b)=>compare(b.version,a.version)||a.directory.localeCompare(b.directory));
    const first=installations.filter(i=>i.pathPosition!==null).sort((a,b)=>a.pathPosition-b.pathPosition)[0];
    for(const item of installations)item.active=item===first;
    await write(path.join(this.store,'state.json'),state);
    return {installations,admin:facts.admin,architecture:process.arch};
  }
  async addFolder(directory) {
    if(!await exists(path.join(directory,'python.exe')))throw Error('This folder does not contain python.exe.');
    const state=await read(path.join(this.store,'state.json'),{folders:[],observed:{}});
    if(!state.folders.some(p=>normalizePath(p)===normalizePath(directory)))state.folders.push(directory);
    await write(path.join(this.store,'state.json'),state);
  }
  async installer(executable,args) {
    if(this.halted)throw Error('Resolve the previous Python installer and restart System69 before continuing.');
    try {
      const result=await win.ps(`$p=Start-Process -FilePath ${win.psQuote(executable)} -ArgumentList ${win.psQuote(args)} -PassThru -Wait; $p.ExitCode`,{timeout:1800000,killOnTimeout:false});
      if(!/^\d+$/.test(result.trim()))throw Error('Python installer did not report an exit code. Refresh before retrying.');
      const code=Number(result.trim());
      if(![0,1641,3010].includes(code))throw Error(`Python installer exited with ${result}.`);
      if(code!==0)this.halted=true;
      return {rebootRequired:code!==0};
    }catch(error){if(/timed out/.test(error.message))this.halted=true;throw error;}
  }
  async install(version) {
    if(!VERSION.test(version||''))throw Error('Enter a stable Python version, 3.9 or newer.');
    if(!['x64','arm64'].includes(process.arch))throw Error('Python installation requires x64 or ARM64 Windows.');
    if(this.halted)throw Error('Resolve the previous Python installer and restart System69.');
    const snapshot=await this.discover();
    if(snapshot.installations.some(i=>minor(i.version)===minor(version)))throw Error(`Python ${minor(version)} is already installed. Remove it before installing another patch of the same minor version.`);
    const arch=process.arch==='arm64'?'arm64':'amd64',name=`python-${version}-${arch}.exe`;
    const directory=path.join(this.root,`${version}-${arch}`),executable=path.join(this.store,'installers',name);
    if(await exists(directory))throw Error('The target folder already exists. Review it before installing.');
    const base=`https://www.python.org/ftp/python/${version}/${name}`;
    const metadata=await fetch(base+'.sigstore',{signal:AbortSignal.timeout(30000)});
    if(!metadata.ok)throw Error('Official SHA-256 metadata is unavailable for this version.');
    const digest=(await metadata.json()).messageSignature?.messageDigest;
    if(digest?.algorithm!=='SHA2_256'||!digest.digest)throw Error('Official SHA-256 metadata is invalid.');
    const checksum=Buffer.from(digest.digest,'base64').toString('hex');
    if(!/^[a-f0-9]{64}$/.test(checksum))throw Error('Official SHA-256 digest is invalid.');
    await fs.mkdir(path.dirname(executable),{recursive:true});
    const temporary=executable+'.download';
    try {
      const response=await fetch(base,{signal:AbortSignal.timeout(600000)});
      if(!response.ok||!response.body)throw Error(`Download failed (${response.status}).`);
      const hash=crypto.createHash('sha256');let bytes=0;
      const meter=new Transform({transform:(chunk,encoding,callback)=>{bytes+=chunk.length;if(bytes>128*1048576)return callback(Error('Python download exceeded the size limit.'));hash.update(chunk);callback(null,chunk);}});
      this.emit({type:'progress',message:`Downloading Python ${version}…`});
      await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(temporary));
      if(hash.digest('hex')!==checksum)throw Error('SHA-256 verification failed. Nothing was installed.');
      await fs.rename(temporary,executable);
      // Check Windows Authenticode as well as the digest retrieved over HTTPS.
      await win.ps(`$s=Get-AuthenticodeSignature -LiteralPath ${win.psQuote(executable)}; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Python Software Foundation'){throw 'Python installer signature verification failed.'}`);
      const result=await this.installer(executable,`/passive InstallAllUsers=0 TargetDir="${directory}" PrependPath=0 AppendPath=0 Include_launcher=0 Include_pip=1 Include_test=0 Shortcuts=0 AssociateFiles=0`);
      if(!await exists(path.join(directory,'python.exe')))throw Error('Python installer finished without creating python.exe.');
      const check=await win.run(path.join(directory,'python.exe'),['-I','--version']);
      if(check.code!==0||check.output!==`Python ${version}`)throw Error('Installed Python reported an unexpected version.');
      await write(path.join(directory,'.python-manager.json'),{version,installed:new Date().toISOString(),checksum});
      await this.log(`Installed Python ${version} in ${directory}; SHA-256 ${checksum}`);return result;
    }finally{await fs.rm(temporary,{force:true});}
  }
  async uninstall(directory) {
    const snapshot=await this.discover(),item=snapshot.installations.find(i=>normalizePath(i.directory)===normalizePath(directory));
    if(!item)throw Error('Installation no longer exists. Refresh the list.');
    if(item.inMachinePath||item.inUserPath)throw Error('Remove the Python and Scripts folders from both PATH scopes before uninstalling.');
    if(item.running)throw Error('This Python version is running. Stop its processes and refresh first.');
    if(!item.managed)throw Error(`Use Applications or the original installer to remove this ${item.source} installation.`);
    const realRoot=await fs.realpath(this.root),realDirectory=await fs.realpath(directory);
    if(!isManagedDirectory(realRoot,realDirectory)||(await fs.lstat(directory)).isSymbolicLink())throw Error('Refusing to uninstall a linked installation.');
    const arch=process.arch==='arm64'?'arm64':'amd64';
    const executable=path.join(this.store,'installers',`python-${item.version}-${arch}.exe`);
    const manifest=await read(path.join(directory,'.python-manager.json'),null);
    const checksum=crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex');
    if(checksum!==manifest?.checksum)throw Error('Cached Python installer checksum does not match. Use Windows Settings to uninstall.');
    const result=await this.installer(executable,'/uninstall /passive');
    if(await exists(path.join(directory,'python.exe')))throw Error('Python remains installed. Finish the installer prompts and refresh.');
    return result;
  }
}
module.exports={PythonManager};
