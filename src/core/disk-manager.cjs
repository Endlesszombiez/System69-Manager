const path=require('node:path');
const fs=require('node:fs/promises');
const {Worker}=require('node:worker_threads');
function mapArgument(argv){
  const i=argv.indexOf('--map');const value=i>=0?argv[i+1]:argv.find(x=>x.startsWith('--map='))?.slice(6);
  if(!value)return null;
  if(!/^[a-z]:[\\/]/i.test(value)||/[\0"<>|?*]/.test(value)||value.slice(2).includes(':')||value.split(/[\\/]/).some(x=>x==='.'||x==='..'))return null;
  return path.win32.normalize(value);
}
class DiskManager{
  constructor(emit=()=>{}){this.emit=emit;this.nodes=new Map();this.serial=0;this.worker=null;this.result=null;}
  async scan(directory){
    if(this.worker)throw Error('A disk map is already running.');
    if(typeof directory!=='string'||!mapArgument(['--map',directory]))throw Error('Choose an absolute local folder, such as C:\\Users\\you\\Downloads.');
    directory=path.win32.normalize(directory);this.cancelled=false;this.nodes.clear();this.result=null;
    // Reject linked ancestors too, rather than entering a junction via an ordinary child path.
    for(let current=directory;;current=path.dirname(current)){if((await fs.lstat(current)).isSymbolicLink())throw Error('Links, junctions, and mount points are not mapped.');if(this.cancelled)throw Error('Mapping cancelled.');if(path.dirname(current)===current)break;}
    return new Promise((resolve,reject)=>{
      const worker=this.worker=new Worker(path.join(__dirname,'disk-scan-worker.cjs'),{workerData:{root:directory}});
      let settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;this.worker=null;worker.terminate().catch(()=>{});error?reject(error):resolve(result);};
      worker.on('message',m=>{
        if(m.type==='progress')this.emit({...m,type:'disk-progress',message:`Mapping entire folder: ${m.entries.toLocaleString()} entries · ${m.skipped} unreadable`});
        if(m.type==='error')finish(Error(m.message));
        if(m.type==='complete'){
          const stack=[m.result.root];while(stack.length){const n=stack.pop();if(!n.aggregate){n.id=String(++this.serial);this.nodes.set(n.id,n);}if(n.children)for(const child of n.children)stack.push(child);}
          this.result=m.result;finish(null,m.result);
        }
      });
      worker.on('error',error=>finish(error));worker.on('exit',code=>{if(!settled)finish(Error(this.cancelled?'Mapping cancelled.':'Mapping stopped.'));});
    });
  }
  cancel(){this.cancelled=true;if(this.worker)this.worker.terminate().catch(()=>{});}
  node(id){const n=this.nodes.get(String(id));if(!n)throw Error('This map item is stale. Map the folder again.');return n;}
  deleteNode(id){const n=this.node(id);if(n===this.result?.root)throw Error('The map root cannot be deleted. Map its parent to inspect a child instead.');return n;}
}
module.exports={DiskManager,mapArgument};
