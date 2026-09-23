"""Build a reproducible synthetic SQLite fixture using only Python's standard library."""

import csv
import hashlib
import json
import random
import sqlite3
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SEED = 20260920
rng = random.Random(SEED)

# Each row: concept number, variant, prompt, canonical answer, plausible wrong
# answer, response format. Canonical answers are authored, not random guesses.
BANK = """1|1|What is the value of the digit 7 in 47,205?|7000|700|integer
1|2|Order 50,408; 50,480; and 50,084 from least to greatest.|50084, 50408, 50480|50408, 50084, 50480|ordered list
2|1|Calculate 4,708 + 2,596.|7304|7204|integer
2|2|Calculate 8,002 - 3,587.|4415|4515|integer
3|1|Calculate 24 times 16.|384|240|integer
3|2|Calculate 864 divided by 12.|72|62|integer
4|1|Find the greatest common factor of 18 and 24.|6|3|integer
4|2|Find the least common multiple of 6 and 8.|24|48|integer
5|1|Three identical pizzas are shared equally among four people. How much pizza does each person get?|3/4|4/3|fraction
5|2|A number line from 0 to 1 is divided into 8 equal intervals. What number is at the third mark after 0?|3/8|8/3|fraction
6|1|Simplify 18/24.|3/4|9/24|fraction
6|2|Complete the equivalent fraction: 5/6 = ?/42.|35|30|integer
7|1|Calculate 3/4 + 2/3. Give an improper fraction.|17/12|5/7|fraction
7|2|Calculate 5/6 - 1/4.|7/12|4/2|fraction
8|1|Calculate 2/3 times 3/5.|2/5|5/8|fraction
8|2|Calculate (3/4) divided by (2/5).|15/8|3/10|fraction
9|1|What is the value of the digit 7 in 4.072?|0.07|0.7|decimal
9|2|Write 6 tenths plus 3 thousandths as a decimal.|0.603|0.63|decimal
10|1|Calculate 3.75 + 0.86.|4.61|3.161|decimal
10|2|Calculate 4.2 divided by 0.6.|7|0.7|number
11|1|Write 3/8 as a decimal.|0.375|0.38|decimal
11|2|Write 0.45 as a fraction in simplest form.|9/20|45/10|fraction
12|1|Order -7; 3; -2; and 0 from least to greatest.|-7, -2, 0, 3|0, -2, 3, -7|ordered list
12|2|What is the opposite of -9?|9|-9|integer
13|1|Calculate -7 + 12.|5|-19|integer
13|2|Calculate -4 - (-9).|5|-13|integer
14|1|Calculate (-6) times (-8).|48|-48|integer
14|2|Calculate -42 divided by 7.|-6|6|integer
15|1|Calculate -3/4 + 0.5. Give a fraction.|-1/4|-5/4|fraction
15|2|Calculate (-1.2) divided by (3/5).|-2|-0.72|number
16|1|A bag contains 8 red and 12 blue counters. Write the red-to-blue ratio in simplest form.|2:3|2:5|ratio
16|2|A recipe uses 3 cups of water for 2 cups of rice. Write the water-to-rice ratio.|3:2|2:3|ratio
17|1|A car travels 150 miles in 3 hours. Find its speed in miles per hour.|50|450|number
17|2|A cyclist travels 3/4 mile in 1/6 hour. Find the speed in miles per hour.|4.5|0.125|number
18|1|Four notebooks cost $10 at a constant unit price. How much do 10 notebooks cost?|25|16|number
18|2|Solve the proportion x/15 = 4/5.|12|14|number
19|1|Write 35% as a decimal.|0.35|3.5|decimal
19|2|Write 3/5 as a percentage.|60%|35%|percentage
20|1|Find 20% of 85.|17|65|number
20|2|A price increases from $40 to $50. What is the percent increase?|25%|20%|percentage
21|1|Evaluate 3^4.|81|12|integer
21|2|Write 5 times 5 times 5 using exponent notation.|5^3|3^5|expression
22|1|Simplify 2^3 times 2^(-5) to a fraction.|1/4|1/32|fraction
22|2|For nonzero x, simplify (x^3)^2 / x^4.|x^2|x|expression
23|1|Evaluate 6 + 3 times 4^2.|54|144|integer
23|2|Evaluate (18 - 6) / 3 + 2.|6|4|integer
24|1|Which property changes 7 + (3 + 5) to (7 + 3) + 5?|associative property of addition|commutative property of addition|text
24|2|Which property changes 4 times 9 to 9 times 4?|commutative property of multiplication|associative property of multiplication|text
25|1|Use the distributive property to expand 6(10 + 4).|6*10 + 6*4|6*10 + 4|expression
25|2|Use the distributive property to rewrite 8 times 19 as 8(20 - 1). What is the value?|152|159|integer
26|1|Fill the blank to make the statement true: 8 + 4 = __ + 5.|7|12|integer
26|2|True or false: 3 + 9 = 7 + 5.|true|false|boolean
27|1|In n + 8 = 15, does n represent an unknown number or an operation?|unknown number|operation|text
27|2|A box contains b books. Write the number of books in five such boxes.|5b|b+5|expression
28|1|What is the coefficient of x in 4x + 7?|4|7|integer
28|2|Write an expression for three times the sum of x and 2.|3(x+2)|3x+2|expression
29|1|Evaluate 3x - 2 when x = -4.|-14|-10|integer
29|2|Evaluate 2a + b when a = 3/4 and b = -0.5.|1|2|number
30|1|Simplify 3(x + 4) + 2x.|5x+12|5x+4|expression
30|2|Simplify (1/2)(6x - 4) - x.|2x-2|2x-4|expression
31|1|Does x = 4 satisfy 3x + 2 = 14? Answer yes or no.|yes|no|text
31|2|Which value satisfies 2x - 5 = 1: x = 2 or x = 3?|3|2|integer
32|1|Subtract 7 from both sides of x + 7 = 12. Write the resulting equation.|x=5|x=19|equation
32|2|What operation on both sides preserves equality and isolates x in 4x = 20?|divide both sides by 4|subtract 4 from both sides|text
33|1|Which operation undoes adding 9?|subtracting 9|adding 9|text
33|2|Which operation undoes multiplying by 5?|dividing by 5|subtracting 5|text
34|1|Solve 3(x - 2) + 4 = 2x + 9.|11|7|number
34|2|Solve x/2 + 3 = x/4 + 5.|8|4|number
35|1|Which values in {-3, 0, 2, 5} satisfy x < 2?|{-3, 0}|{-3, 0, 2}|set
35|2|Describe the number-line graph of x >= -1 using endpoint type and shading direction.|closed circle at -1; shade right|open circle at -1; shade right|text
36|1|Solve -3x + 2 > 11.|x < -3|x > -3|inequality
36|2|Solve 2(x - 1) <= 8.|x <= 5|x <= 3|inequality
37|1|In which quadrant is the point (-3, 2)?|II|III|text
37|2|A point is 1.5 units right of the origin and 2 units down. Give its coordinates.|(1.5, -2)|(-1.5, 2)|ordered pair
38|1|The corresponding x and y values are x: 1, 2, 3 and y: 4, 7, 10. Which ordered pair has x = 2?|(2, 7)|(7, 2)|ordered pair
38|2|A table pairs hours 1, 2, 3 with distances 5, 10, 15. How much does distance change when hours increase from 2 to 3?|5|15|number
39|1|A proportional table contains (2, 6), (4, 12), and (6, 18). Write its equation.|y=3x|y=x+4|equation
39|2|The graph of y = 2.5x passes through the origin. What is y when x = 4?|10|6.5|number
40|1|The table x: 0, 1, 2, 3 and y: 5, 8, 11, 14 describes a linear relationship. What is its constant rate of change?|3|5|number
40|2|Which rule describes a linear relationship with a nonzero initial value: y = 4x + 2 or y = x^2?|y=4x+2|y=x^2|equation
41|1|Find the slope through (1, 2) and (5, 10).|2|1/2|number
41|2|Find the slope through (-2, 5) and (4, -1).|-1|1|number
42|1|To graph y = 2x - 3, start at its y-intercept and move one unit right. State the starting point and the vertical move.|(0, -3); up 2|(0, 2); down 3|text
42|2|Describe the graph of x = -2 as horizontal or vertical and give an axis point it passes through.|vertical; (-2, 0)|horizontal; (0, -2)|text
43|1|Do the pairs {(1, 2), (2, 3), (1, 4)} define a function? Answer yes or no.|no|yes|text
43|2|Do the pairs {(1, 5), (2, 5), (3, 5)} define a function? Answer yes or no.|yes|no|text
44|1|If f(x) = 2x^2 - 1, find f(-3).|17|-19|number
44|2|If g(t) = 5 - 2t, find g(4).|-3|3|number
45|1|A taxi charges $4 plus $2 per mile. Write cost C as a function of miles m.|C=2m+4|C=4m+2|equation
45|2|Write the linear function through (0, 3) and (2, 7).|y=2x+3|y=3x+2|equation
46|1|Does (2, 1) satisfy both x + y = 3 and 2x - y = 3? Answer yes or no.|yes|no|text
46|2|Does (1, 2) satisfy both x + y = 3 and x - y = 1? Answer yes or no.|no|yes|text
47|1|Solve the system x + y = 7 and x - y = 1.|(4, 3)|(3, 4)|ordered pair
47|2|Solve the system y = 2x + 1 and x + y = 10.|(3, 7)|(7, 3)|ordered pair
48|1|On a coordinate graph, lines A and B intersect at (2, 3). What is the solution of the system represented by those lines?|(2, 3)|(3, 2)|ordered pair
48|2|The graphs of two distinct linear equations are parallel. How many solutions does the system have?|0|infinitely many|text"""

