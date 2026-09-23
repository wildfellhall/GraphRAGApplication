import neo4j from 'neo4j-driver';
import {config} from './config.mjs';

export const driver=neo4j.driver(config.neo4jUri,neo4j.auth.basic(config.neo4jUser,config.neo4jPassword),{connectionTimeout:7000,maxTransactionRetryTime:5000});
const plain=value=>neo4j.isInt(value)?value.toNumber():Array.isArray(value)?value.map(plain):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)])):value;
export async function query(cypher,params={}){
  const session=driver.session({database:config.neo4jDatabase,defaultAccessMode:neo4j.session.READ});
  try{const result=await session.executeRead(tx=>tx.run(cypher,params),{timeout:15000});return result.records.map(r=>plain(r.toObject()));}finally{await session.close();}
}
export async function seedClasses(){
  const session=driver.session({database:config.neo4jDatabase});
  try{
    await session.run('CREATE CONSTRAINT class_id_unique IF NOT EXISTS FOR (c:Class) REQUIRE c.class_id IS UNIQUE');
    await session.executeWrite(tx=>tx.run(`MATCH (s:Student) WHERE s.is_synthetic=true AND s.grade_level IN [7,8,9]
      WITH s,'CLASS_0'+toString(s.grade_level) AS id
      MERGE (c:Class {class_id:id})
      SET c.name='Grade '+toString(s.grade_level)+' cohort',c.grade_level=s.grade_level,
          c.is_synthetic=true,c.grouping_rule='synthetic grade-based cohort'
      MERGE (s)-[:ENROLLED_IN]->(c)`));
  }finally{await session.close();}
}
export async function catalog(){
  const [students,concepts,classes]=await Promise.all([
    query(`MATCH (s:Student) OPTIONAL MATCH (s)-[:ENROLLED_IN]->(cl:Class)
      RETURN s.student_id AS id,s.display_name AS name,s.grade_level AS grade,collect(cl.class_id) AS class_ids ORDER BY id`),
    query(`MATCH (c:Concept) RETURN c.concept_id AS id,c.concept_name AS name,c.short_definition AS definition,c.category AS category ORDER BY id`),
    query(`MATCH (c:Class)<-[:ENROLLED_IN]-(s:Student) RETURN c.class_id AS id,c.name AS name,c.grade_level AS grade,count(s) AS students ORDER BY grade`)
  ]);return {students,concepts,classes};
}
const scope=`MATCH (s:Student)
  WHERE (size($studentIds)=0 OR s.student_id IN $studentIds)
    AND (size($classIds)=0 OR EXISTS {MATCH (s)-[:ENROLLED_IN]->(cl:Class) WHERE cl.class_id IN $classIds})`;
const observations=`MATCH (s)-[:COMPLETED]->(r:Completion)-[:OF_PROBLEM]->(p:Problem)-[:ASSESSES]->(c:Concept)`;
const measures=`count(r) AS completed,
  sum(CASE WHEN r.final_is_correct THEN 1 ELSE 0 END) AS correct,
  sum(CASE WHEN r.final_is_correct AND r.attempt_count=1 THEN 1 ELSE 0 END) AS first_attempt_correct,
  sum(CASE WHEN r.final_is_correct AND r.attempt_count=1 AND r.hints_used=0 THEN 1 ELSE 0 END) AS unassisted_correct,
  round(avg(r.attempt_count),2) AS mean_attempts,round(avg(r.hints_used),2) AS mean_hints,
  round(avg(r.time_taken_seconds),1) AS mean_seconds,
  round(avg(r.confidence),2) AS confidence,round(avg(r.confusion),2) AS confusion,
  round(avg(r.determination),2) AS determination,round(avg(r.frustration),2) AS frustration`;
