export const queries={
  overview:`MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY label`,
  student:`MATCH (s:Student {student_id:$student})-[:COMPLETED]->(r:Completion)-[:OF_PROBLEM]->(p:Problem)-[:ASSESSES]->(c:Concept)
    RETURN s.student_id AS student_id,c.concept_id AS concept_id,c.concept_name AS concept,
      count(r) AS completed,sum(CASE WHEN r.final_is_correct THEN 1 ELSE 0 END) AS correct,
      avg(r.attempt_count) AS mean_attempts,avg(r.hints_used) AS mean_hints,
      avg(r.time_taken_seconds) AS mean_seconds,avg(r.confidence) AS confidence,
      avg(r.confusion) AS confusion,avg(r.determination) AS determination,avg(r.frustration) AS frustration
    ORDER BY concept_id`,
  upstream:`MATCH (target:Concept {concept_id:$concept})
    MATCH (upstream:Concept)-[:PREREQUISITE_OF*1..]->(target)
    WITH DISTINCT upstream
    OPTIONAL MATCH (:Student {student_id:$student})-[:COMPLETED]->(r:Completion)-[:OF_PROBLEM]->(:Problem)-[:ASSESSES]->(upstream)
    RETURN upstream.concept_id AS concept_id,upstream.concept_name AS concept,
      count(r) AS observed_problems,
      CASE WHEN count(r)=0 THEN null ELSE sum(CASE WHEN r.final_is_correct THEN 1 ELSE 0 END) END AS correct,
      avg(r.attempt_count) AS mean_attempts,avg(r.hints_used) AS mean_hints,
      avg(r.time_taken_seconds) AS mean_seconds,avg(r.confidence) AS confidence,
      avg(r.confusion) AS confusion,avg(r.determination) AS determination,avg(r.frustration) AS frustration
    ORDER BY observed_problems DESC,concept_id`,
  'shared-foundations':`MATCH (target:Concept) WHERE target.concept_id IN $concepts
    MATCH (upstream:Concept)-[:PREREQUISITE_OF*1..]->(target)
    WITH upstream,collect(DISTINCT target.concept_id) AS supported_targets
    WHERE size(supported_targets)>1
    OPTIONAL MATCH (:Student {student_id:$student})-[:COMPLETED]->(r:Completion)-[:OF_PROBLEM]->(:Problem)-[:ASSESSES]->(upstream)
    RETURN upstream.concept_id AS concept_id,upstream.concept_name AS concept,supported_targets,
      size(supported_targets) AS shared_target_count,count(r) AS observed_problems,
      CASE WHEN count(r)=0 THEN null ELSE sum(CASE WHEN r.final_is_correct THEN 1 ELSE 0 END) END AS correct,
      avg(r.attempt_count) AS mean_attempts,avg(r.confusion) AS mean_confusion
    ORDER BY shared_target_count DESC,concept_id`
};
