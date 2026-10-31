class ApplicationManager {
  constructor(manager, bridge, emit) { Object.assign(this,{manager,bridge,emit}); this.apps=[]; this.queue=[]; this.review=[]; this.running=false; this.stopRequested=false; this.halted=false; this.stale=true; }
  async scan(brew=false) { const result=await this.bridge.call('scan',{brew}); this.apps=result.apps;this.review=[];this.queue=[];this.stale=false;return result; }
  async hide(keys,hide) { this.apps=await this.bridge.call('hide',{keys,hide});this.queue=[];this.review=[];return this.apps; }
  async discard() { await this.bridge.call('discard'); this.queue=[]; this.review=[]; }
  async prepare(keys,silent,advanced) {
    if(this.halted) throw new Error('Resolve the previous operation and restart System69 before continuing.');
    if(this.stale) throw new Error('Refresh application inventory before preparing another batch.');
    if(!Array.isArray(keys)||keys.length===0) throw new Error('Select applications first.');
    this.review=await this.bridge.call('prepare',{keys,silent,advanced});
    this.queue=this.review.map(x=>({...x,status:x.eligible?'Ready':'Blocked',detail:x.reason||x.mode}));
    return this.review;
  }
  async run() {
    if(this.running||this.halted) throw new Error('The uninstall queue cannot start.');
    if(!this.queue.some(x=>x.status==='Ready')) throw new Error('No eligible queue entries. Review the queue again.');
    this.running=true;this.stopRequested=false;
    try {
      await this.manager.log('Starting reviewed uninstall queue.');
      for(const row of this.queue) {
        if(this.stopRequested||this.halted) break;
        if(row.status!=='Ready') continue;
        row.status='Running';this.publish();this.stale=true;
        try { const r=await this.bridge.call('execute',{token:row.token});row.status=r.rebootRequired?'Restart needed':r.success?'Completed':'Failed';row.detail=r.detail;this.halted=!!r.halt; }
        catch(error) {row.status='Failed';row.detail=error.message;this.stopRequested=true;}
        this.publish();
        await this.manager.log(`${row.name} [${row.sourceLabel}]: ${row.status}. ${row.detail}`);
      }
      return this.queue;
    } finally { this.running=false;this.publish(); }
  }
  publish(){this.emit({type:'queue',queue:this.queue,running:this.running,halted:this.halted});}
}
module.exports={ ApplicationManager };
