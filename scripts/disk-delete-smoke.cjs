// Only newly created, uniquely named disposable files are used by this check.
const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const packaged=process.argv.includes('--packaged');
async function main(){
 const downloads=path.join(os.homedir(),'Downloads');await fs.access(downloads);
 const fixture=path.join(downloads,'System69-disposable-test-'+crypto.randomUUID());await fs.mkdir(fixture);
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'system69-delete-ui-'));
 const selected=path.join(fixture,'disposable.txt'),sibling=path.join(fixture,'sibling.txt');
 await fs.writeFile(selected,'created only for System69 deletion verification');await fs.writeFile(sibling,'this sibling must survive');
 const env={...process.env,NODE_MANAGER_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try{
  app=await electron.launch({...(packaged?{executablePath:path.resolve('release/win-unpacked/System69 Manager.exe')}:{}),args:[...(packaged?[]:[path.resolve('.')]),'--smoke-test','--map',fixture],env,timeout:30000});
  const page=await app.firstWindow();
  await page.waitForFunction(()=>document.querySelector('#disk-status').textContent.startsWith('Map complete.')&&!document.body.classList.contains('busy'),null,{timeout:180000});
  await page.locator('#disk-rows').getByRole('button',{name:'disposable.txt',exact:true}).click();await page.locator('#disk-delete').waitFor({state:'visible'});
  await app.evaluate(({dialog,shell})=>{dialog.showMessageBox=async()=>({response:1});globalThis.realDiskTrash=shell.trashItem;shell.trashItem=async()=>{throw Error('Simulated Recycle Bin failure');};});
  await page.locator('#disk-delete').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('item was restored')&&!document.body.classList.contains('busy'));
  assert.match(await fs.readFile(selected,'utf8'),/verification/);assert.match(await fs.readFile(sibling,'utf8'),/must survive/);
  await app.evaluate(({shell})=>{shell.trashItem=globalThis.realDiskTrash;});
  await page.locator('#disk-delete').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Moved to the Recycle Bin')&&!document.body.classList.contains('busy'));
  await assert.rejects(fs.access(selected));assert.match(await fs.readFile(sibling,'utf8'),/must survive/);
  console.log(`${packaged?'Packaged':'Development'} guarded deletion passed: native review, failed-recycle restoration, successful Recycle Bin move, and sibling preservation. Only newly created test files were affected.`);
 }finally{
  if(app)await app.close();
  if(path.dirname(fixture)===downloads&&path.basename(fixture).startsWith('System69-disposable-test-'))await fs.rm(fixture,{recursive:true,force:true});
  await fs.rm(data,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
