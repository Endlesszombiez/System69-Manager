const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir,entry.name)) : [path.join(dir,entry.name)]);
}
for(const file of [...walk('src'),...walk('scripts'),...walk('tests')].filter(f => /\.(cjs|js)$/.test(f))) {
  const result = spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
for(const file of [...walk('src'),...walk('scripts'),...walk('tests'),...walk('native'),...walk('installer'),'package.json','.gitignore','Directory.Build.props','LICENSE','README.md'].filter(f=>fs.existsSync(f)&&!/[/\\](bin|obj)[/\\]/.test(f)&&/\.(cjs|js|cs|csproj|props|ps1|css|html|md|json|nsh)$/.test(f))) {
  const current=fs.readFileSync(file,'utf8');
  const committed=spawnSync('git',['show',`HEAD:${file.replaceAll('\\','/')}`],{encoding:'utf8'});
  const existingLF=committed.status===0&&committed.stdout.includes('\n')&&!committed.stdout.includes('\r\n');
  if(existingLF?current.includes('\r\n'):/(?<!\r)\n/.test(current)) throw new Error(`${file} changed its required line separator style.`);
}
console.log('JavaScript syntax and per-file line separator checks passed.');
