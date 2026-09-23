export const responseSystem=`Answer the teacher's CURRENT question using the supplied evidence and requested answer mode. Do not answer an earlier question. Do not give a lesson plan unless asked for one. Return the requested short cited response. A ranking must discuss the ranked learners; a comparison must compare the requested groups; a screening must identify who has relevant recorded prerequisite signals. The application renders exact numbers and the direct result from Neo4j, so do not invent or recalculate numbers, invent learners, or make mastery or causal claims. Explain the significance or limits in one or two complete sentences, with evidence IDs. Do not name students or choose a winner in this prose: the application already renders the exact names and comparison result. For ranking, explain the selected result using its comparison rule, without changing that rule. Missing practice means unobserved. Supported correctness is different from an incorrect final response. Avoid generic advice to check prerequisites when the question asks for a ranking or factual status.`;
export function responseSchema(evidence){return {type:'object',properties:{answer:{type:'string'},evidence_ids:{type:'array',items:{type:'string',enum:evidence.map(e=>e.id)},minItems:1,maxItems:3}},required:['answer','evidence_ids'],additionalProperties:false};}
export function validateResponse(value,evidence){
  if(!value||typeof value.answer!=='string'||value.answer.length<40||value.answer.length>1500||!Array.isArray(value.evidence_ids)||!value.evidence_ids.length||value.evidence_ids.some(id=>!evidence.some(e=>e.id===id)))throw Error('The response needs a concise answer and valid evidence references');
  if(/\b(?:synthetic\s+)?student\s*\d+\b|\bSTU_\d+\b/i.test(value.answer))throw Error('Do not name or rank students in the explanation; the application renders the verified result. Explain the supplied result in a complete sentence.');
  if(/has mastered|proven gap|is caused by|the root cause is/i.test(value.answer))throw Error('The response overstates what the records establish');
  return value;
}
export function rankLearners(rows,plan){
  const metric=plan.metric||'overall',reverse=plan.ranking_direction==='reverse'?-1:1;
  const vector=r=>{
    if(metric==='time')return [-r.mean_seconds];
    if(['confidence','determination'].includes(metric))return [r[metric]];
    if(['confusion','frustration'].includes(metric))return [-r[metric]];
    if(metric==='accuracy')return [r.correct/r.completed];
    if(metric==='independence')return [r.unassisted_correct/r.completed];
    return [r.correct/r.completed,r.unassisted_correct/r.completed,-r.mean_attempts,-r.mean_hints];
  };
  return rows.filter(r=>r.completed>0).map(r=>({...r,rank_values:vector(r)})).sort((a,b)=>{
    for(let i=0;i<a.rank_values.length;i++){const delta=reverse*(a.rank_values[i]-b.rank_values[i]);if(delta)return delta;}
    return a.student_id.localeCompare(b.student_id);
  });
}
export function screeningRows(ancestors,learners,targets){
  const byStudent=new Map();
  for(const r of learners){
    if(targets.includes(r.concept_id)||!ancestors.some(a=>a.concept_id===r.concept_id)||r.unassisted_correct===r.completed)continue;
    let s=byStudent.get(r.student_id);if(!s){s={student_id:r.student_id,student:r.student,prerequisites:[],incorrect:0,supported:0};byStudent.set(r.student_id,s);}
    s.prerequisites.push({concept_id:r.concept_id,concept:ancestors.find(a=>a.concept_id===r.concept_id).concept,completed:r.completed,correct:r.correct,unassisted_correct:r.unassisted_correct});
    s.incorrect+=r.completed-r.correct;s.supported+=r.correct-r.unassisted_correct;
  }
  return [...byStudent.values()].sort((a,b)=>b.incorrect-a.incorrect||b.supported-a.supported||a.student_id.localeCompare(b.student_id));
}
const cite=e=>'['+e.id+']';
const facts=e=>e.data.completed===0?`**${e.title}:** no completed problems were recorded in this scope; this is unobserved, not a demonstrated gap. ${cite(e)}`:`**${e.title}:** ${e.data.correct}/${e.data.completed} final correct; ${e.data.unassisted_correct}/${e.data.completed} correct on the first attempt without hints. Mean attempts ${e.data.mean_attempts}, hints ${e.data.mean_hints}. ${cite(e)}`;
export function renderDirectResponse(value,evidence,plan){
  const explanation=`${value.answer} ${value.evidence_ids.map(id=>'['+id+']').join(' ')}`;
  if(plan.answer_mode==='ranking'){
    const e=evidence.find(e=>e.kind==='ranking'),d=e.data;
    if(!d.rows.length)return 'No matching completed problems were found for this scope. '+cite(e);
    const metric=plan.metric,leader=d.rows[0],tied=d.rows.filter(r=>JSON.stringify(r.rank_values)===JSON.stringify(leader.rank_values));
    const direction=plan.ranking_direction==='reverse';
    const label=metric==='time'?(direction?'lowest mean completion time':'highest mean completion time'):['confidence','determination'].includes(metric)?`${direction?'highest':'lowest'} mean ${metric}`:['confusion','frustration'].includes(metric)?`${direction?'lowest':'highest'} mean ${metric}`:metric==='accuracy'?`${direction?'highest':'lowest'} final correctness`:metric==='independence'?`${direction?'highest':'lowest'} independent correctness`:direction?'strongest recorded outcomes under this comparison rule':'highest priority for a check-in under this comparison rule';
    const intro=`**${tied.map(r=>r.student).join(' and ')}** ${tied.length>1?'tie for':'has'} the ${label}. ${cite(e)}`;
    const table=`| Student | Final incorrect | Final correct | Independent correct | Mean attempts | Mean hints | ${metric==='time'?'Mean seconds':['confidence','confusion','determination','frustration'].includes(metric)?'Mean '+metric:'Recorded problems'} |\n|---|---|---|---|---|---|---|\n${d.rows.slice(0,10).map(r=>`| ${r.student} | ${r.completed-r.correct} | ${r.correct}/${r.completed} | ${r.unassisted_correct}/${r.completed} | ${r.mean_attempts} | ${r.mean_hints} | ${metric==='time'?r.mean_seconds:['confidence','confusion','determination','frustration'].includes(metric)?r[metric]:r.completed} |`).join('\n')}`;
    return `${intro}\n\n${d.rule} This compares recorded outcomes, not an overall measure of student ability. ${cite(e)}\n\n${table}\n\n${explanation}`;
  }
  if(plan.answer_mode==='screening'){
    const e=evidence.find(e=>e.kind==='screening'),d=e.data;
    const rows=d.rows;
    const intro=rows.length?`**${rows.map(r=>r.student).join(', ')}** have recorded prerequisite work worth checking before moving ahead.`:'No flagged prerequisite records were found in the selected scope. Missing observations still need a diagnostic check.';
    return `${intro} ${cite(e)}\n\n${rows.map(r=>`- **${r.student}:** ${r.prerequisites.map(p=>`${p.concept} (${p.correct}/${p.completed} final correct; ${p.unassisted_correct}/${p.completed} independent)`).join('; ')}. ${cite(e)}`).join('\n')}\n\nThis screening covers ${d.concepts_checked} selected upstream concepts. It flags incorrect final answers or supported/repeated correct work, not proven knowledge gaps. ${cite(e)}\n\n${explanation}`;
  }
  const kind=plan.answer_mode==='comparison'?(plan.student_ids.length?'student':'class'):plan.concept_ids.length?'concept':plan.student_ids.length?'student':'class';
  let selected=evidence.filter(e=>e.kind===kind);if(!selected.length)selected=evidence.filter(e=>e.kind==='overview');
  return `${selected.slice(0,6).map(e=>'- '+facts(e)).join('\n')}\n\n${explanation}`;
}
