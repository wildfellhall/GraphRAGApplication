CREATE CONSTRAINT concept_id_unique IF NOT EXISTS FOR (n:Concept) REQUIRE n.concept_id IS UNIQUE;
CREATE CONSTRAINT student_id_unique IF NOT EXISTS FOR (n:Student) REQUIRE n.student_id IS UNIQUE;
CREATE CONSTRAINT problem_id_unique IF NOT EXISTS FOR (n:Problem) REQUIRE n.problem_id IS UNIQUE;
CREATE CONSTRAINT completion_id_unique IF NOT EXISTS FOR (n:Completion) REQUIRE n.completion_id IS UNIQUE;
CREATE CONSTRAINT dataset_id_unique IF NOT EXISTS FOR (n:Dataset) REQUIRE n.dataset_id IS UNIQUE;
CREATE CONSTRAINT completion_student_sequence IF NOT EXISTS FOR (n:Completion) REQUIRE (n.student_id, n.sequence_no) IS UNIQUE;
CREATE INDEX completion_outcome IF NOT EXISTS FOR (n:Completion) ON (n.final_is_correct);
