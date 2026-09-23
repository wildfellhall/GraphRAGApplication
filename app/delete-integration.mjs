import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const base=process.env.APP_URL||'http://127.0.0.1:4310';
const request=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'Deletion regression: give a Grade 8 overview.'})});
assert.equal(request.status,200);const reader=request.body.getReader(),decoder=new TextDecoder();let text='',id;
while(!id){const {value,done}=await reader.read();assert.equal(done,false);text+=decoder.decode(value,{stream:true});for(const line of text.split('\n'))if(line.startsWith('data: ')){try{const e=JSON.parse(line.slice(6));if(e.type==='conversation')id=e.id;}catch{}}}
assert.equal((await fetch(base+'/api/conversations/'+id,{method:'DELETE',headers:{Origin:'https://example.com'}})).status,403);
assert.equal((await fetch(base+'/api/conversations/'+id)).status,200);
assert.equal((await fetch(base+'/api/conversations/'+id,{method:'DELETE'})).status,200);
while(!(await reader.read()).done){}
assert.equal((await fetch(base+'/api/conversations/'+id)).status,404);
assert.equal((await fetch(base+'/api/conversations/'+id,{method:'DELETE'})).status,404);
const db=new DatabaseSync('.runtime/teacher-app.sqlite',{readOnly:true});
assert.equal(db.prepare('SELECT count(*) AS n FROM messages WHERE conversation_id=?').get(id).n,0);db.close();
assert.equal((await fetch(base+'/api/conversations').then(r=>r.json())).some(c=>c.id===id),false);
assert.equal((await fetch(base+'/api/health').then(r=>r.json())).graph,true);
console.log('Passed deletion during real model generation, no late writes or orphan messages, origin check, and missing-ID responses.');