COHORTS = [
    ([6,7,8,13,14,15,18,29,30,34], [
        [1,2,3,4,5], [9,10,11,12,16], [17,19,20,21,23],
        [24,25,26,27,28], [31,32,33,35,36]]),
    ([7,13,15,18,29,30,34,37,40,41], [
        [22,23,28,39,42], [12,27,38,43,44], [19,20,35,36,45],
        [6,8,31,46,47], [24,25,32,33,48]]),
    ([7,15,29,30,34,40,41,42,46,47], [
        [6,8,13,14,18], [21,22,23,28,44], [26,31,32,33,48],
        [16,17,37,38,39], [20,35,36,43,45]])
]


def clamp_rating(value):
    return max(1, min(5, round(value)))


def stamp(value):
    return value.isoformat(timespec='seconds').replace('+00:00', 'Z')


def build():
    source_path = ROOT / 'ontology.json'
    if not source_path.exists():
        source_path = HERE / 'source_ontology.json'
    source_bytes = source_path.read_bytes()
    ontology = json.loads(source_bytes)
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    connection.executescript((HERE / 'schema.sql').read_text())
    metadata = {
        'dataset_name': 'Synthetic mathematics learning records',
        'dataset_version': '1.0',
        'is_synthetic': 'true',
        'random_seed': str(SEED),
        'source_ontology': 'ontology.json',
        'source_ontology_sha256': hashlib.sha256(source_bytes).hexdigest(),
        'record_period_utc': '2026-09-01 through 2026-09-18',
        'affect_source': 'simulated post-problem self-report; not observed or sensor-inferred',
        'affect_scale': 'independent integers 1=very low, 2=low, 3=moderate, 4=high, 5=very high',
        'time_definition': 'elapsed seconds from problem start to completion, including attempts and hints',
        'attempt_definition': 'submitted answers including the initial answer; earlier submissions are incorrect',
        'completion_definition': 'finished activity; final answer may be correct or incorrect',
        'hint_definition': 'total hint requests during the problem; independent of submission count',
    }
    connection.executemany('INSERT INTO dataset_metadata VALUES (?,?)', metadata.items())
    connection.executemany('INSERT INTO concepts VALUES (?,?,?,?,?)', [
        (n['id'], n['name'], n['category'], n['definition'], n['grade']) for n in ontology['nodes']])
    connection.executemany('INSERT INTO prerequisite_edges VALUES (?,?,?,?)', [
        (e['source'], e['relationship'], e['target'], e['rationale']) for e in ontology['edges']])
    problems = {}
    for line in BANK.splitlines():
        concept, variant, prompt, answer, wrong, response_format = line.split('|')
        concept, variant = int(concept), int(variant)
        problem_id = f'P{concept:03d}_{variant:02d}'
        assert answer != wrong
        problems[concept, variant] = (problem_id, answer, wrong)
        connection.execute('INSERT INTO problems VALUES (?,?,?,?,?,?)',
                           (problem_id, f'MATH_{concept:03d}', variant, prompt, answer, response_format))

    counter = 0
    for group_index, (common, extra_sets) in enumerate(COHORTS):
        for within_grade, extras in enumerate(extra_sets):
            student_no = group_index * 5 + within_grade + 1
            student_id = f'STU_{student_no:03d}'
            connection.execute('INSERT INTO students VALUES (?,?,?,1)',
                               (student_id, f'Synthetic Student {student_no:02d}', 7 + group_index))
            concepts = sorted(common + extras)
            assert len(concepts) == len(set(concepts)) == 15
            base = rng.uniform(.59, .83) + .025 * group_index
            # Per-student variation creates uneven arithmetic/algebra patterns.
            # These are fixture-generation parameters, not learner diagnoses.
            domain_adjustments = {k: rng.uniform(-.22, .12) for k in ('fraction', 'signed', 'algebra', 'graph', 'other')}
            confidence_tendency = rng.uniform(-.7, .7)
            determination_tendency = rng.uniform(2.3, 4.4)
            frustration_tendency = rng.uniform(-.5, .5)
            for sequence, (variant, concept) in enumerate(
                    ((variant, concept) for variant in (1, 2) for concept in concepts), 1):
                domain = ('fraction' if concept in (5,6,7,8,11,15,17,18) else
                          'signed' if concept in (12,13,14,22,36) else
                          'algebra' if concept in (28,29,30,31,32,33,34,35,46,47) else
                          'graph' if concept in (37,38,39,40,41,42,43,44,45,48) else 'other')
                probability = max(.22, min(.93, base + domain_adjustments[domain] + .04 * (variant-1)))
                difficulty = 1 - probability
                first_correct = rng.random() < probability
                if first_correct:
                    attempts = 1
                    correct = 1
                else:
                    attempts = rng.choices([1,2,3,4,5], [6,38,33,18,5])[0]
                    correct = int(attempts > 1 and rng.random() < min(.88, probability + .18))
                hints = rng.choices([0,1,2,3,4],
                                    [max(12, 55-35*difficulty), 25, 12+15*difficulty, 5+8*difficulty, 3])[0]
                confidence = clamp_rating(1.4 + 3.1*probability + confidence_tendency + rng.gauss(0,1.05))
                confusion = clamp_rating(1.2 + 2.7*difficulty + .13*(attempts-1) + rng.gauss(0,.95))
                determination = clamp_rating(determination_tendency + rng.gauss(0,.95))
                frustration = clamp_rating(1.2 + 1.8*difficulty + .18*(attempts-1) + frustration_tendency + rng.gauss(0,1.05))
                base_time = 32 if concept in (1,9,12,21,24,26,27,31,32,33,43,46) else 58 if concept < 34 else 95
                seconds = max(18, min(720, round((base_time + 27*(attempts-1) + 15*hints + 45*difficulty)*rng.uniform(.65,1.65))))
                session, slot = divmod(sequence-1, 5)
                day_offset = [0,2,6,8,13,15][session] + (student_no % 3)
                if slot == 0:
                    cursor = datetime(2026,9,1,15+(student_no%4), student_no%5*6, tzinfo=timezone.utc) + timedelta(days=day_offset)
                start = cursor
                end = start + timedelta(seconds=seconds)
                cursor = end + timedelta(seconds=rng.randint(15,80))
                problem_id, answer, wrong = problems[concept, variant]
                counter += 1
                connection.execute('INSERT INTO problem_completions VALUES ('+','.join(['?']*15)+')',
                                   (f'CMP_{counter:04d}', student_id, problem_id, sequence,
                                    stamp(start), stamp(end), seconds, attempts, hints,
                                    answer if correct else wrong, correct,
                                    confidence, confusion, determination, frustration))
    connection.commit()
    validation = validate(connection, ontology)
    target = HERE / 'synthetic_students.sqlite'
    with sqlite3.connect(target) as output:
        connection.backup(output)
    export_names = ['students', 'concepts', 'prerequisite_edges', 'problems', 'problem_completions',
                    'completion_details', 'student_concept_summary']
    exports = HERE / 'csv'
    exports.mkdir(exist_ok=True)
    for name in export_names:
        query = connection.execute(f'SELECT * FROM {name} ORDER BY 1, 2')
        with (exports / f'{name}.csv').open('w', newline='', encoding='utf-8') as output:
            writer = csv.writer(output)
            writer.writerow([column[0] for column in query.description])
            writer.writerows(query)
    (HERE / 'validation.json').write_text(json.dumps(validation, indent=2)+'\n')
    (HERE / 'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')
    # A portable SQL dump provides another way to recreate the database.
    (HERE / 'synthetic_students.sql').write_text('\n'.join(connection.iterdump())+'\n')
    with zipfile.ZipFile(HERE / 'synthetic_student_database.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
        files = [target, HERE/'schema.sql', HERE/'README.md', HERE/'sample_queries.sql',
                 HERE/'metadata.json', HERE/'validation.json', HERE/'generate.py', HERE/'synthetic_students.sql']
        for path in files + sorted(exports.glob('*.csv')):
            bundle.write(path, path.relative_to(HERE))
        bundle.writestr('source_ontology.json', source_bytes)
    print(json.dumps(validation, indent=2))


def validate(connection, ontology):
    def scalar(sql):
        return connection.execute(sql).fetchone()[0]
    assert scalar('PRAGMA integrity_check') == 'ok'
    assert not list(connection.execute('PRAGMA foreign_key_check'))
    expected = {'students':15,'concepts':48,'prerequisite_edges':80,'problems':96,'problem_completions':450}
    counts = {name:scalar(f'SELECT COUNT(*) FROM {name}') for name in expected}
    assert counts == expected
    assert scalar('SELECT COUNT(DISTINCT concept_id) FROM completion_details') == 48
    assert scalar('SELECT COUNT(DISTINCT problem_id) FROM problem_completions') == 96
    assert scalar('SELECT COUNT(*) FROM (SELECT student_id FROM completion_details GROUP BY student_id HAVING COUNT(*) != 30 OR COUNT(DISTINCT concept_id) != 15)') == 0
    assert scalar('SELECT COUNT(*) FROM (SELECT concept_id FROM problems GROUP BY concept_id HAVING COUNT(*) != 2)') == 0
    assert scalar('SELECT COUNT(*) FROM completion_details WHERE final_is_correct != (final_response = correct_answer)') == 0
    assert scalar('SELECT COUNT(*) FROM (SELECT started_at_utc, LAG(completed_at_utc) OVER (PARTITION BY student_id ORDER BY sequence_no) AS previous_end FROM problem_completions) WHERE started_at_utc <= previous_end') == 0
    assert scalar("SELECT COUNT(*) FROM problem_completions WHERE completed_at_utc >= '2026-09-20T00:00:00Z'") == 0
    incoming = {n['id']:set(n['prerequisites']) for n in ontology['nodes']}
    def ancestors(node, path=()):
        assert node not in path, 'Cycle in imported ontology'
        return set().union(*(ancestors(p, path+(node,))|{p} for p in incoming[node])) if incoming[node] else set()
    for node in incoming:
        ancestors(node)
    checks = {
        'confident_but_incorrect': scalar('SELECT COUNT(*) FROM problem_completions WHERE confidence >= 4 AND final_is_correct = 0'),
        'low_confidence_but_correct': scalar('SELECT COUNT(*) FROM problem_completions WHERE confidence <= 2 AND final_is_correct = 1'),
        'determined_and_frustrated': scalar('SELECT COUNT(*) FROM problem_completions WHERE determination >= 4 AND frustration >= 4'),
        'correct_after_multiple_attempts': scalar('SELECT COUNT(*) FROM problem_completions WHERE attempt_count > 1 AND final_is_correct = 1'),
    }
    assert all(count > 0 for count in checks.values())
    # Confirm the delivered database can reconstruct both tables and views.
    restored = sqlite3.connect(':memory:')
    restored.executescript('\n'.join(connection.iterdump()))
    assert restored.execute('SELECT COUNT(*) FROM completion_details').fetchone()[0] == 450
    restored.close()
    return {'status':'passed','random_seed':SEED,'counts':counts,
            'observed_concepts':48,'observed_problems':96,'completions_per_student':30,
            'concepts_per_student':15,'ontology_acyclic':True,
            'foreign_keys':'passed','chronology_and_duration':'passed',
            'canonical_answer_consistency':'passed','sql_dump_restore':'passed',
            'mixed_affect_examples':checks,
            'final_correct_records':scalar('SELECT SUM(final_is_correct) FROM problem_completions'),
            'time_seconds_range':list(connection.execute('SELECT MIN(time_taken_seconds), MAX(time_taken_seconds) FROM problem_completions').fetchone())}


if __name__ == '__main__':
    build()
