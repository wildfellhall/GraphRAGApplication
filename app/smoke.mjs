import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const question=process.argv[2]||'How is Student 01 doing with solving linear equations, and which prerequisites should I check?';
const start=Date.now();
const base=process.env.APP_URL||'http://127.0.0.1:4310';
const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,scope:{}})});
if(response.status!==200)throw Error(await response.text());
let buffer='',final,conversationId;const events=[];const reader=response.body.getReader(),decoder=new TextDecoder();
while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let boundary;
  while((boundary=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const line=block.split('\n').find(l=>l.startsWith('data: '));if(!line)continue;const e=JSON.parse(line.slice(6));
    if(e.type!=='token')events.push(e);
    if(e.type==='stage')console.log(`${Math.round((Date.now()-start)/1000)}s: ${e.stage.id} ${e.stage.status}`);
    if(e.type==='conversation')conversationId=e.id;
    if(e.type==='plan')console.log('PLAN',JSON.stringify(e.plan));
    if(e.type==='done')final=e.message;
    if(e.type==='error')throw Error(e.message);
  }
}
assert(final,'A real model answer must be produced');assert(final.citations.valid);assert(final.evidence.some(e=>e.kind==='path'||e.kind==='investigation'&&e.data.path));
assert(final.trace.some(q=>q.name==='prerequisites')&&final.trace.some(q=>q.name==='examples'));
assert.equal(events.filter(e=>e.type==='stage'&&e.stage.status==='done').length,6);
const saved=await(await fetch(base+'/api/conversations/'+conversationId)).json();assert.equal(saved.messages.at(-1).content,final.content);
await mkdir('test-results',{recursive:true});await writeFile('test-results/model-e2e-'+Date.now()+'.json',JSON.stringify({question,conversationId,elapsedMs:Date.now()-start,events,final},null,2));
console.log(JSON.stringify({status:'passed',question,conversationId,elapsedMs:Date.now()-start,answer:final.content,citations:final.citations,queries:final.trace.map(q=>({name:q.name,rows:q.rowCount}))},null,2));
