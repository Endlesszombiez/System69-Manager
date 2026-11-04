const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {PythonManager}=require('../src/core/python-manager.cjs');
const win=require('../src/core/windows.cjs');
const crypto=require('node:crypto');
async function fixture(t) { const directory=await fs.mkdtemp(path.join(os.tmpdir(),'system69-python-')); t.after(()=>fs.rm(directory,{recursive:true,force:true})); return new PythonManager(directory); }
test('Python catalog offers full Windows installers and skips source-only releases',async t=>{
  const manager=await fixture(t);
  t.mock.method(global,'fetch',async(url,options)=>options?.method==='HEAD'?{ok:url.includes('3.13.8'),status:url.includes('3.13.8')?200:404}:{ok:true,text:async()=>'<a href="3.13.9/">3.13.9</a><a href="3.13.8/">3.13.8</a><a href="3.14.0rc1/">rc</a>'});
  assert.deepEqual((await manager.catalog()).releases,[{version:'3.13.8'}]);
});
test('Python release cache works offline independently of Node catalog',async t=>{
  const manager=await fixture(t);await fs.mkdir(manager.store,{recursive:true});
  await fs.writeFile(path.join(manager.store,'catalog.json'),JSON.stringify({releases:[{version:'3.14.0'}],date:'2026-01-01'}));
  t.mock.method(global,'fetch',async()=>{throw Error('offline');});
  const catalog=await manager.catalog();assert.equal(catalog.offline,true);assert.equal(catalog.date,'2026-01-01');
});
test('Python installer rejects conflicting minor versions before any download',async t=>{
  const manager=await fixture(t);t.mock.method(manager,'discover',async()=>({installations:[{version:'3.14.0'}]}));
  t.mock.method(global,'fetch',async()=>{assert.fail('must not download');});
  await assert.rejects(manager.install('3.14.1'),/already installed/);
});
test('Python discovery recognizes managed installs and Scripts PATH membership',async t=>{
  const manager=await fixture(t),directory=path.join(manager.root,'3.14.0-amd64');
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'python.exe'),'fixture');
  await fs.writeFile(path.join(directory,'.python-manager.json'),JSON.stringify({version:'3.14.0',installed:'2026-01-01'}));
  t.mock.method(win,'pythonFacts',async()=>({admin:false,userPath:path.join(directory,'Scripts'),machinePath:'',directories:[],apps:[],running:[path.join(directory,'pythonw.exe')]}));
  t.mock.method(win,'run',async executable=>{if(executable!==path.join(directory,'python.exe'))throw Error('Not a test runtime');return {code:0,output:'Python 3.14.0'};});
  const result=await manager.discover(),item=result.installations.find(i=>i.directory===directory);
  assert.equal(item.managed,true);assert.equal(item.source,'System69 Manager');assert.equal(item.inUserPath,true);assert.equal(item.active,false);assert.equal(item.running,true);assert.ok(item.lastUsed);
});
test('Python installer rejects a tampered download before executing it',async t=>{
  const manager=await fixture(t);t.mock.method(manager,'discover',async()=>({installations:[]}));
  t.mock.method(global,'fetch',async url=>url.endsWith('.sigstore')?{ok:true,json:async()=>({messageSignature:{messageDigest:{algorithm:'SHA2_256',digest:Buffer.alloc(32).toString('base64')}}})}:new Response('tampered installer'));
  t.mock.method(win,'ps',async()=>{assert.fail('must not execute');});
  await assert.rejects(manager.install('3.14.0'),/SHA-256 verification failed/);
  await assert.rejects(fs.access(path.join(manager.store,'installers','python-3.14.0-amd64.exe.download')));
});
test('Python removal blocks PATH, running processes and external ownership',async t=>{
  const manager=await fixture(t),directory='C:\\Python314';let item={directory,version:'3.14.0',managed:true,inUserPath:true};
  t.mock.method(manager,'discover',async()=>({installations:[item]}));
  await assert.rejects(manager.uninstall(directory),/both PATH scopes/);
  item={...item,inUserPath:false,running:true};await assert.rejects(manager.uninstall(directory),/running/);
  item={...item,running:false,managed:false,source:'pyenv'};await assert.rejects(manager.uninstall(directory),/original installer/);
});
test('verified Python installation includes pip, records provenance and keeps PATH unchanged',async t=>{
  const manager=await fixture(t),payload=Buffer.from('verified installer');let directory;
  const checksum=crypto.createHash('sha256').update(payload).digest('hex');
  t.mock.method(manager,'discover',async()=>({installations:[]}));
  t.mock.method(global,'fetch',async url=>url.endsWith('.sigstore')?{ok:true,json:async()=>({messageSignature:{messageDigest:{algorithm:'SHA2_256',digest:Buffer.from(checksum,'hex').toString('base64')}}})}:new Response(payload));
  let verified=false;
  t.mock.method(win,'ps',async script=>{assert.match(script,/Get-AuthenticodeSignature/);assert.match(script,/Python Software Foundation/);verified=true;return '';});
  t.mock.method(manager,'installer',async(executable,args)=>{
    assert.equal(verified,true);assert.match(args,/Include_pip=1/);assert.match(args,/PrependPath=0 AppendPath=0/);assert.match(args,/Include_launcher=0/);
    directory=/TargetDir="([^"]+)"/.exec(args)[1];await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'python.exe'),'fixture');return {rebootRequired:false};
  });
  t.mock.method(win,'run',async()=>({code:0,output:'Python 3.14.0'}));
  await manager.install('3.14.0');
  assert.equal(JSON.parse(await fs.readFile(path.join(directory,'.python-manager.json'),'utf8')).checksum,checksum);
});
test('Python installer timeout leaves process running and blocks further mutations',async t=>{
  const manager=await fixture(t);t.mock.method(win,'ps',async(script,options)=>{assert.equal(options.killOnTimeout,false);throw Error('Operation timed out.');});
  await assert.rejects(manager.installer('C:\\installer.exe','/passive'),/timed out/);assert.equal(manager.halted,true);
  await assert.rejects(manager.install('3.14.0'),/restart System69/);
});
