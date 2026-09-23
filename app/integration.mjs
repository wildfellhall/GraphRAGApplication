import assert from 'node:assert/strict';
import {query,CYPHER,driver} from './graph.mjs';
import {retrievalQuery} from './retrieval.mjs';
import {buildInvestigations,selectAncestors} from './analysis.mjs';
const root=process.env.APP_URL||'http://127.0.0.1:4310';
try{
  const all={studentIds:[],classIds:[],conceptIds:[]};
  const grade={...all,classIds:['CLASS_08']};
  const scope={...all,studentIds:['STU_001'],conceptIds:['MATH_034']};
  const [overview]=await query(CYPHER.overview,grade);
  assert.equal(overview.students,7);assert.equal(overview.completed,210);
  const students=await query(CYPHER.students,scope);
  assert.equal(students.length,1);assert.equal(students[0].completed,2);assert.equal(students[0].student_id,'STU_001');
  const upstream=await query(CYPHER.prerequisites,{...scope,targetIds:['MATH_034']});
  assert.equal(new Set(upstream.map(c=>c.concept_id)).size,upstream.length);
  assert.ok(upstream.length>10);assert.ok(upstream.every(c=>c.completed<=2));
  assert.ok(upstream.some(c=>c.completed===0&&c.mean_attempts===null));
  const paths=await query(CYPHER.paths,{ancestorIds:['MATH_030','MATH_034'],targetIds:['MATH_034','MATH_041']});
  assert.ok(paths.length>0);assert.ok(paths.every(p=>p.ancestor_id!==p.target_id));
  const cohortConcepts=await query(CYPHER.concepts,{...grade,conceptIds:['MATH_041']});
  const ancestors=selectAncestors(await query(CYPHER.prerequisites,{...grade,targetIds:['MATH_041']}));
  const evidenceConceptIds=['MATH_041',...ancestors.map(c=>c.concept_id)];
  const cohortPaths=await query(CYPHER.paths,{ancestorIds:ancestors.map(c=>c.concept_id),targetIds:['MATH_041']});
  const learners=await query(CYPHER.learnerConcepts,{...grade,evidenceConceptIds});
  assert.equal(new Set(learners.map(r=>r.student_id+':'+r.concept_id)).size,learners.length);
  const roster=new Set((await query(CYPHER.students,grade)).map(r=>r.student_id));
  assert.ok(learners.every(r=>roster.has(r.student_id)));
  const problems=await query(CYPHER.diagnosticProblems,{evidenceConceptIds});
  const investigations=buildInvestigations({targets:['MATH_041'],concepts:cohortConcepts,ancestors,paths:cohortPaths,learners,problems,catalog:[]});
  assert.equal(investigations.length,2);
  for(const investigation of investigations){
    assert.ok(investigation.diagnostic.problem_id);assert.ok(investigation.transfer.problem_id);
    for(const id of investigation.overlap_learners){
      for(const conceptId of [investigation.source.concept_id,investigation.target.concept_id]){
        const record=learners.find(r=>r.student_id===id&&r.concept_id===conceptId);
        assert.ok(record&&record.unassisted_correct<record.completed);
      }
    }
  }
  for(const [metric,field,direction] of [['time','mean_seconds',-1],['confidence','confidence',1],['confusion','confusion',-1],['frustration','frustration',-1],['determination','determination',1]]){
    const rows=await query(retrievalQuery('students',metric),all);
    assert.equal(rows.length,20);
    for(let i=1;i<rows.length;i++)assert.ok(direction*(rows[i][field]-rows[i-1][field])>=0,metric+' ordering');
  }
  assert.equal((await query(CYPHER.classes,all)).length,3);
  const bootstrap=await fetch(root+'/api/bootstrap').then(r=>r.json());
  assert.equal(bootstrap.students.length,20);assert.equal(bootstrap.stats.completed,600);
  for(const body of [{question:''},{question:'Hi',scope:{studentId:42}},{question:'Hi',scope:[]}]){
    const response=await fetch(root+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,400);
  }
  assert.equal((await fetch(root+'/api/conversations/not-a-conversation')).status,404);
  assert.equal((await fetch(root+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify({question:'Hi'})})).status,403);
  console.log('Passed live scope, self-path regression, paired learner evidence, authored diagnostics, deduplication, missing observations, time/affect ordering, cohorts, bootstrap, and API validation checks.');
}finally{await driver.close();}
