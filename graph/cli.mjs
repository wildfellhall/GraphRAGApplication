import neo4j from 'neo4j-driver';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validatePayload } from './validation.mjs';
import { queries } from './queries.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),command=args.shift();
const flag=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const output=value=>console.log(JSON.stringify(value,(_,v)=>neo4j.isInt(v)?v.toNumber():v,2));
const config={};
try{for(const line of (await readFile(path.join(root,'.neo4j.env'),'utf8')).split('\n')){
  if(!line.trim()||line.trim().startsWith('#'))continue;
  const split=line.indexOf('=');if(split>0)config[line.slice(0,split).trim()]=line.slice(split+1).trim();
}}catch(error){if(error.code!=='ENOENT')throw error;}
for(const key of ['NEO4J_URI','NEO4J_USERNAME','NEO4J_PASSWORD','NEO4J_DATABASE'])if(process.env[key])config[key]=process.env[key];
if(!config.NEO4J_URI||!config.NEO4J_PASSWORD)throw Error('Configure .neo4j.env or NEO4J_URI and NEO4J_PASSWORD before connecting.');
const driver=neo4j.driver(config.NEO4J_URI,neo4j.auth.basic(config.NEO4J_USERNAME||'neo4j',config.NEO4J_PASSWORD),
  {connectionTimeout:10000,maxTransactionRetryTime:15000});
