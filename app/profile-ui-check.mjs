import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.UI_URL||'http://127.0.0.1:4312';
const list=await fetch(base+'/api/conversations').then(r=>r.json());
let selected;
for(const c of list.slice(0,6)){
  const full=await fetch(base+'/api/conversations/'+c.id).then(r=>r.json());
  if(full.messages.some(m=>m.status==='complete'&&m.evidence?.some(e=>e.kind==='profile'))){selected=full;break;}
}
assert.ok(selected,'Run a full-profile smoke test first.');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9242');
const page=await browser.contexts()[0].newPage();const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.setViewportSize({width:1500,height:1000});await page.goto(base);
await page.locator(`[data-conversation-id="${selected.id}"]`).click();
await page.getByRole('heading',{name:'Recorded skill profile'}).waitFor();
assert.equal(await page.locator('.answer-text tbody tr').count(),15);
await page.getByRole('heading',{name:'Recorded skill profile'}).scrollIntoViewIfNeeded();
await page.screenshot({path:'test-results/meridian-profile.png',fullPage:true});
const answer=selected.messages.findLast(m=>m.evidence?.some(e=>e.kind==='investigation'));
const investigation=answer.evidence.find(e=>e.kind==='investigation');
await page.getByRole('button',{name:investigation.id,exact:true}).first().click();
const card=page.locator('#source-'+investigation.id);
await card.getByText('Prerequisite diagnostic',{exact:true}).waitFor();
assert.match(await card.innerText(),/Teacher answer key:/);
assert.doesNotMatch(await card.innerText(),/undefined|NaN/);
await page.getByRole('button',{name:'Close evidence'}).click();
await page.setViewportSize({width:390,height:844});
await page.getByRole('heading',{name:'Recorded skill profile'}).scrollIntoViewIfNeeded();
const size=await page.evaluate(()=>({client:innerWidth,scroll:document.documentElement.scrollWidth}));
assert.equal(size.client,size.scroll);
await page.screenshot({path:'test-results/meridian-profile-mobile.png',fullPage:true});
assert.deepEqual(errors,[]);
console.log('Passed all 15 profile rows, investigation citations and diagnostics, mobile overflow, and browser error checks.');
await page.close();await browser.close();
