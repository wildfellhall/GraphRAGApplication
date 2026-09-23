PRAGMA foreign_keys = ON;

CREATE TABLE dataset_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE concepts (
    concept_id TEXT PRIMARY KEY,
    concept_name TEXT NOT NULL,
    category TEXT NOT NULL,
    short_definition TEXT NOT NULL,
    grade_band TEXT NOT NULL
);

CREATE TABLE prerequisite_edges (
    source_concept_id TEXT NOT NULL REFERENCES concepts(concept_id),
    relationship TEXT NOT NULL CHECK (relationship = 'PREREQUISITE_OF'),
    target_concept_id TEXT NOT NULL REFERENCES concepts(concept_id),
    rationale TEXT NOT NULL,
    PRIMARY KEY (source_concept_id, target_concept_id),
    CHECK (source_concept_id <> target_concept_id)
);

CREATE TABLE students (
    student_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL UNIQUE,
    grade_level INTEGER NOT NULL CHECK (grade_level BETWEEN 7 AND 9),
    is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic = 1)
);

CREATE TABLE problems (
    problem_id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL REFERENCES concepts(concept_id),
    problem_variant INTEGER NOT NULL CHECK (problem_variant IN (1, 2)),
    prompt TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    answer_format TEXT NOT NULL,
    UNIQUE (concept_id, problem_variant)
);

CREATE TABLE problem_completions (
    completion_id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(student_id),
    problem_id TEXT NOT NULL REFERENCES problems(problem_id),
    sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
    started_at_utc TEXT NOT NULL CHECK (julianday(started_at_utc) IS NOT NULL),
    completed_at_utc TEXT NOT NULL CHECK (julianday(completed_at_utc) IS NOT NULL),
    time_taken_seconds INTEGER NOT NULL CHECK (time_taken_seconds > 0),
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
    hints_used INTEGER NOT NULL CHECK (hints_used >= 0),
    final_response TEXT NOT NULL,
    final_is_correct INTEGER NOT NULL CHECK (final_is_correct IN (0, 1)),
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5),
    confusion INTEGER NOT NULL CHECK (confusion BETWEEN 1 AND 5),
    determination INTEGER NOT NULL CHECK (determination BETWEEN 1 AND 5),
    frustration INTEGER NOT NULL CHECK (frustration BETWEEN 1 AND 5),
    UNIQUE (student_id, problem_id),
    UNIQUE (student_id, sequence_no),
    CHECK (completed_at_utc > started_at_utc),
    CHECK (ABS((julianday(completed_at_utc) - julianday(started_at_utc)) * 86400 - time_taken_seconds) < 0.01)
);

CREATE INDEX idx_problems_concept ON problems(concept_id);
CREATE INDEX idx_completion_student ON problem_completions(student_id);
CREATE INDEX idx_completion_problem ON problem_completions(problem_id);
CREATE INDEX idx_edges_target ON prerequisite_edges(target_concept_id);

CREATE VIEW completion_details AS
SELECT r.completion_id, s.student_id, s.display_name, s.grade_level,
       c.concept_id, c.concept_name, p.problem_id, p.prompt,
       p.correct_answer, p.answer_format, r.sequence_no,
       r.started_at_utc, r.completed_at_utc, r.time_taken_seconds,
       r.attempt_count, r.hints_used, r.final_response, r.final_is_correct,
       r.confidence, r.confusion, r.determination, r.frustration
FROM problem_completions r
JOIN students s USING (student_id)
JOIN problems p USING (problem_id)
JOIN concepts c USING (concept_id);

CREATE VIEW student_concept_summary AS
SELECT student_id, concept_id, concept_name,
       COUNT(*) AS problems_completed,
       SUM(final_is_correct) AS problems_correct,
       ROUND(AVG(final_is_correct), 3) AS final_accuracy,
       SUM(CASE WHEN attempt_count = 1 AND final_is_correct = 1 THEN 1 ELSE 0 END) AS first_attempt_correct,
       ROUND(AVG(attempt_count), 2) AS mean_attempts,
       ROUND(AVG(hints_used), 2) AS mean_hints,
       ROUND(AVG(time_taken_seconds), 1) AS mean_time_seconds,
       ROUND(AVG(confidence), 2) AS mean_confidence,
       ROUND(AVG(confusion), 2) AS mean_confusion,
       ROUND(AVG(determination), 2) AS mean_determination,
       ROUND(AVG(frustration), 2) AS mean_frustration
FROM completion_details
GROUP BY student_id, concept_id, concept_name;
