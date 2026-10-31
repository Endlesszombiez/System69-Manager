const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const packaged=process.argv.includes('--packaged');
async function main(){
 const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'system69-disk-desktop-'));
 const mapped=path.join(fixture,'Mapped folder 日本');const photos=path.join(mapped,'Photos');
 await fs.mkdir(photos,{recursive:true});await fs.mkdir(path.join(mapped,'System32'));await fs.writeFile(path.join(photos,'a.jpg'),Buffer.alloc(90000));await fs.writeFile(path.join(photos,'b.jpg'),Buffer.alloc(30000));await fs.writeFile(path.join(mapped,'notes.txt'),'notes');await fs.writeFile(path.join(mapped,'System32','system.txt'),'protected test');
 const env={...process.env,NODE_MANAGER_TEST_DATA:path.join(fixture,'app-data')};delete env.ELECTRON_RUN_AS_NODE;
 const args=[...(packaged?[]:[path.resolve('.')]),'--smoke-test','--map',mapped];
 const app=await electron.launch({...(packaged?{executablePath:path.resolve('release/win-unpacked/System69 Manager.exe')}:{}),args,env,timeout:30000});
 const errors=[];
 try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('#disk-status').textContent.startsWith('Map complete.')&&!document.body.classList.contains('busy'),null,{timeout:180000});
  assert.equal(await page.locator('#disk-page').isVisible(),true,'--map opens Disk map');assert.equal(await page.locator('#disk-directory').inputValue(),mapped);
  assert.ok(await page.locator('#disk-treemap [data-nodeid]').count()>=3);
  assert.equal(await page.locator('#disk-depth').inputValue(),'4');
  const detailedBlocks=await page.locator('#disk-treemap [data-nodeid]').count();
  await page.locator('#disk-depth').selectOption('1');
  assert.ok(await page.locator('#disk-treemap [data-nodeid]').count()<detailedBlocks,'Depth selector expands nested contents');
  await page.locator('#disk-depth').selectOption('4');
  // Mock only the OS menu/reveal surface. All scanning, policy checks and routing stay real.
  await app.evaluate(({Menu,shell})=>{globalThis.diskMenuChoice=null;Menu.buildFromTemplate=items=>({popup:({callback})=>{globalThis.diskMenuLabels=items.map(x=>x.label);const choice=items.find(x=>x.label===globalThis.diskMenuChoice);if(choice?.enabled!==false)choice?.click?.();callback();}});shell.showItemInFolder=p=>{globalThis.diskRevealed=p;};});
  await page.locator('#disk-rows').getByRole('button',{name:'System32',exact:true}).click({button:'right'});
  await page.waitForTimeout(300);
  assert.equal(await app.evaluate(()=>globalThis.diskMenuLabels.some(x=>x?.startsWith('Delete'))),false,'System32 does not offer Delete');
  await app.evaluate(()=>{globalThis.diskMenuChoice='Map this folder';});
  await page.locator('#disk-rows').getByRole('button',{name:'Photos',exact:true}).click({button:'right'});
  await page.waitForFunction(expected=>document.querySelector('#disk-directory').value===expected&&!document.body.classList.contains('busy'),photos);
  assert.equal(await page.locator('#disk-rows tr').count(),2,'Map this folder performs a new root scan');
  await page.locator('#disk-rows').getByRole('button',{name:'a.jpg',exact:true}).click();
  await page.locator('#disk-reveal').click();await page.waitForTimeout(100);
  assert.equal(await app.evaluate(()=>globalThis.diskRevealed),path.join(photos,'a.jpg'));
  await page.screenshot({path:'artifacts/disk-map.png',fullPage:true});
  await page.locator('#disk-open-picker').click();await page.locator('#disk-directory').fill('C:\\');await page.locator('#disk-map-start').click();await page.locator('#disk-cancel').click();
  await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.match(await page.locator('#disk-status').textContent(),/cancelled/);
  await app.evaluate(({app},directory)=>{app.emit('second-instance',{},[process.execPath,'--map',directory]);},mapped);
  await page.waitForFunction(expected=>document.querySelector('#disk-directory').value===expected&&document.querySelector('#disk-status').textContent.startsWith('Map complete.')&&!document.body.classList.contains('busy'),mapped);
  await page.setViewportSize({width:1000,height:700});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log(`${packaged?'Packaged':'Development'} disk-map checks passed: CLI launch, second-instance routing, nested treemap, remap, protected menu, Explorer reveal, cancellation and compact layout. No user files deleted or Explorer registration changed.`);
 }finally{await app.close();await fs.rm(fixture,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
