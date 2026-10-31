const win=require('./windows.cjs');
const KEY='HKCU:\\Software\\Classes\\Directory\\shell\\System69.Map';
function explorerCommand(executable,appDirectory){
  if([executable,appDirectory].some(x=>x&&/["\0\r\n]/.test(x)))throw Error('Invalid application path.');
  return `"${executable}"${appDirectory?' "'+appDirectory+'"':''} --map "%1"`;
}
async function contextStatus(command){const value=await win.ps(`$p=${win.psQuote(KEY+'\\command')}; if(Test-Path -LiteralPath $p){(Get-Item -LiteralPath $p).GetValue('')}else{''}`);return {enabled:value.trim()===command};}
async function setContextMenu(enabled,command,executable){
  const key=win.psQuote(KEY);
  if(enabled)await win.ps(`$p=${key}; New-Item -Path $p -Force | Out-Null; Set-Item -LiteralPath $p -Value 'Map with System69'; New-ItemProperty -LiteralPath $p -Name 'Icon' -Value ${win.psQuote('"'+executable+'",0')} -PropertyType String -Force | Out-Null; New-Item -Path ($p+'\\command') -Force | Out-Null; Set-Item -LiteralPath ($p+'\\command') -Value ${win.psQuote(command)}`);
  else await win.ps(`$p=${key}; if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Recurse -Force}`);
  return {enabled};
}
module.exports={explorerCommand,contextStatus,setContextMenu};
