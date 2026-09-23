import {plannerContext} from './question.mjs';
import {responseSystem,responseSchema,validateResponse,rankLearners,screeningRows,renderDirectResponse} from './responses.mjs';
import {catalog,query,CYPHER} from './graph.mjs';
import {complete,countTokens,chatPrompt,modelHealth} from './model.mjs';
import {config} from './config.mjs';
import {rankConcepts,profileRows,selectAncestors,buildInvestigations} from './analysis.mjs';
import {answerSystem,validateGuidance,renderAnswer,guidanceSchema} from './guidance.mjs';

import {planSchema,validatePlan} from './planner.mjs';
export {validatePlan} from './planner.mjs';
export function checkCitations(answer,evidence){
  const known=new Set(evidence.map(e=>e.id));const references=[...new Set([...answer.matchAll(/\[(E\d+)\]/g)].map(m=>m[1]))];
  return {valid:references.length>0&&references.every(id=>known.has(id)),references,invalid:references.filter(id=>!known.has(id))};
}
export function retrievalQuery(name,metric){
  if(!['students','concepts'].includes(name))return CYPHER[name];
  const id=name==='students'?'student_id':'concept_id';
  const overall=`2*(completed-correct)+(completed-unassisted_correct) DESC,mean_attempts DESC,${id}`;
  const sorting={overall,independence:overall,time:`mean_seconds DESC, ${id}`,accuracy:`correct*1.0/completed ASC, ${id}`,confidence:`confidence ASC, ${id}`,confusion:`confusion DESC, ${id}`,determination:`determination ASC, ${id}`,frustration:`frustration DESC, ${id}`};
  return sorting[metric]?CYPHER[name].replace(/ORDER BY[\s\S]*$/,`ORDER BY ${sorting[metric]}`):CYPHER[name];
}

