import assert from 'node:assert/strict';

export const emptyState=()=>({concepts:[],prerequisite_edges:[],students:[],problems:[],completions:[]});
const keys={concepts:'concept_id',students:'student_id',problems:'problem_id',completions:'completion_id'};
const text=(v,label)=>assert.equal(typeof v,'string',`${label} must be text`);
const integer=(v,min,max,label)=>assert(Number.isInteger(v)&&v>=min&&v<=max,`${label} is out of bounds`);
const bool=(v,label)=>assert.equal(typeof v,'boolean',`${label} must be boolean`);

export function validatePayload(payload,existing=emptyState()){
  assert(payload.dataset?.dataset_id,'Dataset ID is required');
  assert.equal(payload.dataset.is_synthetic,true,'This pipeline is for synthetic records');
  const maps={};
  for(const [table,key]of Object.entries(keys)){
    assert(Array.isArray(payload[table]),`${table} must be an array`);
    const seen=new Set();maps[table]=new Map(existing[table].map(row=>[row[key],row]));
    for(const row of payload[table]){
      text(row[key],key);assert(row[key].length>0);assert(!seen.has(row[key]),`Duplicate ${key}`);seen.add(row[key]);
      const old=maps[table].get(row[key]);
      if(old){
        const immutable=table==='completions'?['student_id','problem_id','sequence_no','dataset_id']:table==='problems'?['concept_id']:[];
        for(const k of immutable){const newValue=k==='dataset_id'?payload.dataset.dataset_id:row[k];assert.equal(newValue,old[k],`Cannot reassign ${key} ${row[key]}: ${k}`);}
      }
      maps[table].set(row[key],{...row,...(table==='completions'?{dataset_id:payload.dataset.dataset_id}:{})});
    }
  }
  for(const n of payload.concepts){for(const k of ['concept_name','category','short_definition','grade_band'])text(n[k],k);}
  for(const n of payload.students){text(n.display_name,'display_name');integer(n.grade_level,5,9,'grade_level');assert.equal(n.is_synthetic,true);}
  for(const n of payload.problems){assert(maps.concepts.has(n.concept_id),'Missing problem concept');for(const k of ['prompt','correct_answer','answer_format'])text(n[k],k);integer(n.problem_variant,1,1e6,'problem_variant');}
  const edges=new Map();
  assert(Array.isArray(payload.prerequisite_edges));
  const incomingEdges=new Set();
  for(const e of payload.prerequisite_edges){const id=e.source_concept_id+'>'+e.target_concept_id;assert(!incomingEdges.has(id),'Duplicate prerequisite edge');incomingEdges.add(id);}
  for(const e of [...existing.prerequisite_edges,...payload.prerequisite_edges]){
    assert.equal(e.relationship,'PREREQUISITE_OF');
    assert(maps.concepts.has(e.source_concept_id)&&maps.concepts.has(e.target_concept_id),'Missing prerequisite concept');
    text(e.rationale,'rationale');edges.set(e.source_concept_id+'>'+e.target_concept_id,e);
  }
  const adjacency=new Map([...maps.concepts.keys()].map(k=>[k,[]]));
  for(const e of edges.values())adjacency.get(e.source_concept_id).push(e.target_concept_id);
  const done=new Set(),active=new Set();
  function visit(id){assert(!active.has(id),'Prerequisite cycle');if(done.has(id))return;active.add(id);for(const child of adjacency.get(id))visit(child);active.delete(id);done.add(id);}
  for(const id of adjacency.keys())visit(id);
  const histories=new Map();
  for(const n of maps.completions.values()){
    assert(maps.students.has(n.student_id),'Missing completion student');assert(maps.problems.has(n.problem_id),'Missing completion problem');
    integer(n.sequence_no,1,1e9,'sequence_no');integer(n.attempt_count,1,1e6,'attempt_count');integer(n.hints_used,0,1e6,'hints_used');integer(n.time_taken_seconds,1,86400,'time_taken_seconds');
    for(const k of ['confidence','confusion','determination','frustration'])integer(n[k],1,5,k);
    bool(n.final_is_correct,'final_is_correct');text(n.final_response,'final_response');
    const start=Date.parse(n.started_at_utc),end=Date.parse(n.completed_at_utc);
    assert(Number.isFinite(start)&&Number.isFinite(end),'Invalid timestamp');assert.equal((end-start)/1000,n.time_taken_seconds,'Duration mismatch');
    assert.equal(n.final_is_correct,n.final_response===maps.problems.get(n.problem_id).correct_answer,'Canonical answer mismatch');
    const history=histories.get(n.student_id)||[];history.push(n);histories.set(n.student_id,history);
  }
  for(const history of histories.values()){
    history.sort((a,b)=>a.sequence_no-b.sequence_no);
    for(let i=1;i<history.length;i++){
      assert(history[i].sequence_no>history[i-1].sequence_no,'Duplicate student sequence');
      assert(Date.parse(history[i].started_at_utc)>Date.parse(history[i-1].completed_at_utc),'Overlapping or out-of-order student activity');
    }
  }
  return {concepts:maps.concepts.size,prerequisite_edges:edges.size,students:maps.students.size,problems:maps.problems.size,completions:maps.completions.size};
}
