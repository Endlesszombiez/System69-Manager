const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ApplicationManager}=require('../src/core/application-manager.cjs');
const {Bridge}=require('../src/core/bridge.cjs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
function fixture(responses={}){
 const calls=[];const events=[];const logs=[];
 const bridge={call:async(action,payload)=>{calls.push({action,payload});const response=responses[action];return typeof response==='function'?response(payload):response;}};
 const m=new ApplicationManager({log:async value=>logs.push(value)},bridge,e=>events.push(structuredClone(e)));
 m.stale=false;return {m,calls,events,logs};
}
const reviews=[{key:'Windows:a',name:'A',sourceLabel:'Windows',token:'a',eligible:true,mode:'Silent requested',cleanup:'Off'},{key:'Windows:b',name:'B',sourceLabel:'Windows',token:'b',eligible:true,mode:'Silent requested',cleanup:'Off'}];
test('missing native helper fails requests without leaving an unhandled pipe error',async()=>{
 const bridge=new Bridge(path.join(os.tmpdir(),crypto.randomUUID()+'.exe'),os.tmpdir(),os.tmpdir());
 await assert.rejects(bridge.call('scan',{}),/ENOENT|pipe|spawn/i);
 assert.throws(()=>bridge.call('scan',{}),/Restart System69 Manager/);
});
test('queue executes only reviewed eligible tokens sequentially and logs results',async()=>{
 const {m,calls,logs}=fixture({prepare:[...reviews,{key:'c',eligible:false,reason:'Blocked'}],execute:{success:true,detail:'Done'}});
 await m.prepare(['Windows:a','Windows:b','c'],true,false);await m.run();
 assert.deepEqual(calls.filter(x=>x.action==='execute').map(x=>x.payload),[{token:'a'},{token:'b'}]);
 assert.equal(m.queue[2].status,'Blocked');assert.equal(m.running,false);assert.equal(m.stale,true);assert.equal(logs.length,3);
});
test('stop after current lets current finish and preserves pending queue entries',async()=>{
 const {m,calls}=fixture({prepare:reviews,execute:()=>{m.stopRequested=true;return {success:true,detail:'Done'};}});
 await m.prepare(['Windows:a','Windows:b'],true,false);await m.run();
 assert.equal(calls.filter(x=>x.action==='execute').length,1);assert.equal(m.queue[0].status,'Completed');assert.equal(m.queue[1].status,'Ready');
});
test('reboot or still-running results halt the queue and block later batches',async()=>{
 const {m,calls}=fixture({prepare:reviews,execute:{success:true,rebootRequired:true,halt:true,detail:'Restart required'}});
 await m.prepare(['Windows:a','Windows:b'],true,false);await m.run();
 assert.equal(m.halted,true);assert.equal(calls.filter(x=>x.action==='execute').length,1);
 await assert.rejects(m.run(),/cannot start/);await assert.rejects(m.prepare(['Windows:b'],true,false),/Resolve/);
});
test('hide invalidates the entire prepared review so stale tokens cannot run',async()=>{
 const {m}=fixture({prepare:reviews,hide:[]});await m.prepare(['Windows:a','Windows:b'],true,false);
 await m.hide(['Windows:a'],true);assert.equal(m.queue.length,0);assert.deepEqual(m.review,[]);
});
test('log failure starts no uninstaller and releases queue running state',async()=>{
 const {m,calls}=fixture({prepare:reviews});await m.prepare(['Windows:a'],true,false);
 m.manager.log=async()=>{throw Error('Disk full');};await assert.rejects(m.run(),/Disk full/);
 assert.equal(m.running,false);assert.equal(calls.some(x=>x.action==='execute'),false);
});
test('bridge failures stop before next uninstaller and require fresh inventory for a new review',async()=>{
 const {m,calls}=fixture({prepare:reviews,execute:()=>{throw Error('service stopped');}});
 await m.prepare(['Windows:a','Windows:b'],true,false);await m.run();assert.equal(m.queue[0].status,'Failed');
 assert.equal(calls.filter(x=>x.action==='execute').length,1);await assert.rejects(m.prepare(['Windows:b'],true,false),/Refresh/);
});
