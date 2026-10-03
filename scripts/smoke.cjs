const {_electron:electron}=require('playwright');
const path=require('node:path');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
  const directory=path.resolve('Files/private/verification/desktop-'+Date.now());await fs.mkdir(directory,{recursive:true});
  const env={...process.env,FLARE_DATA_DIR:path.join(directory,'data')};delete env.ELECTRON_RUN_AS_NODE;
  const instance=await electron.launch({executablePath:require('electron'),args:['.'],cwd:path.resolve('.'),env,timeout:60000});
  const errors=[];instance.process().stderr.on('data',x=>{const text=x.toString();if(!/ExperimentalWarning|electron\/security|Autofill/.test(text))process.stdout.write(text);});
  try{
    const page=await instance.firstWindow();page.on('pageerror',error=>errors.push(error.message));
    await page.getByRole('combobox',{name:'Search Flare'}).waitFor();
    await page.waitForFunction(async()=>(await window.flare.call('snapshot')).ready,{timeout:60000});
    await page.screenshot({path:path.join(directory,'01-empty-dark.png')});
    await page.getByRole('combobox',{name:'Search Flare'}).fill('Notepad');
    await page.locator('.result[role=option]').first().waitFor({timeout:30000});
    await page.screenshot({path:path.join(directory,'02-search.png')});
    const titles=await page.locator('.result-title').allTextContents();assert.ok(titles.some(x=>/notepad/i.test(x)),'Actual Start Menu app result');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'light theme'}).click();
    await page.screenshot({path:path.join(directory,'03-settings-light.png')});
    await page.getByRole('button',{name:'Close settings'}).click();
    await page.getByRole('button',{name:'File tools',exact:true}).click();await page.getByText('Images to PDF',{exact:true}).click();
    await page.screenshot({path:path.join(directory,'04-tools-light.png')});
    assert.equal(errors.length,0,errors.join('\n'));
    const snapshot=await page.evaluate(()=>window.flare.call('snapshot'));assert.equal(snapshot.settings.theme,'light');assert.ok(snapshot.count>0);
    console.log(JSON.stringify({ok:true,appResults:titles,indexedEntries:snapshot.count,screenshots:directory,shortcutError:snapshot.shortcutError}));
  }catch(error){const page=await instance.firstWindow();await page.screenshot({path:path.join(directory,'failure.png')});console.log(await page.locator('body').innerText());console.log(await page.evaluate(()=>window.flare.call('snapshot')));throw error;}finally{await instance.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
