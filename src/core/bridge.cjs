const { spawn } = require('node:child_process');
const readline = require('node:readline');
class Bridge {
  constructor(executable, dataDir, appRoot, emit = () => {}) { Object.assign(this, { executable, dataDir, appRoot, emit }); this.pending = new Map(); this.serial = 0; }
  start() {
    if (this.failed) throw new Error('Native service is unavailable. Restart System69 Manager. '+this.failed.message);
    if (this.child) return;
    const child = this.child = spawn(this.executable, [this.dataDir], { windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env, SYSTEM69_APP_ROOT:this.appRoot} });
    this.stderr = '';
    child.stdin.on('error', error => { this.failed=error; this.fail(error); });
    child.stderr.on('data', b => { this.stderr = (this.stderr + b.toString()).slice(-4000); });
    readline.createInterface({ input:child.stdout }).on('line', line => {
      try {
        const value = JSON.parse(line);
        if (value.event) { this.emit({type:value.event,message:value.message}); return; }
        const request = this.pending.get(value.id); if (!request) return;
        this.pending.delete(value.id); value.ok ? request.resolve(value.value) : request.reject(new Error(value.error));
      } catch { this.fail(new Error('Invalid native service response. Restart System69 Manager.')); }
    });
    child.on('error', error => { this.failed=error; this.fail(error); });
    child.on('close', () => { this.child = null; this.failed ||= new Error('Native service stopped. '+this.stderr); this.fail(this.failed); });
  }
  fail(error) { for (const p of this.pending.values()) p.reject(error); this.pending.clear(); }
  call(action, payload = {}) {
    this.start();
    return new Promise((resolve,reject) => {
      const id = ++this.serial; this.pending.set(id,{resolve,reject});
      this.child.stdin.write(JSON.stringify({id,action,payload})+'\n', error => { if(error) {this.pending.delete(id);reject(error);} });
    });
  }
  close() { this.child?.stdin.end(); }
}
module.exports = { Bridge };
