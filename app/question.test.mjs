import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {questionContract,plannerContext} from './question.mjs';
import {validatePlan} from './planner.mjs';
import {rankLearners,renderDirectResponse} from './responses.mjs';
const ontology=JSON.parse(readFileSync(new URL('../ontology.json',import.meta.url)));
const cat={students:[{id:'STU_001'},{id:'STU_019'}],classes:[{id:'CLASS_08'},{id:'CLASS_09'}],concepts:ontology.nodes};
const base={intent:'lesson_planning',metric:'overall',student_ids:[],class_ids:['CLASS_08'],concept_ids:['MATH_041']};
const history=[{role:'user',content:'What should I revisit with Grade 8 before slope?'},{role:'assistant',status:'complete',plan:base}];
test('the reported Grade 9 ranking overrides the earlier Grade 8 slope lesson',()=>{
  const p=validatePlan(base,cat,'Which learner in the Grade 9 cohort is struggling the most?',{},history);
  assert.equal(p.answer_mode,'ranking');assert.deepEqual(p.class_ids,['CLASS_09']);assert.deepEqual(p.concept_ids,[]);
  assert.equal(plannerContext('Which learner in the Grade 9 cohort is struggling the most?',{},history).reference_context,undefined);
});
test('screening before the lesson retains the cohort but requests learner names',()=>{
  const p=validatePlan(base,cat,'Are there any students who may need to review the prerequisites for slope before moving ahead with the lesson?',{},history);
  assert.equal(p.answer_mode,'screening');assert.deepEqual(p.class_ids,['CLASS_08']);assert.deepEqual(p.concept_ids,['MATH_041']);
});
test('their refers to people without forcing their previous mathematical topic',()=>{
  const p=validatePlan(base,cat,'Tell me about percentages and their prerequisites',{},history);
  assert.deepEqual(p.concept_ids,['MATH_019','MATH_020']);
  assert.equal(plannerContext('Tell me about percentages and their prerequisites',{},history).reference_context.concept_ids,undefined);
});
test('next alone does not copy the previous topic into a new question',()=>{
  const p=validatePlan(base,cat,'What should Grade 9 study next?',{},history);
  assert.deepEqual(p.class_ids,['CLASS_09']);assert.deepEqual(p.concept_ids,[]);
});
test('genuine topic follow-ups retain only the needed resolved context',()=>{
  const input=plannerContext('Why might they struggle with that?',{},history);
  assert.deepEqual(input.reference_context.concept_ids,['MATH_041']);
  assert.equal(input.recent_questions,undefined);
  assert.equal(questionContract('Who is struggling the most?').mode,'ranking');
});
test('rankings name the leader and ties before any model explanation',()=>{
  const rows=[{student_id:'A',student:'Student A',completed:10,correct:5,unassisted_correct:3,mean_attempts:1,mean_hints:1},{student_id:'B',student:'Student B',completed:10,correct:5,unassisted_correct:3,mean_attempts:1,mean_hints:1},{student_id:'C',student:'Student C',completed:10,correct:9,unassisted_correct:0,mean_attempts:3,mean_hints:4}];
  const plan={answer_mode:'ranking',metric:'overall'};
  const evidence=[{id:'E1',kind:'ranking',data:{rows:rankLearners(rows,plan),rule:'Lower final correctness first.'}}];
  const answer=renderDirectResponse({answer:'Use these observed outcomes to choose a check-in.',evidence_ids:['E1']},evidence,plan);
  assert.match(answer,/^\*\*Student A and Student B\*\* tie/);assert.doesNotMatch(answer,/A plan for the next lesson|Start with Slope/);
});
test('confidence extremes use the requested direction',()=>{
  assert.equal(validatePlan(base,cat,'Which student has the lowest confidence?',{},history).ranking_direction,'default');
  assert.equal(validatePlan(base,cat,'Which student has the highest confidence?',{},history).ranking_direction,'reverse');
});
test('a singular follow-up after a ranking refers to the identified learner',()=>{
  const h=[{role:'assistant',status:'complete',plan:{...base,answer_mode:'ranking',class_ids:['CLASS_09'],concept_ids:[]},evidence:[{kind:'ranking',data:{rows:[{student_id:'STU_019',rank_values:[.5,.2]}]}}]}];
  const p=validatePlan(base,cat,'Why is the student struggling?',{},h);
  assert.deepEqual(p.student_ids,['STU_019']);assert.deepEqual(p.class_ids,[]);assert.equal(p.answer_mode,'diagnosis');
});
