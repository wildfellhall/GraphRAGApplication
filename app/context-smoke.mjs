import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {newConversation,addMessage,listConversations,getConversation,closeStore} from './store.mjs';
import {query,CYPHER,driver} from './graph.mjs';
import {rankLearners} from './responses.mjs';
const base=process.env.APP_URL||'http://127.0.0.1:4310';
const fixture=listConversations().map(c=>getConversation(c.id)).find(c=>c.messages.some(m=>m.status==='complete'&&m.plan?.class_ids?.includes('CLASS_08')&&m.plan?.concept_ids?.includes('MATH_041')));
assert.ok(fixture,'An authentic saved Grade 8 slope answer is required');
const prior=fixture.messages.findLast(m=>m.status==='complete'&&m.plan?.class_ids?.includes('CLASS_08')&&m.plan?.concept_ids?.includes('MATH_041'));
const results=[],created=[];
async function ask(question){
  const id=newConversation('Context regression test',{});created.push(id);
  addMessage(id,'user','What should I revisit with the Grade 8 cohort before teaching slope?');
  addMessage(id,'assistant',prior.content,'complete',prior);
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,conversationId:id})});
  assert.equal(response.status,200);let buffer='',final;const reader=response.body.getReader(),decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;
    while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=block.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;
      const event=JSON.parse(line.slice(6));if(event.type==='stage')console.log(question.slice(0,35),event.stage.id,event.stage.status);if(event.type==='done')final=event.message;if(event.type==='error')throw Error(event.message);
    }
  }
  assert.ok(final);results.push({question,final});console.log(final.content);return final;
}
try{
  const ranked=await ask('Which learner in the Grade 9 cohort is struggling the most?');
  assert.equal(ranked.plan.answer_mode,'ranking');assert.deepEqual(ranked.plan.class_ids,['CLASS_09']);assert.deepEqual(ranked.plan.concept_ids,[]);
  const truth=rankLearners(await query(CYPHER.students,{studentIds:[],classIds:['CLASS_09'],conceptIds:[]}),ranked.plan);
  assert.ok(ranked.content.startsWith('**'+truth[0].student));assert.doesNotMatch(ranked.content,/A plan for the next lesson|Start with Slope/);
  const screening=await ask('Are there any students who may need to review the prerequisites for slope before moving ahead with the lesson?');
  assert.equal(screening.plan.answer_mode,'screening');assert.deepEqual(screening.plan.class_ids,['CLASS_08']);assert.deepEqual(screening.plan.concept_ids,['MATH_041']);
  assert.match(screening.content,/^\*\*Synthetic Student/);assert.doesNotMatch(screening.content,/A plan for the next lesson/);
  const screeningEvidence=screening.evidence.find(e=>e.kind==='screening');assert.ok(screeningEvidence.data.rows.length);
  await mkdir('test-results',{recursive:true});await writeFile('test-results/context-regression.json',JSON.stringify(results,null,2));
  console.log('Passed real-Qwen topic switch to Grade 9 ranking and context-preserving Grade 8 screening.');
}finally{
  for(const id of created)await fetch(base+'/api/conversations/'+id,{method:'DELETE'});
  closeStore();await driver.close();
}
