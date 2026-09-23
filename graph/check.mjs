import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
function run(...args){return JSON.parse(execFileSync(process.execPath,[path.join(root,'graph/cli.mjs'),...args],{cwd:root,encoding:'utf8',timeout:60000}));}
function normalized(snapshot){
  for(const [table,rows]of Object.entries(snapshot))rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return snapshot;
}
const before=run('verify');
assert.equal(before.totals.students,20);assert.equal(before.totals.completions,600);
const snapshot=path.join(root,'graph/exports/graph-snapshot.json');
run('export',snapshot);
const original=normalized(JSON.parse(await readFile(snapshot,'utf8')));
run('import','graph/data/base.json');run('import','graph/data/cohort-02.json');
const after=run('verify');assert.deepEqual(after,before,'Repeated imports must preserve counts');
run('export',snapshot);
assert.deepEqual(normalized(JSON.parse(await readFile(snapshot,'utf8'))),original,'Repeated imports must preserve all values');
const upstream=run('query','upstream','--student','STU_001','--concept','MATH_034');
assert.equal(upstream.length,27);assert(upstream.some(r=>r.observed_problems===0&&r.correct===null),'Unobserved prerequisites must remain distinguishable');
assert(upstream.every(r=>r.observed_problems<=2),'Path multiplicity must not inflate record counts');
const student=run('query','student','--student','STU_016');assert.equal(student.length,15);assert.equal(student.reduce((n,r)=>n+r.completed,0),30);
const shared=run('query','shared-foundations','--student','STU_001','--concepts','MATH_034,MATH_041,MATH_047');
assert(shared.length>0);assert(shared.every(r=>r.shared_target_count<=3&&r.observed_problems<=2));
const invalid={dataset:{dataset_id:'invalid-test-batch',is_synthetic:true},concepts:[],students:[],problems:[],completions:[],
  prerequisite_edges:[{source_concept_id:'MATH_034',target_concept_id:'MATH_001',relationship:'PREREQUISITE_OF',rationale:'Intentional invalid cycle for transaction test'}]};
await mkdir(path.join(root,'.runtime/tests'),{recursive:true});
const badFile=path.join(root,'.runtime/tests/invalid.json');await writeFile(badFile,JSON.stringify(invalid));
const bad=spawnSync(process.execPath,[path.join(root,'graph/cli.mjs'),'import',badFile],{cwd:root,encoding:'utf8',timeout:60000});
assert.equal(bad.status,1);assert.match(bad.stderr,/Prerequisite cycle/);
assert.deepEqual(run('verify'),before,'A rejected batch must not mutate the graph');
const result={...after,reimport_idempotence:'passed',invalid_batch_rollback:'passed',upstream_query:'27 distinct concepts',student_query:'30 records across 15 concepts',shared_foundations_query:'passed'};
await writeFile(path.join(root,'graph/integration-results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
