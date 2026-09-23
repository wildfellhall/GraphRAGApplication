"""Export the SQLite fixture and create deterministic additive synthetic cohorts."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import re
import sqlite3
from datetime import datetime, timedelta

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT/'graph/data'
SOURCE = ROOT/'synthetic_data/synthetic_students.sqlite'


def source():
    db = sqlite3.connect(SOURCE.as_uri()+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db


def save(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(payload, indent=2, ensure_ascii=False)+'\n'
    path.write_text(content)
    print(f'{path.relative_to(ROOT)}: {len(payload["students"])} students, {len(payload["completions"])} completions')


def base():
    with source() as db:
        rows = lambda table: [dict(row) for row in db.execute(f'SELECT * FROM {table} ORDER BY 1')]
        metadata = dict(db.execute('SELECT key, value FROM dataset_metadata'))
        payload = {'dataset': {'dataset_id':'synthetic-math-v1', 'name':'Original synthetic mathematics cohort',
                              'is_synthetic':True, 'seed':int(metadata['random_seed']),
                              'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                              'affect_source':metadata['affect_source']},
                   'concepts':rows('concepts'), 'prerequisite_edges':rows('prerequisite_edges'),
                   'students':rows('students'), 'problems':rows('problems'),
                   'completions':rows('problem_completions')}
    for student in payload['students']:
        student['is_synthetic'] = True
    for completion in payload['completions']:
        completion['final_is_correct'] = bool(completion['final_is_correct'])
    save(DATA/'base.json', payload)


def expand(args):
    if args.students < 1 or args.students > 100 or args.start_id < 16:
        raise ValueError('Use 1–100 new students and a start ID of at least 16; choose unused IDs.')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', args.batch):
        raise ValueError('Batch IDs may contain only letters, digits, underscores, and hyphens.')
    spec = importlib.util.spec_from_file_location('synthetic_fixture', ROOT/'synthetic_data/generate.py')
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    distractors = {}
    for line in fixture.BANK.splitlines():
        c, v, _, answer, wrong, _ = line.split('|')
        distractors[f'P{int(c):03d}_{int(v):02d}'] = (answer, wrong)
    rng = random.Random(args.seed)
    payload = {'dataset': {'dataset_id':f'synthetic-math-{args.batch}', 'name':f'Additional synthetic cohort: {args.batch}',
                          'is_synthetic':True, 'seed':args.seed,
                          'affect_source':'simulated post-problem self-report; not observed or sensor-inferred'},
               'concepts':[], 'prerequisite_edges':[], 'students':[], 'problems':[], 'completions':[]}
    with source() as db:
        for i in range(args.students):
            number = args.start_id+i
            student_id = f'STU_{number:03d}'
            template_id = f'STU_{([3,6,9,12,15][i%5]):03d}'
            template_student = db.execute('SELECT * FROM students WHERE student_id=?', (template_id,)).fetchone()
            payload['students'].append({'student_id':student_id,'display_name':f'Synthetic Student {number:02d}',
                                       'grade_level':template_student['grade_level'],'is_synthetic':True})
            baseline = rng.uniform(.48,.84)
            for old in db.execute('SELECT * FROM problem_completions WHERE student_id=? ORDER BY sequence_no', (template_id,)):
                row = dict(old)
                difficulty = 1-baseline
                attempts = 1 if rng.random()<baseline else rng.choices([2,3,4,5],[35,35,22,8])[0]
                hints = rng.choices([0,1,2,3,4],[30,30,23,12,5])[0]
                correct = (rng.random() < (baseline if attempts == 1 else min(.93,baseline+.20)))
                seconds = rng.randint(35,110)+22*(attempts-1)+14*hints
                original_start = datetime.fromisoformat(row['started_at_utc'].replace('Z','+00:00'))
                if (row['sequence_no']-1)%5 == 0:
                    cursor = original_start.replace(hour=14+i%4,minute=(i*7)%50,second=0)
                end = cursor+timedelta(seconds=seconds)
                answer, wrong = distractors[row['problem_id']]
                rating = lambda value:max(1,min(5,round(value)))
                row.update(completion_id=f'{args.batch}_CMP_{i*30+row["sequence_no"]:04d}',
                           student_id=student_id, started_at_utc=cursor.isoformat().replace('+00:00','Z'),
                           completed_at_utc=end.isoformat().replace('+00:00','Z'), time_taken_seconds=seconds,
                           attempt_count=attempts,hints_used=hints,final_is_correct=correct,
                           final_response=answer if correct else wrong,
                           confidence=rating(1.5+3*baseline+rng.gauss(0,1)),
                           confusion=rating(1.4+2.5*difficulty+rng.gauss(0,1)),
                           determination=rating(rng.uniform(1.5,4.8)+rng.gauss(0,.5)),
                           frustration=rating(1.2+2*difficulty+.15*(attempts-1)+rng.gauss(0,1)))
                cursor=end+timedelta(seconds=rng.randint(20,60))
                payload['completions'].append(row)
    save(DATA/f'{args.batch}.json', payload)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('base')
    p = sub.add_parser('expand')
    p.add_argument('--students',type=int,default=5)
    p.add_argument('--start-id',type=int,default=16)
    p.add_argument('--seed',type=int,default=20260921)
    p.add_argument('--batch',default='cohort-02')
    args = parser.parse_args()
    base() if args.action == 'base' else expand(args)
