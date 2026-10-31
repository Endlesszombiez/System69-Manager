const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {scan}=require('../src/core/disk-scan-worker.cjs');
const {DiskManager,mapArgument}=require('../src/core/disk-manager.cjs');
const {explorerCommand,contextStatus,setContextMenu}=require('../src/core/explorer-integration.cjs');
const win=require('../src/core/windows.cjs');
const {layout}=require('../src/ui/treemap.js');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'system69-map-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('scanner aggregates nested file sizes and empty folders exactly',async t=>{
 const root=await fixture(t);await fs.mkdir(path.join(root,'nested'));await fs.mkdir(path.join(root,'empty'));await fs.writeFile(path.join(root,'a.bin'),Buffer.alloc(10));await fs.writeFile(path.join(root,'nested','b.bin'),Buffer.alloc(30));
 const r=await scan(root);assert.equal(r.root.size,40);assert.equal(r.entries,4);assert.equal(r.root.children.find(n=>n.name==='nested').size,30);assert.equal(r.limited,false);
});
test('scanner never follows a junction or counts its external target',async t=>{
 const root=await fixture(t),outside=await fixture(t);await fs.writeFile(path.join(outside,'sentinel.bin'),Buffer.alloc(100));await fs.symlink(outside,path.join(root,'junction'),'junction');
 const r=await scan(root);assert.equal(r.root.size,0);assert.equal(r.links,1);assert.equal(r.root.children.length,0);assert.equal((await fs.stat(path.join(outside,'sentinel.bin'))).size,100);
});
test('scanner budgets return an explicit partial map with consistent ancestor totals',async t=>{
 const root=await fixture(t);await fs.mkdir(path.join(root,'nested'));for(let i=0;i<8;i++)await fs.writeFile(path.join(root,'nested',i+'.bin'),Buffer.alloc(10));
 const r=await scan(root,{maxEntries:4});assert.equal(r.limited,true);assert.equal(r.entries,4);assert.equal(r.root.size,r.root.children.reduce((s,n)=>s+n.size,0));
});
test('an 80,500-file first folder cannot stop later root folders or lose summarized bytes',async t=>{
 const root='C:\\virtual-drive';
 const branches=[{name:'$Recycle.Bin',files:80500,bytes:1},{name:'Program Files',files:2,bytes:400},{name:'Users',files:3,bytes:100}];
 const directoryMap=new Map(branches.map(b=>[path.join(root,b.name),b]));
 t.mock.method(fs,'lstat',async full=>{const directory=full===root||directoryMap.has(full);const branch=directoryMap.get(path.dirname(full));return {isSymbolicLink:()=>false,isDirectory:()=>directory,isFile:()=>!directory,size:directory?0:branch.bytes};});
 t.mock.method(fs,'opendir',async full=>{let index=0;return {read:async()=>{const branch=directoryMap.get(full),count=full===root?branches.length:branch.files;if(index>=count)return null;const name=full===root?branches[index++].name:(index++)+'.bin';return {name,isSymbolicLink:()=>false};},close:async()=>{}};});
 const previews=[];const r=await scan(root,{maxNodes:40},p=>previews.push(p.preview));
 assert.equal(r.entries,80508);assert.equal(r.files,80505);assert.equal(r.limited,false);assert.equal(r.root.size,81600);
 assert.deepEqual(r.root.children.filter(n=>n.kind==='directory').map(n=>n.name),branches.map(b=>b.name));
 for(const b of branches)assert.equal(r.root.children.find(n=>n.name===b.name).size,b.files*b.bytes);
 assert.ok(r.nodes<=40,'display retention is bounded without truncating the scan');assert.ok(r.summarized>0);
 const stack=[r.root];while(stack.length){const n=stack.pop();if(n.children){assert.equal(n.size,n.children.reduce((sum,c)=>sum+c.size,0),'summaries conserve size at '+n.name);stack.push(...n.children);}}
 assert.equal(previews[0].root.children.length,3,'all root branches are discovered before descending');
});
test('worker mapper indexes only current scan nodes and protects the mapped root',async t=>{
 const root=await fixture(t);await fs.writeFile(path.join(root,'a.txt'),'test');const manager=new DiskManager();const r=await manager.scan(root);const id=r.root.children[0].id;
 assert.equal(manager.node(id).name,'a.txt');assert.throws(()=>manager.deleteNode(r.root.id),/root cannot/);await manager.scan(root);assert.throws(()=>manager.node(id),/stale/);
});
test('cancellation during path validation stops before creating a worker',async t=>{
 const root=await fixture(t);const manager=new DiskManager();const work=manager.scan(root);manager.cancel();await assert.rejects(work,/Mapping cancelled/);assert.equal(manager.worker,null);
});
test('Explorer launch parser accepts spaced Unicode folders and rejects ambiguous paths',()=>{
 assert.equal(mapArgument(['exe','--map','C:\\My photos\\日本']), 'C:\\My photos\\日本');assert.equal(mapArgument(['exe','--map=C:/Data']), 'C:\\Data');
 for(const value of ['relative','C:relative','\\\\server\\data','C:\\Data\\..\\Windows','C:\\Data:stream','C:\\bad"path'])assert.equal(mapArgument(['--map',value]),null,value);
});
test('Explorer command quotes executable and selected directory without invoking a shell',()=>{
 assert.equal(explorerCommand('C:\\Program Files\\System69\\System69 Manager.exe'), '"C:\\Program Files\\System69\\System69 Manager.exe" --map "%1"');
 assert.equal(explorerCommand('C:\\electron.exe','C:\\source folder'), '"C:\\electron.exe" "C:\\source folder" --map "%1"');assert.throws(()=>explorerCommand('C:\\bad"path.exe'),/Invalid/);
});
test('Explorer opt-in touches only the app-specific per-user directory verb',async t=>{
 const scripts=[];t.mock.method(win,'ps',async s=>{scripts.push(s);return '';});
 const command=explorerCommand('C:\\Apps\\System69.exe');assert.equal((await contextStatus(command)).enabled,false);await setContextMenu(true,command,'C:\\Apps\\System69.exe');await setContextMenu(false,command,'C:\\Apps\\System69.exe');
 assert.ok(scripts.every(s=>s.includes('HKCU:')&&s.includes('System69.Map')));assert.ok(scripts.every(s=>!s.includes('HKLM:')));assert.match(scripts[1],/--map/);assert.match(scripts[2],/Remove-Item -LiteralPath/);
});
test('installer Explorer integration starts unchecked and uninstalls only its own verb',async()=>{
 const source=await fs.readFile(path.join(__dirname,'..','installer','chocolatey.nsh'),'utf8');
 assert.match(source,/\$\{NSD_Uncheck\} \$MapCheckbox/);assert.doesNotMatch(source,/\$\{NSD_Check\} \$MapCheckbox/);
 assert.match(source,/\$MapSelected == \$\{BST_CHECKED\}/);assert.match(source,/DeleteRegKey HKCU "Software\\Classes\\Directory\\shell\\System69\.Map"/);
});
test('treemap preserves proportional area and stays within the container',()=>{
 const items=[{size:60},{size:30},{size:10}];const r=layout(items,800,400);assert.equal(r.length,3);
 for(const rect of r){assert.ok(Math.abs(rect.width*rect.height-rect.item.size/100*320000)<1e-6);assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=800.000001&&rect.y+rect.height<=400.000001);}
 for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){const a=r[i],b=r[j];assert.ok(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<1e-6||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<1e-6);}
});
test('treemap handles empty zero-sized and invalid input without NaN geometry',()=>{
 assert.deepEqual(layout([{size:0},{size:NaN}],500,300),[]);assert.deepEqual(layout([{size:1}],0,300),[]);const r=layout([{size:1}],300,300);assert.equal(r[0].width*r[0].height,90000);
});