const session=driver.session({database:config.NEO4J_DATABASE||'neo4j'});
function plain(properties){return Object.fromEntries(Object.entries(properties).map(([k,v])=>[k,neo4j.isInt(v)?v.toNumber():k.endsWith('_at_utc')?String(v):v]));}
function parameters(rows){return rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='number'&&Number.isInteger(v)?neo4j.int(v):v])));}
async function readState(tx){
  const state={};
  for(const [table,label]of [['concepts','Concept'],['students','Student'],['problems','Problem'],['completions','Completion'],['datasets','Dataset'],['classes','Class']]){
    const result=await tx.run(`MATCH (n:${label}) RETURN properties(n) AS row`);
    state[table]=result.records.map(r=>plain(r.get('row')));
  }
  const edges=await tx.run(`MATCH (a:Concept)-[e:PREREQUISITE_OF]->(b:Concept)
    RETURN a.concept_id AS source_concept_id,b.concept_id AS target_concept_id,type(e) AS relationship,e.rationale AS rationale`);
  state.prerequisite_edges=edges.records.map(r=>r.toObject());
  const enrolled=await tx.run('MATCH (s:Student)-[:ENROLLED_IN]->(c:Class) RETURN s.student_id AS student_id,c.class_id AS class_id');
  state.enrollment_edges=enrolled.records.map(r=>r.toObject());return state;
}
async function ensureSchema(){
  const schema=await readFile(new URL('./schema.cypher',import.meta.url),'utf8');
  for(const statement of schema.split(';').map(s=>s.trim()).filter(Boolean))await session.run(statement);
}
async function importFile(filename){
  const payload=JSON.parse(await readFile(path.resolve(filename),'utf8'));
  await ensureSchema();
  return await session.executeWrite(async tx=>{
    const state=await readState(tx);
    const expected=validatePayload(payload,state);
    await tx.run('MERGE (d:Dataset {dataset_id:$dataset.dataset_id}) SET d += $dataset',{dataset:parameters([payload.dataset])[0]});
    for(const [table,label,id]of [['concepts','Concept','concept_id'],['students','Student','student_id'],['problems','Problem','problem_id']]){
      await tx.run(`UNWIND $rows AS row MERGE (n:${label} {${id}:row.${id}}) SET n += row`,{rows:parameters(payload[table])});
    }
    const result=await tx.run(`UNWIND $rows AS row MATCH (p:Problem {problem_id:row.problem_id}),(c:Concept {concept_id:row.concept_id})
      MERGE (p)-[:ASSESSES]->(c) RETURN count(p) AS processed`,{rows:parameters(payload.problems)});
    assert.equal(result.records[0].get('processed').toNumber(),payload.problems.length);
    await tx.run(`UNWIND $rows AS row
      MATCH (a:Concept {concept_id:row.source_concept_id}),(b:Concept {concept_id:row.target_concept_id})
      MERGE (a)-[r:PREREQUISITE_OF]->(b) SET r.rationale=row.rationale`,{rows:payload.prerequisite_edges});
    const completions=payload.completions.map(c=>({...c,dataset_id:payload.dataset.dataset_id,is_synthetic:true,affect_source:'simulated_post_problem_self_report'}));
    const imported=await tx.run(`UNWIND $rows AS row
      MATCH (s:Student {student_id:row.student_id}),(p:Problem {problem_id:row.problem_id}),(d:Dataset {dataset_id:row.dataset_id})
      MERGE (r:Completion {completion_id:row.completion_id}) SET r += row
      SET r.started_at_utc=datetime(row.started_at_utc),r.completed_at_utc=datetime(row.completed_at_utc)
      MERGE (s)-[:COMPLETED]->(r) MERGE (r)-[:OF_PROBLEM]->(p) MERGE (r)-[:IN_DATASET]->(d)
      RETURN count(r) AS processed`,{rows:parameters(completions)});
    assert.equal(imported.records[0].get('processed').toNumber(),payload.completions.length,'Every completion must be linked');
    return {dataset:payload.dataset.dataset_id,imported_completions:payload.completions.length,total:expected};
  });
}
async function verify(){
  const state=await session.executeRead(readState);
  // Validate all stored records by comparing the graph with an empty update.
  const totals=validatePayload({dataset:{dataset_id:'validation',is_synthetic:true},concepts:[],prerequisite_edges:[],students:[],problems:[],completions:[]},state);
  const counts=await session.run('MATCH ()-[r]->() RETURN type(r) AS relationship,count(*) AS count ORDER BY relationship');
  const relationships=Object.fromEntries(counts.records.map(r=>[r.get('relationship'),r.get('count').toNumber()]));
  const bad=await session.run(`MATCH (r:Completion)
    WHERE size([(s:Student)-[:COMPLETED]->(r) | s])<>1
       OR size([(r)-[:OF_PROBLEM]->(p:Problem) | p])<>1
       OR size([(r)-[:IN_DATASET]->(d:Dataset) | d])<>1
    RETURN count(r) AS invalid`);
  assert.equal(bad.records[0].get('invalid').toNumber(),0,'Each completion needs exactly one student, problem, and source dataset');
  const mismatch=await session.run(`MATCH (s:Student)-[:COMPLETED]->(r:Completion)-[:OF_PROBLEM]->(p:Problem), (r)-[:IN_DATASET]->(d:Dataset)
    WHERE s.student_id<>r.student_id OR p.problem_id<>r.problem_id OR d.dataset_id<>r.dataset_id RETURN count(r) AS invalid`);
  assert.equal(mismatch.records[0].get('invalid').toNumber(),0,'Relationship identities must match record properties');
  const problemLinks=await session.run(`MATCH (p:Problem) WHERE size([(p)-[:ASSESSES]->(c:Concept) | c])<>1
    OR NOT EXISTS {MATCH (p)-[:ASSESSES]->(c:Concept) WHERE c.concept_id=p.concept_id} RETURN count(p) AS invalid`);
  assert.equal(problemLinks.records[0].get('invalid').toNumber(),0,'Each problem must assess its stated concept');
  assert.equal(relationships.PREREQUISITE_OF,totals.prerequisite_edges);
  for(const kind of ['COMPLETED','OF_PROBLEM','IN_DATASET'])assert.equal(relationships[kind],totals.completions);
  assert.equal(relationships.ASSESSES,totals.problems);
  // Confirm that importing preserved every original SQLite field and ID.
  const original=JSON.parse(await readFile(new URL('./data/base.json',import.meta.url),'utf8'));
  for(const [table,key]of [['concepts','concept_id'],['students','student_id'],['problems','problem_id'],['completions','completion_id']]){
    const stored=new Map(state[table].map(row=>[row[key],row]));
    for(const row of original[table])for(const [k,v]of Object.entries(row)){
      const actual=stored.get(row[key])?.[k];
      if(k.endsWith('_at_utc'))assert.equal(Date.parse(actual),Date.parse(v));else assert.deepEqual(actual,v,`Original record changed: ${row[key]}.${k}`);
    }
  }
  const originals=new Map(state.prerequisite_edges.map(e=>[e.source_concept_id+'>'+e.target_concept_id,e]));
  for(const e of original.prerequisite_edges)assert.deepEqual(originals.get(e.source_concept_id+'>'+e.target_concept_id),e);
  if(state.classes.length){
    const enrollment=await session.run('MATCH (s:Student) WHERE size([(s)-[:ENROLLED_IN]->(c:Class)|c])<>1 RETURN count(s) AS invalid');
    assert.equal(enrollment.records[0].get('invalid').toNumber(),0,'Every student must belong to exactly one cohort');
    assert.equal(relationships.ENROLLED_IN,state.students.length);
  }
  const report={status:'passed',totals:{...totals,datasets:state.datasets.length,classes:state.classes.length},relationships,
    nodes:state.concepts.length+state.students.length+state.problems.length+state.completions.length+state.datasets.length+state.classes.length,
    relationship_count:Object.values(relationships).reduce((a,b)=>a+b,0),original_records_preserved:true,
    acyclic_prerequisites:true,completion_links:'passed',affect_and_timing:'passed'};
  await writeFile(new URL('./verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');return report;
}
try{
  await driver.verifyConnectivity();
  if(command==='import'){
    if(!args[0])throw Error('Usage: npm run graph:import -- graph/data/base.json');
    output(await importFile(args[0]));
  }else if(command==='verify')output(await verify());
  else if(command==='query'){
    const name=args[0]||'overview';if(!queries[name])throw Error('Unknown query. Choose overview, student, upstream, or shared-foundations.');
    const result=await session.run(queries[name],{student:flag('student','STU_001'),concept:flag('concept','MATH_034'),concepts:flag('concepts','MATH_034,MATH_041').split(',')});
    output(result.records.map(r=>r.toObject()));
  }else if(command==='export'){
    const snapshot=await session.executeRead(readState);const target=path.resolve(args[0]||path.join(root,'graph/exports/graph-snapshot.json'));
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,JSON.stringify(snapshot,null,2)+'\n');output({exported:target});
  }else throw Error('Choose import, verify, query, or export.');
}catch(error){
  const message=String(error.message).replaceAll(config.NEO4J_PASSWORD,'[redacted]');console.error(message);process.exitCode=1;
}finally{await session.close();await driver.close();}
