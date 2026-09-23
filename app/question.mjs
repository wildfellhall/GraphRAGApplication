// Decide what the CURRENT question requests separately from whom it refers to.
export function questionContract(question){
  const q=question.toLowerCase();
  const ranking=/\bwho\b[\s\S]*\b(most|least|highest|lowest|longest|slowest|fastest|best|worst)\b|\b(who|which|what)\b[\s\S]*\b(student|students|learner|learners)\b[\s\S]*\b(most|least|highest|lowest|longest|slowest|fastest|best|worst|top|bottom)\b|\b(rank|ranking)\b/.test(q);
  const screening=/\b(who|which (?:students|learners)|any (?:students|learners))\b/.test(q)&&/\b(prerequisites?|review|revisit|ready|readiness)\b/.test(q);
  const profile=/\b(full|complete|comprehensive)\s+(?:student\s+)?profile\b|\ball\s+(?:of\s+)?(?:the\s+|their\s+)?(?:skills|difficulties|struggles)\b|\bwhich skills\b/.test(q);
  const comparison=/\b(compare|comparison|versus|vs\.?|differences? between)\b/.test(q);
  const lesson=/\b(plan|planning|teach|teaching|reteach|revisit|intervention|address|resolve)\b/.test(q);
  const diagnosis=/\b(why|causes?|originate|prerequisites?|explain (?:the|these|those) difficulties)\b/.test(q);
  const mode=ranking?'ranking':screening?'screening':profile?'profile':comparison?'comparison':lesson?'lesson':diagnosis?'diagnosis':'overview';
  // References to learners and references to a mathematical topic are independent.
  const entityReference=/\b(he|she|they|them|their|his|her|the student|the learner|the cohort|the class|same (?:student|learner|cohort|class))\b/.test(q);
  const topicReference=/\b(that|those|these|it|same (?:topic|concept|skill)|this (?:topic|concept|skill|plan|lesson|difficulty)|continue)\b|^\s*(?:and\s+)?what (?:should|can) (?:i|we) do next\b/.test(q);
  const reset=/\b(new topic|different topic|start over|across all|all (?:my |the )?(?:classes|cohorts|students|skills|concepts))\b/.test(q);
  const direction=/\b(least|lowest|fewest|fastest|best|highest (?:accuracy|confidence|determination)|most (?:confident|determined|independent))\b/.test(q)?'reverse':'default';
  return {mode,profile,entityReference,topicReference:topicReference&&!reset,reset,direction};
}
export function previousContext(history){
  const index=history.findLastIndex(m=>m.role==='assistant'&&m.status==='complete'&&m.plan);
  if(index<0)return null;
  const message=history[index],question=history.slice(0,index).findLast(m=>m.role==='user')?.content||'';
  const named=message.evidence?.filter(e=>e.kind==='student').map(e=>({id:e.data.student_id,name:e.title}))||[];
  const ranked=message.evidence?.find(e=>e.kind==='ranking')?.data.rows||[];
  const focus=ranked.length?ranked.filter(r=>JSON.stringify(r.rank_values)===JSON.stringify(ranked[0].rank_values)).map(r=>r.student_id):message.plan.student_ids;
  return {plan:message.plan,question,named_students:named,focus_student_ids:focus,targets:message.context?.target_concepts||message.plan.concept_ids};
}
export function plannerContext(question,scope,history){
  const c=questionContract(question),previous=previousContext(history);
  const explicitScope=/\b(?:grade|class|cohort|student|stu)[_ -]*\d+\b/i.test(question);
  const usePrevious=!explicitScope&&!c.reset&&previous&&(c.entityReference||c.topicReference||['screening','ranking'].includes(c.mode));
  return {question,selected_scope:scope,requested_response:c.mode,...(usePrevious?{reference_context:{student_ids:previous.plan.student_ids,class_ids:previous.plan.class_ids,...(c.topicReference?{concept_ids:previous.plan.concept_ids}:{}),named_students:previous.named_students}}:{})};
}