export async function runGraphRag({question,scope={},history=[],signal,emit=()=>{}}){
  const started=Date.now();const trace=[],evidence=[];let plan;
  const stage=(id,label,status='running',extra={})=>emit({type:'stage',stage:{id,label,status,...extra}});
  const run=async(name,params)=>{
    if(signal?.aborted)throw signal.reason;
    const cypher=retrievalQuery(name,plan?.metric);const start=Date.now(),rows=await query(cypher,params);
    trace.push({name,cypher,parameters:params,rowCount:rows.length,elapsedMs:Date.now()-start});
    emit({type:'query',query:trace.at(-1)});return rows;
  };
  stage('understand','Understanding your question');
  const health=await modelHealth();if(!health.available)throw Error('The configured local Qwen 27B model is unavailable. Start it before asking a question.');
  const cat=await catalog();
  const plannerMessages=[{role:'system',content:`Translate the teacher question into a JSON retrieval plan. Select IDs ONLY from the catalog. Do not write an answer or Cypher. Empty lists mean no filter. Use at most 4 concept IDs, ONLY for topics explicitly requested, not their prerequisites. Prerequisites are retrieved separately. Choose student_status for one student, comparison for comparing students/classes, concept_support for gaps/prerequisites, lesson_planning for lesson recommendations, otherwise overview. Choose the requested metric: overall, accuracy, independence, time, confidence, confusion, determination, or frustration. Questions about slope use MATH_041. Linear equations in one variable use MATH_034, not slope. The current question controls the requested output and mathematical topic. Reference context, if supplied, may resolve an unnamed learner/class, or a topic only when explicitly included. Do not copy its intent or invent a topic for a general ranking. Honor the selected scope unless the teacher explicitly asks about a different student/class.
Students: ${cat.students.map(s=>`${s.id}=${s.name}`).join('; ')}
Classes: ${cat.classes.map(c=>`${c.id}=${c.name}`).join('; ')}
Concepts: ${cat.concepts.map(c=>`${c.id}=${c.name}`).join('; ')}`},
    {role:'user',content:JSON.stringify(plannerContext(question,scope,history))}];
  const planned=await complete(plannerMessages,{schema:planSchema(cat),maxTokens:260,signal});
  try{plan=validatePlan(JSON.parse(planned.text),cat,question,scope,history);}catch(error){throw Error('Could not resolve this question to known graph entities. '+error.message);}
  stage('understand','Question and entities resolved','done',{elapsedMs:Date.now()-started});
  emit({type:'plan',plan});
  const params={studentIds:plan.student_ids,classIds:plan.class_ids,conceptIds:plan.concept_ids};
  stage('retrieve','Querying student and class records');
  const overview=await run('overview',params),students=await run('students',params),concepts=await run('concepts',params);
  const classes=plan.student_ids.length?[]:await run('classes',params);
  stage('retrieve','Student evidence retrieved','done',{records:overview[0]?.completed||0});
  stage('traverse','Selecting graph evidence for this question');
  const rankedConcepts=['overall','independence'].includes(plan.metric)?rankConcepts(concepts):concepts;
  const directAnswer=['ranking','screening','overview','comparison'].includes(plan.answer_mode);
  const investigate=['diagnosis','profile','lesson','screening'].includes(plan.answer_mode);
  const targets=!investigate?[]:plan.concept_ids.length?plan.concept_ids:rankedConcepts.filter(c=>c.completed>=2).slice(0,3).map(c=>c.concept_id);
  const prerequisites=targets.length?await run('prerequisites',{...params,targetIds:targets}):[];
  const selectedAncestors=selectAncestors(prerequisites);
  const paths=selectedAncestors.length?await run('paths',{ancestorIds:selectedAncestors.map(c=>c.concept_id),targetIds:targets}):[];
  const evidenceConceptIds=[...new Set([...targets,...selectedAncestors.map(c=>c.concept_id)])];
  const examples=targets.length?await run('examples',{...params,evidenceConceptIds}):[];
  const learners=targets.length?await run('learnerConcepts',{...params,evidenceConceptIds}):[];
  const problems=targets.length?await run('diagnosticProblems',{evidenceConceptIds}):[];
  const investigations=directAnswer?[]:buildInvestigations({targets,concepts,ancestors:selectedAncestors,paths,learners,problems,catalog:cat.concepts});
  stage('traverse',investigate?'Prerequisite paths retrieved':'Requested records ready','done',{concepts:prerequisites.length,paths:paths.length});
  stage('context','Assembling cited evidence');
  const add=(kind,title,data)=>evidence.push({id:`E${evidence.length+1}`,kind,title,data});
  const scopeNames=[...plan.student_ids.map(id=>cat.students.find(s=>s.id===id)?.name),...plan.class_ids.map(id=>cat.classes.find(c=>c.id===id)?.name)];
  add('overview',(scopeNames.join(', ')||'All synthetic classes')+' · all recorded concepts',{...overview[0],scope:scopeNames.length?scopeNames:['All students'],aggregation_scope:'all recorded concepts; requested concept filters apply to other evidence records',synthetic:true,affect_scale:'1–5; simulated post-problem ratings'});
  for(const c of classes)add('class',c.class_name,{...c,concept_filter:plan.concept_ids});
  if(plan.answer_mode==='ranking')add('ranking','Learner comparison in the selected scope',{
    rows:rankLearners(students,plan),rule:plan.metric==='overall'?'Comparison rule: lower final-correct proportion first, then lower first-attempt/no-hint correct proportion; further ties use greater mean attempts and hints.':`Ordered by ${plan.metric} in the requested direction.`,concept_filter:plan.concept_ids});
  if(plan.answer_mode==='screening')add('screening','Learners with recorded prerequisite signals',{
    rows:screeningRows(selectedAncestors,learners,targets),concepts_checked:selectedAncestors.length,targets});
  if(plan.full_profile)add('profile','Recorded skill profile',{rows:profileRows(rankedConcepts),unobserved_count:cat.concepts.length-concepts.length});
  for(const c of rankedConcepts.slice(0,4))add('concept',c.concept,c);
  for(const id of plan.concept_ids.filter(id=>!concepts.some(c=>c.concept_id===id))){const c=cat.concepts.find(c=>c.id===id);add('concept',c.name,{concept_id:id,concept:c.name,completed:0,correct:null,unassisted_correct:null,mean_attempts:null,mean_hints:null,observation_status:'No matching completion records in the queried scope'});}
  for(const s of students.slice(0,plan.student_ids.length?6:3))add('student',s.student,{...s,concept_filter:plan.concept_ids});
  for(const c of selectedAncestors)add('prerequisite',c.concept,c);
  for(const p of investigations.map(i=>i.path))add('path',p.concepts.join(' → '),p);
  for(const i of investigations)add('investigation',`${i.source.concept} → ${i.target.concept}`,i);
  for(const r of examples.slice(0,2))add('completion',`${r.student_id} · ${r.concept}`,r);
  const contextMetadata={scope:scopeNames.length?scopeNames:['All synthetic classes'],intent:plan.intent,metric:plan.metric,target_concepts:targets,
    retrieved_concept_rows:concepts.length,retrieved_student_rows:students.length,retrieved_ancestors:prerequisites.length,
    selection:`For broad questions, concepts and students are ordered by ${({time:'greater mean time',accuracy:'lower final correctness',confidence:'lower confidence',confusion:'greater confusion',determination:'lower determination',frustration:'greater frustration'})[plan.metric]||'more incorrect final answers and more supported or repeated completions, considering the number of observations'}. Ancestors include direct prerequisites and observed shared foundations. Investigations check whether the same learners have flagged records at both ends of the path. This is evidence selection, not a mastery score.`};
  const modelEvidence=()=>plan.answer_mode==='ranking'?evidence.filter(e=>e.kind==='ranking').map(e=>({...e,data:{...e.data,rows:e.data.rows.filter(r=>JSON.stringify(r.rank_values)===JSON.stringify(e.data.rows[0]?.rank_values)).map(({student,student_id,...r})=>r),total_compared:e.data.rows.length,selection:'These are the already computed leading or tied records under the stated comparison rule. Explain this result; do not select a different learner.'}})):plan.answer_mode==='screening'?evidence.filter(e=>e.kind==='screening').map(e=>({...e,data:{concepts_checked:e.data.concepts_checked,learners_flagged:e.data.rows.length,records:e.data.rows.flatMap(r=>r.prerequisites).map(({concept,completed,correct,unassisted_correct})=>({concept,completed,correct,unassisted_correct})),selection:'The application already lists all flagged learner names and their exact records. Explain how incorrect final answers differ from supported correct work; do not repeat the names, IDs, or counts.'}})):directAnswer?evidence.filter(e=>['overview','class','student','concept'].includes(e.kind)):evidence.some(e=>e.kind==='investigation')?evidence.filter(e=>e.kind==='investigation'):evidence;
  contextMetadata.model_evidence_ids=modelEvidence().map(e=>e.id);
  contextMetadata.generation_context=directAnswer?'Qwen comments on evidence for the current question. The application renders exact comparisons, rankings, and screening results from retrieved records.':'Qwen explains selected investigations. Other retrieved records supply the exact observed results and complete profile rendered by the application.';
  const makeMessages=()=>[{role:'system',content:directAnswer?responseSystem:answerSystem},{role:'user',content:JSON.stringify({question,answer_mode:plan.answer_mode,scope:scopeNames,evidence:modelEvidence()})}];
  let messages=makeMessages(),tokenCount=await countTokens(chatPrompt(messages));
  while(tokenCount>5800){
    const removable=evidence.findLastIndex(e=>['completion','student','prerequisite','path'].includes(e.kind));
    if(removable<0)break;
    evidence.splice(removable,1);messages=makeMessages();tokenCount=await countTokens(chatPrompt(messages));
  }
  if(tokenCount>6200)throw Error('The evidence exceeds the local model context. Narrow the question to a student or concept.');
  stage('context','Evidence assembled','done',{sources:evidence.length,tokens:tokenCount});
  emit({type:'evidence',evidence,trace,context:contextMetadata});
  stage('generate','Qwen is writing your answer');
  const supplied=modelEvidence();
  contextMetadata.model_evidence_ids=supplied.map(e=>e.id);
  const schema=directAnswer?responseSchema(supplied):guidanceSchema(evidence);
  const validate=directAnswer?value=>validateResponse(value,supplied):value=>validateGuidance(value,evidence);
  const maxTokens=directAnswer?280:950;
  let generated=await complete(messages,{maxTokens,schema,signal});
  let guidance;
  try{guidance=validate(JSON.parse(generated.text));}catch(error){
    stage('generate','Checking and revising the draft');
    generated=await complete([...messages,{role:'user',content:'Your previous output failed this check: '+error.message+'. Return corrected JSON. Answer the current question using only the supplied evidence IDs and the requested schema. Do not invent observed student work or causal certainty.'}],{maxTokens,schema,signal});
    guidance=validate(JSON.parse(generated.text));
  }
  const answer=directAnswer?renderDirectResponse(guidance,evidence,plan):renderAnswer(guidance,evidence,plan);
  stage('generate','Answer generated','done',{tokens:generated.tokens});
  stage('verify','Checking evidence references');
  const citations=checkCitations(answer,evidence);
  if(!citations.valid)throw Error('The model returned an answer without verifiable evidence references. Please retry; no unsupported answer has been saved.');
  stage('verify','Evidence references checked','done',{references:citations.references.length});
  emit({type:'token',text:answer});
  return {content:answer,evidence,trace,plan,context:contextMetadata,citations,guidance,
    meta:{model:config.model,durationMs:Date.now()-started,promptTokens:tokenCount,completionTokens:generated.tokens,truncated:!!generated.stoppedLimit,
      pipelineVersion:3,note:'Citation IDs are checked against retrieved records; semantic correctness is not automatically proven. Teaching scaffolds are authored suggestions; Qwen supplies hypotheses and lesson connections.'}};
}
