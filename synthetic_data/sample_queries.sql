-- 1. Inspect the requested fields for one fictional student.
SELECT student_id, concept_id, concept_name, problem_id, prompt,
       attempt_count, hints_used, final_is_correct, time_taken_seconds,
       confidence, confusion, determination, frustration
FROM completion_details
WHERE student_id = 'STU_001'
ORDER BY sequence_no;

-- 2. Summarize completed work by student and concept.
SELECT *
FROM student_concept_summary
WHERE student_id = 'STU_001'
ORDER BY concept_id;

-- 3. Retrieve observed upstream records for a selected algebra concept.
-- Change the student and concept IDs to explore other examples.
-- NULL statistics mean no observations; they are not zero scores.
WITH RECURSIVE upstream(concept_id) AS (
    SELECT source_concept_id
    FROM prerequisite_edges
    WHERE target_concept_id = 'MATH_034'
    UNION
    SELECT e.source_concept_id
    FROM prerequisite_edges e
    JOIN upstream u ON e.target_concept_id = u.concept_id
)
SELECT c.concept_id, c.concept_name,
       CASE WHEN s.student_id IS NULL THEN 'unobserved' ELSE 'observed' END AS observation_status,
       s.problems_completed, s.problems_correct, s.final_accuracy,
       s.mean_attempts, s.mean_hints, s.mean_time_seconds,
       s.mean_confidence, s.mean_confusion, s.mean_determination, s.mean_frustration
FROM upstream u
JOIN concepts c USING (concept_id)
LEFT JOIN student_concept_summary s
    ON s.concept_id = c.concept_id AND s.student_id = 'STU_001'
ORDER BY c.concept_id;

-- 4. Compare cohort activity counts and response outcomes.
SELECT student_id, display_name, grade_level,
       COUNT(*) AS completed_problems,
       COUNT(DISTINCT concept_id) AS observed_concepts,
       SUM(final_is_correct) AS correct_final_responses,
       ROUND(AVG(attempt_count), 2) AS mean_attempts,
       ROUND(AVG(hints_used), 2) AS mean_hints,
       ROUND(AVG(time_taken_seconds), 1) AS mean_time_seconds
FROM completion_details
GROUP BY student_id, display_name, grade_level
ORDER BY student_id;
