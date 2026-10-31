// Exercises the actual JSON service with read-only inventory and isolated preferences.
const {Bridge}=require('../src/core/bridge.cjs');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'system69-bridge-'));
 const bridge=new Bridge(path.resolve('native-publish/System69.Bridge.exe'),data,path.resolve('.'));
 try {
  await assert.rejects(bridge.call('execute',{token:'unreviewed-token'}),/Review expired/);
  const result=await bridge.call('scan',{brew:false});assert.ok(result.apps.length>0);
  const app=result.apps.find(a=>!a.protected);assert.ok(app);
  const hidden=await bridge.call('hide',{keys:[app.key],hide:true});assert.equal(hidden.find(a=>a.key===app.key).hidden,true);
  const review=await bridge.call('prepare',{keys:[app.key],silent:true,advanced:true});assert.equal(review[0].eligible,false);assert.match(review[0].reason,/Hidden/);
  const restored=await bridge.call('hide',{keys:[app.key],hide:false});assert.equal(restored.find(a=>a.key===app.key).hidden,false);
  const node=result.apps.find(a=>a.name.startsWith('Node.js'));
  if(node){const r=await bridge.call('prepare',{keys:[node.key],silent:true,advanced:true});assert.equal(r[0].eligible,false);assert.match(r[0].reason,/Node.js runtimes/);}
  await bridge.call('discard');
  console.log(`Native bridge checks passed: ${result.apps.length} live source entries, isolated hide/unhide, hidden-app and unreviewed-token rejection, Node.js routing. No uninstall executed.`);
 } finally {bridge.close();await fs.rm(data,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
