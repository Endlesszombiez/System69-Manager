const fs=require('node:fs/promises');
const path=require('node:path');
const {parentPort,workerData}=require('node:worker_threads');

// Retain the largest files for display, without retaining every file encountered.
function retain(heap,item,limit){
  if(limit<1)return;
  if(heap.length<limit){heap.push(item);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].size<=heap[i].size)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}return;}
  if(item.size<=heap[0].size)return;
  heap[0]=item;let i=0;
  while(true){let c=i*2+1;if(c>=heap.length)break;if(c+1<heap.length&&heap[c+1].size<heap[c].size)c++;if(heap[i].size<=heap[c].size)break;[heap[i],heap[c]]=[heap[c],heap[i]];i=c;}
}
async function scan(root,{maxEntries=Infinity,maxNodes=80000,maxMilliseconds=Infinity,concurrency=8}={},progress=()=>{}){
  const started=Date.now();let entries=0,files=0,skipped=0,links=0,total=0,lastProgress=0,limited=false;
  const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Choose a regular folder or drive. Links and junctions cannot be mapped directly.');
  const tree={name:path.basename(root)||root,path:root,kind:'directory',size:0,children:[]};
  const fileBudget=Math.max(1,Math.floor(maxNodes*.4)),directoryBudget=Math.max(1,Math.floor(maxNodes*.6));
  const rootBranch={heap:[],bytes:0,fileLimit:fileBudget,dirLimit:0,dirs:0};
  const branches=[rootBranch];
  const records=[{path:root,parent:-1,node:tree,branch:rootBranch,size:0,depth:0}];
  function exhausted(){if(entries>=maxEntries||Date.now()-started>=maxMilliseconds){limited=true;return true;}return false;}
  function report(current,force=false){
    if(!force&&Date.now()-lastProgress<500)return;lastProgress=Date.now();
    const children=branches.slice(1).map(b=>({name:b.node.name,path:b.node.path,kind:'directory',size:b.bytes,aggregate:true}));
    if(rootBranch.bytes)children.push({name:'Files in drive / folder root',kind:'aggregate',size:rootBranch.bytes,aggregate:true});
    progress({entries,nodes:records.length,skipped,links,path:current,preview:{preview:true,root:{name:tree.name,path:root,kind:'directory',size:total,children},entries,skipped,links,elapsed:Date.now()-started}});
  }
  async function processDirectory(record,index){
    let iterator;
    try{
      // Reject a directory that changed into a junction after its parent was read.
      if((await fs.lstat(record.path)).isSymbolicLink()){links++;return;}
      iterator=await fs.opendir(record.path,{bufferSize:256});
      while(!exhausted()){
        const batch=[];
        for(let i=0;i<32&&!exhausted();i++){const entry=await iterator.read();if(!entry)break;entries++;batch.push(entry);}
        if(!batch.length)break;
        const metadata=await Promise.all(batch.map(async entry=>{
          if(entry.isSymbolicLink())return {entry,link:true};
          try{return {entry,info:await fs.lstat(path.join(record.path,entry.name))};}catch{return {entry,error:true};}
        }));
        for(const {entry,info,link,error} of metadata){
          if(link||info?.isSymbolicLink()){links++;continue;}
          if(error){skipped++;continue;}
          const full=path.join(record.path,entry.name);
          if(info.isDirectory()){
            let branch=record.branch,node=null;
            if(index===0){
              node={name:entry.name,path:full,kind:'directory',size:0,children:[]};
              branch={heap:[],bytes:0,fileLimit:0,dirLimit:0,dirs:1,node};branches.push(branch);tree.children.push(node);
            }else if(record.node&&record.depth<16&&branch.dirs<branch.dirLimit){
              node={name:entry.name,path:full,kind:'directory',size:0,children:[]};record.node.children.push(node);branch.dirs++;
            }
            records.push({path:full,parent:index,node,branch,size:0,depth:record.depth+1});
          }else if(info.isFile()){
            files++;record.size+=info.size;record.branch.bytes+=info.size;total+=info.size;
            if(record.node)retain(record.branch.heap,{name:entry.name,path:full,kind:'file',size:info.size,parent:record.node},record.branch.fileLimit);
          }else skipped++;
        }
        report(record.path);
      }
      if(limited&&record.node)record.node.incomplete=true;
    }catch{skipped++;if(record.node)record.node.incomplete=true;}
    finally{if(iterator)await iterator.close().catch(()=>{});}
  }
  // Discover all top-level folders first. Each branch gets a display budget;
  // exhausting it summarizes detail rather than stopping filesystem traversal.
  await processDirectory(records[0],0);
  const perBranchFiles=Math.max(1,Math.floor(fileBudget/branches.length));
  const perBranchDirectories=Math.max(1,Math.floor(directoryBudget/Math.max(1,branches.length-1)));
  rootBranch.heap.sort((a,b)=>b.size-a.size);rootBranch.heap.length=Math.min(rootBranch.heap.length,perBranchFiles);
  for(const branch of branches){branch.fileLimit=perBranchFiles;branch.dirLimit=perBranchDirectories;}
  // Root-file collection is complete, so its descending heap order is harmless.
  let next=1;const active=new Set();
  while((next<records.length&&!limited)||active.size){
    while(!limited&&active.size<concurrency&&next<records.length){const index=next++;let work;work=processDirectory(records[index],index).finally(()=>active.delete(work));active.add(work);}
    if(active.size)await Promise.race(active);
  }
  for(let i=records.length-1;i>=0;i--){const r=records[i];if(r.node)r.node.size=r.size;if(r.parent>=0)records[r.parent].size+=r.size;}
  for(const branch of branches)for(const item of branch.heap){const {parent,...file}=item;parent.children.push(file);}
  let nodes=0,summarized=0;
  for(const r of records)if(r.node){
    nodes+=1+r.node.children.filter(n=>n.kind==='file').length;
    const missing=r.node.size-r.node.children.reduce((sum,n)=>sum+n.size,0);
    if(missing>0){r.node.children.push({name:'Other files / deeper contents',kind:'aggregate',aggregate:true,size:missing});summarized++;}
    if(limited)r.node.incomplete=true;
  }
  report(root,true);
  return {root:tree,entries,files,directories:records.length,nodes,summarized,skipped,links,limited,elapsed:Date.now()-started,scannedAt:new Date().toISOString()};
}
if(parentPort)scan(workerData.root,workerData.options,p=>parentPort.postMessage({type:'progress',...p})).then(result=>parentPort.postMessage({type:'complete',result}),error=>parentPort.postMessage({type:'error',message:error.message}));
module.exports={scan};
