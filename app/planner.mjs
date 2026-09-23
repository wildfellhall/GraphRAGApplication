import {questionContract,previousContext} from './question.mjs';
const INTENTS=['overview','student_status','concept_support','comparison','lesson_planning'];
const METRICS=['overall','accuracy','independence','time','confidence','confusion','determination','frustration'];
export function planSchema(cat){
  const ids=(collection,maxItems)=>({type:'array',items:cat[collection].length?{type:'string',enum:cat[collection].map(x=>x.id)}:{type:'string'},maxItems:cat[collection].length?maxItems:0});
  return {type:'object',properties:{intent:{type:'string',enum:INTENTS},metric:{type:'string',enum:METRICS},student_ids:ids('students',6),class_ids:ids('classes',3),concept_ids:ids('concepts',4)},required:['intent','metric','student_ids','class_ids','concept_ids'],additionalProperties:false};
}
const normalized=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
function canonical(value,rows,kind){
  const found=rows.find(r=>normalized(r.id)===normalized(value)||(r.name&&normalized(r.name)===normalized(value)));
  if(found)return found.id;
  const match=String(value).match(kind==='classes'?/^(?:(?:class|cohort|grade)[_ -]*)?(\d+)(?:th|st|nd|rd)?(?:[_ -]*(?:grade|cohort|class))?$/i:kind==='students'?/^(?:stu|(?:synthetic\s+)?student)[_ -]*(\d+)$/i:/^math[_ -]*(\d+)$/i);
  const id=match?(kind==='classes'?'CLASS_'+match[1].padStart(2,'0'):kind==='students'?'STU_'+match[1].padStart(3,'0'):'MATH_'+match[1].padStart(3,'0')):value;
  return rows.some(r=>r.id===id)?id:value;
}
export function validatePlan(raw,cat,question,scope={},history=[]){
  if(!raw||!INTENTS.includes(raw.intent))throw Error('Qwen returned an invalid retrieval intent');
  const plan={...raw,metric:raw.metric||'overall'};
  if(!METRICS.includes(plan.metric))throw Error('Unknown analysis metric');
  for(const [key,collection]of [['student_ids','students'],['class_ids','classes'],['concept_ids','concepts']]){
    if(!Array.isArray(plan[key]))throw Error('Invalid entity list');
    plan[key]=[...new Set(plan[key].map(id=>canonical(id,cat[collection],collection)))];
  }
  const explicit=[...question.matchAll(/\b(?:STU[_ -]?|(?:synthetic\s+)?student\s+)(\d{1,3})\b/gi)].map(m=>'STU_'+m[1].padStart(3,'0'));
  for(const m of question.matchAll(/\bstudents?\s+(\d{1,3}(?:(?:\s*,\s*|\s+(?:and|&)\s*)\d{1,3})+)/gi)){
    explicit.push(...m[1].match(/\d+/g).map(n=>'STU_'+n.padStart(3,'0')));
  }
  if(explicit.some(id=>!cat.students.some(s=>s.id===id)))throw Error('That student is not in this dataset. Choose a student from the roster.');
  const grades=[...question.matchAll(/\b(?:grade|class|cohort)[_ -]*(\d{1,2})\b|\b(\d{1,2})(?:th|st|nd|rd)[ -]+grade\b/gi)].map(m=>'CLASS_'+(m[1]||m[2]).padStart(2,'0'));
  for(const m of question.matchAll(/\b(?:grades|cohorts|classes)\s+(\d{1,2}(?:(?:\s*,\s*|\s+(?:and|&)\s*)\d{1,2})*)/gi)){
    grades.push(...m[1].match(/\d+/g).map(n=>'CLASS_'+n.padStart(2,'0')));
  }
  for(const [words,id]of [['seven|seventh','CLASS_07'],['eight|eighth','CLASS_08'],['nine|ninth','CLASS_09']]){
    if(new RegExp(`\\b(?:grade (?:${words})|(?:${words})[- ]graders?|(?:${words})[- ]grade)\\b`,'i').test(question))grades.push(id);
  }
  const allClasses=/\b(?:all|every|across (?:the|my))\s+(?:(?:my|the)\s+)?(?:classes|cohorts|grades|students)\b/i.test(question);
  const contract=questionContract(question);
  const context=previousContext(history),previous=context?.plan;
  const followup=contract.entityReference||contract.topicReference;
  const inheritScope=!contract.reset&&previous&&(followup||['screening','ranking'].includes(contract.mode));
  // Resolve explicit and selected scope BEFORE validating probabilistic model IDs.
  if(explicit.length){plan.student_ids=[...new Set(explicit)];plan.class_ids=[];}
  else if(grades.length){plan.class_ids=[...new Set(grades)];plan.student_ids=[];}
  else if(allClasses){plan.student_ids=[];plan.class_ids=[];}
  else if(inheritScope){
    const referToRanked=previous.answer_mode==='ranking'&&contract.entityReference&&!/\b(class|cohort)\b/i.test(question)&&context.focus_student_ids?.length;
    plan.student_ids=referToRanked?context.focus_student_ids:previous.student_ids;plan.class_ids=referToRanked?[]:previous.class_ids;
  }
  else if(scope.studentId){plan.student_ids=[scope.studentId];plan.class_ids=[];}
  else if(scope.classId){plan.student_ids=[];plan.class_ids=[scope.classId];}
  else if((!followup||!previous)&&/\b(cohorts|classes|students)\b/i.test(question)){plan.student_ids=[];plan.class_ids=[];}
  const exactConcepts=[...question.matchAll(/\bMATH_\d{3}\b/gi)].map(m=>m[0].toUpperCase());
  const aliases=[[/\bslope\b/i,'MATH_041'],[/\blinear equations?\b/i,'MATH_034'],[/\bsystems? (?:of )?(?:linear )?equations?\b/i,'MATH_047'],[/\blinear inequalities?\b/i,'MATH_036'],[/\bproportional reasoning\b/i,'MATH_018'],[/\border of operations\b/i,'MATH_023'],[/\bequivalent fractions?\b/i,'MATH_006'],[/\bfraction (?:addition|subtraction)\b/i,'MATH_007'],[/\bfraction (?:multiplication|division)\b/i,'MATH_008'],[/\bcoordinate plane\b/i,'MATH_037']];
  let linked=aliases.filter(([pattern])=>pattern.test(question)).map(([,id])=>id);
  if(linked.includes('MATH_047')&&!/one.variable/i.test(question))linked=linked.filter(id=>id!=='MATH_034');
  // Match named concepts across the whole catalog, not only the few common aliases.
  for(const concept of cat.concepts){
    if(concept.name&&normalized(question).includes(normalized(concept.name)))linked.push(concept.id);
  }
  if(/\bpercent(?:s|ages?)?\b/i.test(question))linked.push('MATH_019','MATH_020');
  if(/\bdecimals?\b/i.test(question)&&!linked.length)linked.push('MATH_009','MATH_010','MATH_011');
  if(/\bfractions?\b/i.test(question)&&!linked.length)linked.push('MATH_005','MATH_006','MATH_007','MATH_008');
  if(/\bfunctions?\b/i.test(question)&&!linked.length)linked.push('MATH_043','MATH_044');
  const fullProfile=contract.profile;
  const scopeChanged=explicit.length||grades.length||allClasses;
  if(exactConcepts.length)plan.concept_ids=[...new Set(exactConcepts)].slice(0,4);
  else if(linked.length)plan.concept_ids=[...new Set(linked)].slice(0,4);
  else if(fullProfile||contract.reset)plan.concept_ids=[];
  else if(contract.topicReference&&previous&&!scopeChanged)plan.concept_ids=previous.concept_ids;
  // A new ranking/general overview does not inherit old topics, even if the model guessed them.
  else if(contract.mode==='ranking'||scopeChanged||/\b(overview|overall|in general)\b/i.test(question))plan.concept_ids=[];
  if(contract.mode==='lesson')plan.intent='lesson_planning';
  else if(['diagnosis','screening','profile'].includes(contract.mode))plan.intent='concept_support';
  else if(contract.mode==='comparison')plan.intent='comparison';
  else plan.intent=plan.student_ids.length===1?'student_status':'overview';
  for(const key of ['confidence','confusion','determination','frustration'])if(new RegExp('\\b'+key+'\\b','i').test(question))plan.metric=key;
  if(/\b(time taken|longest|taking longer|slowest|most time)\b/i.test(question))plan.metric='time';
  for(const [key,collection]of [['student_ids','students'],['class_ids','classes'],['concept_ids','concepts']]){
    if(plan[key].some(id=>!cat[collection].some(row=>row.id===id)))throw Error(`Unknown ${key.replace('_ids','')}. Available ${collection}: ${cat[collection].map(r=>r.name||r.id).join(', ')}.`);
  }
  let rankingDirection=contract.direction;
  if(['confidence','determination','accuracy','independence'].includes(plan.metric))rankingDirection=/\b(highest|best|most confident|most determined|most independent)\b/i.test(question)?'reverse':'default';
  return {...plan,full_profile:fullProfile,answer_mode:contract.mode,ranking_direction:rankingDirection,context_inherited:!!(inheritScope&&!scopeChanged)};
}
