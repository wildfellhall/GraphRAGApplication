import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePayload } from './validation.mjs';

const base=JSON.parse(readFileSync(new URL('./data/base.json',import.meta.url),'utf8'));
const expansion=JSON.parse(readFileSync(new URL('./data/cohort-02.json',import.meta.url),'utf8'));
const originalState={...base,completions:base.completions.map(c=>({...c,dataset_id:base.dataset.dataset_id}))};
test('imports the complete original fixture',()=>assert.deepEqual(validatePayload(base),{
  concepts:48,prerequisite_edges:80,students:15,problems:96,completions:450}));
test('adds a cohort without replacing original records',()=>assert.deepEqual(validatePayload(expansion,originalState),{
  concepts:48,prerequisite_edges:80,students:20,problems:96,completions:600}));
test('reimporting the original IDs is idempotent',()=>assert.equal(validatePayload(base,originalState).completions,450));
test('rejects affect outside the documented scale',()=>{
  const bad=structuredClone(base);bad.completions[0].confusion=6;assert.throws(()=>validatePayload(bad),/confusion/);
});
test('rejects a completion with an absent problem',()=>{
  const bad=structuredClone(base);bad.completions[0].problem_id='missing';assert.throws(()=>validatePayload(bad),/Missing completion problem/);
});
test('rejects cycles introduced across existing and new graph data',()=>{
  const bad=structuredClone(expansion);bad.prerequisite_edges.push({source_concept_id:'MATH_034',target_concept_id:'MATH_001',relationship:'PREREQUISITE_OF',rationale:'Invalid reverse edge'});
  assert.throws(()=>validatePayload(bad,originalState),/cycle/);
});
test('rejects changing the owner of an existing completion',()=>{
  const bad=structuredClone(base);bad.completions[0].student_id='STU_002';assert.throws(()=>validatePayload(bad,originalState),/Cannot reassign/);
});
test('rejects inconsistent duration',()=>{
  const bad=structuredClone(base);bad.completions[0].time_taken_seconds++;assert.throws(()=>validatePayload(bad),/Duration mismatch/);
});
test('rejects overlapping history even with valid individual durations',()=>{
  const bad=structuredClone(base);const a=bad.completions[0],b=bad.completions[1];
  b.started_at_utc=a.started_at_utc;b.completed_at_utc=new Date(Date.parse(b.started_at_utc)+b.time_taken_seconds*1000).toISOString();
  assert.throws(()=>validatePayload(bad),/Overlapping/);
});
test('rejects correctness flags inconsistent with the canonical answer',()=>{
  const bad=structuredClone(base);bad.completions[0].final_is_correct=!bad.completions[0].final_is_correct;assert.throws(()=>validatePayload(bad),/Canonical answer mismatch/);
});
