import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9242');
const page=await browser.contexts()[0].newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.setViewportSize({width:1500,height:1000});
const url=process.env.UI_URL||'http://127.0.0.1:4311/';
await page.goto(url);
const saved=await page.request.get(new URL('/api/conversations',url).href).then(r=>r.json());
let selected;
for(const c of saved.slice(0,6)){
  const full=await page.request.get(new URL('/api/conversations/'+c.id,url).href).then(r=>r.json());
  if(full.messages.some(m=>m.role==='assistant'&&m.status==='complete')){selected=c;break;}
}
assert.ok(selected,'Run app:smoke first to save a live-model answer.');
await page.locator(`[data-conversation-id="${selected.id}"]`).click();
await page.getByRole('heading',{name:'Recorded evidence'}).waitFor();
assert.ok(await page.locator('.citation').count()>2);
await page.locator('.citation').first().click();
await page.getByRole('heading',{name:'Follow the evidence.'}).waitFor();
assert.equal(await page.locator('.evidence-card.highlight').count(),1);
assert.ok(await page.locator('.path-list').count()>0);
await page.screenshot({path:'test-results/meridian-evidence.png',fullPage:true});
await page.getByRole('button',{name:/Graph queries/}).click();
assert.ok(await page.locator('.query-card').count()>=6);
assert.match(await page.locator('.query-card').allTextContents().then(x=>x.join('\n')),/PREREQUISITE_OF/);
await page.screenshot({path:'test-results/meridian-queries.png',fullPage:true});
assert.deepEqual(errors,[]);
console.log('Passed saved live-model conversation, citations, prerequisite paths, actual Cypher trace, and browser error checks.');
await page.close();await browser.close();
