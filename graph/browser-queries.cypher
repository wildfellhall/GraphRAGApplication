// Ontology graph: arrows run from prerequisite to dependent concept.
MATCH path=(a:Concept)-[:PREREQUISITE_OF]->(b:Concept)
RETURN path;

// A student's activity graph. Change the ID to inspect another student.
MATCH path=(s:Student {student_id:'STU_001'})-[:COMPLETED]->(r:Completion)-[:OF_PROBLEM]->(p:Problem)-[:ASSESSES]->(c:Concept)
RETURN path;

// Immediate foundations of linear equations; return paths for graph rendering.
MATCH path=(a:Concept)-[:PREREQUISITE_OF]->(b:Concept {concept_id:'MATH_034'})
RETURN path;

// All upstream foundations of slope, deduplicated to avoid returning many paths.
MATCH (a:Concept)-[:PREREQUISITE_OF*1..]->(target:Concept {concept_id:'MATH_041'})
WITH collect(DISTINCT a)+collect(DISTINCT target) AS nodes
UNWIND nodes AS a
MATCH path=(a)-[:PREREQUISITE_OF]->(b)
WHERE b IN nodes
RETURN DISTINCT path;

// Problem-level observations, including all four separate affect ratings.
MATCH (:Student {student_id:'STU_016'})-[:COMPLETED]->(r:Completion)-[:OF_PROBLEM]->(p:Problem)-[:ASSESSES]->(c:Concept)
RETURN c.concept_id,c.concept_name,p.prompt,r.attempt_count,r.hints_used,
       r.final_is_correct,r.time_taken_seconds,r.confidence,r.confusion,
       r.determination,r.frustration
ORDER BY r.sequence_no;
