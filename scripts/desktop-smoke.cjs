// Electron's native application automation; no external browser is used.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const packaged = process.argv.includes('--packaged');
async function launch(mode, callback) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(),'node-manager-ui-'));
  const env = {...process.env, NODE_MANAGER_TEST_DATA:data};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({...(packaged?{executablePath:path.resolve('release','win-unpacked','System69 Manager.exe')}:{}),args:[...(packaged?[]:[path.resolve('.')]),'--smoke-test',...(mode==='demo'?['--demo']:[])],env,timeout:30000});
  const errors=[];
  try {
    const page=await app.firstWindow();
    page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>/\d/.test(document.querySelector('#installed-count').textContent));
    await page.waitForFunction(()=>document.querySelector('#operation-status').textContent==='Ready'&&!document.body.classList.contains('busy'),null,{timeout:180000});
    await callback(page,app);
    assert.deepEqual(errors,[],'No renderer exceptions');
  } finally { await app.close(); await fs.rm(data,{recursive:true,force:true}); }
}
async function main() {
  await fs.mkdir('artifacts',{recursive:true});
  await launch('demo',async page=>{
    assert.equal(await page.locator('#applications-page').isVisible(),true);
    assert.equal(await page.locator('#app-rows tr').count(),4);
    assert.equal(await page.locator('.brand-logo').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await page.screenshot({path:'artifacts/applications.png',fullPage:true});
    await page.locator('#app-search').fill('VLC');assert.equal(await page.locator('#app-rows tr').count(),1);
    await page.getByRole('checkbox',{name:'Select VLC media player',exact:true}).check();
    await page.locator('#hide-apps').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Applications hidden'));
    assert.equal(await page.getByRole('checkbox',{name:'Select VLC media player',exact:true}).count(),0);
    await page.locator('#show-hidden').check();await page.getByRole('checkbox',{name:'Select VLC media player',exact:true}).check();
    await page.locator('#unhide-apps').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Applications unhidden'));
    await page.locator('#app-search').fill('');await page.locator('#show-hidden').uncheck();
    await page.getByRole('checkbox',{name:'Select 7-Zip',exact:true}).check();
    await page.getByRole('checkbox',{name:'Select Visual Studio Code',exact:true}).check();
    await page.locator('#review-apps').click();await page.locator('#queue-page').waitFor({state:'visible'});
    assert.equal(await page.locator('.queue-item').count(),2);assert.equal(await page.getByText('Blocked',{exact:true}).count(),1);
    assert.equal(await page.locator('#start-queue').isDisabled(),true);
    await page.locator('#queue-reviewed').check();assert.equal(await page.locator('#start-queue').isEnabled(),true);
    await page.screenshot({path:'artifacts/queue.png',fullPage:true});
    await page.locator('#clear-queue').click();await page.waitForFunction(()=>document.querySelectorAll('.queue-item').length===0);assert.equal(await page.locator('.queue-item').count(),0);
    await page.locator('[data-page="disk"]').click();assert.equal(await page.locator('#map-folder-dialog').isVisible(),true);assert.equal(await page.locator('#disk-directory').inputValue(),'C:\\');await page.getByRole('button',{name:'Close folder picker'}).click();
    await page.locator('[data-page="versions"]').click();
    assert.equal(await page.locator('.version-card').count(),3);
    await page.screenshot({path:'artifacts/versions.png',fullPage:true});
    await page.locator('#search').fill('v22');assert.equal(await page.locator('.version-card').count(),1);
    await page.locator('#search').fill('unmatched');assert.equal(await page.locator('#version-list .empty').count(),1);
    await page.locator('#search').fill('');
    await page.locator('#version-filter').selectOption('updates');assert.equal(await page.locator('.version-card').count(),2);
    await page.locator('#version-filter').selectOption('all');
    await page.getByRole('button',{name:'Add to PATH',exact:true}).first().click();
    assert.equal(await page.locator('#path-dirty').textContent(),'Unsaved changes');
    await page.screenshot({path:'artifacts/path.png',fullPage:true});
    await page.locator('#discard-path').click();assert.equal(await page.locator('#path-dirty').textContent(),'No unsaved changes');
    await page.getByRole('button',{name:'Machine PATH',exact:true}).click();assert.equal(await page.locator('#save-path').isDisabled(),true);
    await page.locator('[data-page="chocolatey"]').click();assert.equal(await page.locator('.package-card').count(),3);
    assert.equal(await page.locator('#choco-specific').isDisabled(),true);
    await page.screenshot({path:'artifacts/chocolatey.png',fullPage:true});
    await page.locator('[data-page="activity"]').click();await page.locator('#activity-log').filter({hasText:'Preview mode'}).waitFor();
    await page.locator('[data-page="versions"]').click();
    await page.locator('#open-install').click();assert.equal(await page.locator('#install-dialog').isVisible(),true);
    assert.ok(await page.locator('#release-select option').count()>0);
    await page.getByRole('button',{name:'Close install dialog'}).click();
    await page.setViewportSize({width:1000,height:700});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow at minimum width');
    await page.screenshot({path:'artifacts/versions-compact.png',fullPage:true});
  });
  await launch('live',async page=>{
    assert.ok(await page.locator('#app-rows tr').count()>10,'Live application inventory finds installed software');
    assert.equal(await page.locator('#app-rows input[data-locked="false"]').first().isEnabled(),true,'Live selection re-enables after inventory operations');
    await page.screenshot({path:'artifacts/live-applications.png',fullPage:false});
    await page.locator('[data-page="versions"]').click();
    assert.ok(await page.locator('.version-card').count()>0,'Live discovery finds this Windows installation');
    assert.match(await page.locator('#catalog-status').textContent(),/nodejs.org|Offline/);
    await page.screenshot({path:'artifacts/live-versions.png',fullPage:true});
  });
  console.log(`${packaged?'Packaged':'Development'} desktop smoke checks passed: ${packaged?'':'live discovery, '}application inventory, hide/unhide, uninstall review, demo flows, filtering, PATH drafts, permissions, packages, activity, install dialog, and compact layout.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
