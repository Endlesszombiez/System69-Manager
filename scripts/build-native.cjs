const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const local = path.join(process.env.TEMP || '', 'system69-build-tools', 'dotnet', 'dotnet.exe');
const sdk = process.env.SYSTEM69_DOTNET || (fs.existsSync(local) ? local : 'dotnet');
for(const args of [ ['run','--project','tests/native','-c','Release'], ['publish','native/System69.Bridge','-c','Release','-r','win-x64','--self-contained','true','-o','native-publish','--source','https://api.nuget.org/v3/index.json'] ]) {
  const result=spawnSync(sdk,args,{stdio:'inherit',windowsHide:true});
  if(result.status!==0) process.exit(result.status||1);
}
