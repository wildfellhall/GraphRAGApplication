import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionalScaffold} from './instruction.mjs';
import {planSchema} from './planner.mjs';
import {rankConcepts,buildInvestigations,profileRows} from './analysis.mjs';
import {validateGuidance,guidanceSchema,renderAnswer} from './guidance.mjs';
test('planner generation can only emit catalog IDs',()=>{
  const schema=planSchema({students:[{id:'STU_001'}],classes:[{id:'CLASS_08'}],concepts:[{id:'MATH_041'}]});
  assert.deepEqual(schema.properties.class_ids.items.enum,['CLASS_08']);
  assert.deepEqual(schema.properties.student_ids.items.enum,['STU_001']);
});
test('cohort coverage and actual incorrect answers affect retrieval priority',()=>{
  const small={concept_id:'A',completed:2,correct:2,unassisted_correct:0,mean_attempts:3};
  const broad={concept_id:'B',completed:14,correct:10,unassisted_correct:4,mean_attempts:1};
  assert.equal(rankConcepts([small,broad])[0].concept_id,'B');
});
const source={concept_id:'A',concept:'Expression equivalence',completed:2,correct:1,unassisted_correct:1};
const target={concept_id:'B',concept:'Linear equations',completed:2,correct:1,unassisted_correct:1};
const args={targets:['B'],concepts:[target],ancestors:[source],paths:[{ancestor_id:'A',target_id:'B',concept_ids:['A','B'],concepts:['Expression equivalence','Linear equations'],rationales:['Equivalent transformations preserve solutions.']}],problems:[{concept_id:'A',prompt:'Simplify 2x + x.',expected_answer:'3x'},{concept_id:'B',prompt:'Solve 2x = 6.',expected_answer:'3'}],catalog:[],learners:[]};
test('separate learners are never mistaken for a paired prerequisite difficulty',()=>{
  const result=buildInvestigations({...args,learners:[{...target,student_id:'STU_001'},{...source,student_id:'STU_002'}]})[0];
  assert.deepEqual(result.overlap_learners,[]);assert.deepEqual(result.paired_learners,[]);assert.deepEqual(result.unobserved_source_learners,['STU_001']);
});
test('paired signals are deduplicated at the learner-concept level',()=>{
  const result=buildInvestigations({...args,learners:[{...target,student_id:'STU_001'},{...source,student_id:'STU_001'}]})[0];
  assert.deepEqual(result.overlap_learners,['STU_001']);assert.match(result.interpretation,/does not establish causation/);
});
test('a self-pair never becomes a prerequisite hypothesis',()=>{
  assert.deepEqual(buildInvestigations({...args,paths:[{ancestor_id:'B',target_id:'B'}]}),[]);
});
const investigation=buildInvestigations(args)[0];
const evidence=[{id:'E1',kind:'concept',title:target.concept,data:{...target,mean_attempts:2,mean_hints:1}},{id:'E2',kind:'investigation',data:investigation}];
const guidance=()=>({summary:{text:'Use an independent explanation to separate prerequisite uncertainty from the target difficulty.',evidence_ids:['E1']},investigations:[{investigation_id:'E2',hypothesis:'Expression transformations may be making it harder to preserve equality when solving linear equations.',lesson_connection:'Use equivalent expression transformations to explain why an equation can be rewritten while preserving its solutions.'}]});
test('generated guidance must connect the diagnostic to the target',()=>{
  assert.equal(guidanceSchema(evidence).properties.investigations.minItems,1);
  assert.equal(validateGuidance(guidance(),evidence).investigations.length,1);
  const bad=guidance();delete bad.investigations[0].lesson_connection;assert.throws(()=>validateGuidance(bad,evidence));
});
test('answer contains authored diagnostic and answer key, conditional plan and checked references',()=>{
  const answer=renderAnswer(guidance(),evidence,{concept_ids:['B']});
  for(const text of ['Simplify 2x + x.','Teacher answer key: 3x','Solve 2x = 6.','If the learner struggles','Exit check','[E2]'])assert.ok(answer.includes(text),text);
});
test('a full profile includes all observed skills, not just retrieved priorities',()=>{
  const profile={id:'E3',kind:'profile',data:{rows:profileRows([source,target]),unobserved_count:46}};
  const answer=renderAnswer(guidance(),[...evidence,profile],{concept_ids:[],full_profile:true});
  assert.match(answer,/Recorded skill profile/);assert.match(answer,/46 other ontology concepts/);assert.equal(profile.data.rows.length,2);
});

test('all ontology concepts have explicit diagnostic and teaching scaffolds',()=>{
  for(let i=1;i<=48;i++){const scaffold=instructionalScaffold('MATH_'+String(i).padStart(3,'0'));assert.ok(scaffold.look_for.length>40);assert.ok(scaffold.if_struggle.length>40);}
});
test('the same generic hypothesis cannot be reused for different prerequisites',()=>{
  const second={id:'E3',kind:'investigation',data:{...investigation,source:{...source,concept:'Signed arithmetic'}}};
  const g=guidance();g.investigations.push({...g.investigations[0],investigation_id:'E3',hypothesis:g.investigations[0].hypothesis});
  assert.throws(()=>validateGuidance(g,[...evidence,second]),/repeat/);
});
