import {instructionalScaffold} from './instruction.mjs';
// These flags describe recorded outcomes, not a mastery score or a causal diagnosis.
export const needsCheck=row=>row.completed>0&&row.unassisted_correct<row.completed;
export function rankConcepts(rows){
  return [...rows].sort((a,b)=>{
    const priority=r=>2*(r.completed-r.correct)+(r.completed-r.unassisted_correct);
    return priority(b)-priority(a)||b.mean_attempts-a.mean_attempts||a.concept_id.localeCompare(b.concept_id);
  });
}
export function profileRows(rows){
  return rows.map(r=>({concept_id:r.concept_id,concept:r.concept,students:r.students,completed:r.completed,correct:r.correct,
    unassisted_correct:r.unassisted_correct,mean_attempts:r.mean_attempts,mean_hints:r.mean_hints,
    observation:r.correct<r.completed?'Incorrect final answers recorded':r.unassisted_correct<r.completed?'Correct final answers; hints or repeat attempts recorded':'Correct on first attempts without hints in this sample'}));
}
export function selectAncestors(rows){
  const ranked=[...rows].sort((a,b)=>{
    const score=r=>(r.completed?3:0)+(r.depth===1?2:0)+Math.min(r.supports.length,3)+(r.completed?(r.completed-r.correct)/r.completed:0);
    return score(b)-score(a)||a.depth-b.depth||a.concept_id.localeCompare(b.concept_id);
  });
  const direct=ranked.filter(r=>r.depth===1).slice(0,3);
  return [...direct,...ranked.filter(r=>!direct.includes(r))].slice(0,6);
}
export function buildInvestigations({targets,concepts,ancestors,paths,learners,problems,catalog}){
  const candidates=[];
  for(const path of paths){
    const source=ancestors.find(r=>r.concept_id===path.ancestor_id);
    if(!source||path.ancestor_id===path.target_id)continue;
    const target=concepts.find(r=>r.concept_id===path.target_id)||{concept_id:path.target_id,concept:catalog.find(c=>c.id===path.target_id)?.name,completed:0,correct:0,unassisted_correct:0};
    const observedTarget=learners.filter(r=>r.concept_id===target.concept_id);
    const targetFlags=observedTarget.filter(needsCheck);
    const sourceByStudent=new Map(learners.filter(r=>r.concept_id===source.concept_id).map(r=>[r.student_id,r]));
    const paired=targetFlags.filter(r=>sourceByStudent.has(r.student_id));
    const overlap=paired.filter(r=>needsCheck(sourceByStudent.get(r.student_id)));
    const diagnostic=problems.find(p=>p.concept_id===source.concept_id);
    const transfer=problems.find(p=>p.concept_id===target.concept_id);
    if(!diagnostic||!transfer)continue;
    const summary=r=>({concept_id:r.concept_id,concept:r.concept,completed:r.completed,correct:r.correct,unassisted_correct:r.unassisted_correct,mean_attempts:r.mean_attempts,mean_hints:r.mean_hints});
    candidates.push({source:summary(source),target:summary(target),path,
      source_definition:catalog.find(c=>c.id===source.concept_id)?.definition,
      target_definition:catalog.find(c=>c.id===target.concept_id)?.definition,
      target_learners_observed:observedTarget.length,target_learners_to_check:targetFlags.map(r=>r.student_id),
      paired_learners:paired.map(r=>r.student_id),overlap_learners:overlap.map(r=>r.student_id),
      unobserved_source_learners:targetFlags.filter(r=>!sourceByStudent.has(r.student_id)).map(r=>r.student_id),
      interpretation:overlap.length?'The same learners have incorrect final answers or supported/repeated correct work on both concepts. This co-occurrence does not establish causation.':source.completed?'Prerequisite practice exists, but these records do not show the same flagged learners on both concepts. Treat the connection as a diagnostic possibility only.':'No prerequisite observations in this scope. This is a diagnostic possibility, not an observed prerequisite difficulty.',
      diagnostic,transfer,
      instructional_scaffold:instructionalScaffold(source.concept_id),
      target_scaffold:instructionalScaffold(target.concept_id),
      priority:overlap.length*4+(path.concept_ids.length===2?3:0)+(source.completed?1:0)
    });
  }
  candidates.sort((a,b)=>b.priority-a.priority||a.path.concept_ids.length-b.path.concept_ids.length||a.source.concept_id.localeCompare(b.source.concept_id));
  const selected=[];
  for(const targetId of targets){const best=candidates.find(c=>c.target.concept_id===targetId);if(best)selected.push(best);if(selected.length===2)break;}
  for(const c of candidates){if(selected.length===2)break;if(!selected.includes(c)&&!selected.some(s=>s.source.concept_id===c.source.concept_id))selected.push(c);}
  return selected.map(({priority,...c})=>c);
}