export const CYPHER={
  overview:`${scope} ${observations} RETURN count(DISTINCT s) AS students,count(DISTINCT c) AS concepts,${measures},
    toString(min(r.started_at_utc)) AS first_record,toString(max(r.completed_at_utc)) AS last_record`,
  students:`${scope} ${observations} WHERE size($conceptIds)=0 OR c.concept_id IN $conceptIds
    RETURN s.student_id AS student_id,s.display_name AS student,s.grade_level AS grade,${measures}
    ORDER BY unassisted_correct*1.0/completed ASC,mean_attempts DESC,student_id`,
  classes:`${scope} MATCH (s)-[:ENROLLED_IN]->(cl:Class) ${observations}
    WHERE size($conceptIds)=0 OR c.concept_id IN $conceptIds
    RETURN cl.class_id AS class_id,cl.name AS class_name,count(DISTINCT s) AS students,${measures}
    ORDER BY class_id`,
  concepts:`${scope} ${observations} WHERE size($conceptIds)=0 OR c.concept_id IN $conceptIds
    RETURN c.concept_id AS concept_id,c.concept_name AS concept,count(DISTINCT s) AS students,${measures}
    ORDER BY unassisted_correct*1.0/completed ASC,mean_attempts DESC,concept_id`,
  prerequisites:`MATCH (target:Concept) WHERE target.concept_id IN $targetIds
    MATCH path=(u:Concept)-[:PREREQUISITE_OF*1..]->(target)
    WITH u,collect(DISTINCT target.concept_id) AS supports,min(length(path)) AS depth
    OPTIONAL MATCH (s:Student)-[:COMPLETED]->(r:Completion)-[:OF_PROBLEM]->(:Problem)-[:ASSESSES]->(u)
    WHERE (size($studentIds)=0 OR s.student_id IN $studentIds)
      AND (size($classIds)=0 OR EXISTS {MATCH (s)-[:ENROLLED_IN]->(cl:Class) WHERE cl.class_id IN $classIds})
    RETURN u.concept_id AS concept_id,u.concept_name AS concept,supports,depth,${measures}
    ORDER BY size(supports) DESC,completed DESC,mean_attempts DESC,concept_id`,
  paths:`MATCH (u:Concept),(t:Concept) WHERE u.concept_id IN $ancestorIds AND t.concept_id IN $targetIds AND u <> t
    MATCH path=shortestPath((u)-[:PREREQUISITE_OF*1..]->(t))
    RETURN u.concept_id AS ancestor_id,t.concept_id AS target_id,
      [n IN nodes(path)|n.concept_id] AS concept_ids,[n IN nodes(path)|n.concept_name] AS concepts,
      [r IN relationships(path)|r.rationale] AS rationales
    ORDER BY length(path),ancestor_id,target_id`,
  learnerConcepts:`${scope} ${observations} WHERE c.concept_id IN $evidenceConceptIds
    RETURN s.student_id AS student_id,s.display_name AS student,c.concept_id AS concept_id,${measures}
    ORDER BY student_id,concept_id`,
  diagnosticProblems:`MATCH (p:Problem)-[:ASSESSES]->(c:Concept) WHERE c.concept_id IN $evidenceConceptIds
    RETURN c.concept_id AS concept_id,c.concept_name AS concept,p.problem_id AS problem_id,
      p.prompt AS prompt,p.correct_answer AS expected_answer ORDER BY concept_id,problem_id`,
  examples:`${scope} ${observations} WHERE c.concept_id IN $evidenceConceptIds
    RETURN r.completion_id AS completion_id,s.student_id AS student_id,c.concept_id AS concept_id,c.concept_name AS concept,
      p.prompt AS problem,r.final_response AS response,p.correct_answer AS expected_answer,r.final_is_correct AS correct,
      r.attempt_count AS attempts,r.hints_used AS hints,r.time_taken_seconds AS seconds,
      r.confidence AS confidence,r.confusion AS confusion,r.determination AS determination,r.frustration AS frustration,
      toString(r.completed_at_utc) AS completed_at
    ORDER BY correct ASC,attempts DESC,hints DESC,completion_id LIMIT 8`,
  roster:`MATCH (s:Student)-[:ENROLLED_IN]->(cl:Class) ${observations}
    RETURN s.student_id AS student_id,s.display_name AS name,cl.class_id AS class_id,cl.name AS class_name,s.grade_level AS grade,${measures}
    ORDER BY student_id`
};
export async function bootstrap(){
  const [cat,stats,roster]=await Promise.all([catalog(),query(CYPHER.overview,{studentIds:[],classIds:[]}),query(CYPHER.roster)]);
  return {...cat,stats:stats[0],roster};
}
