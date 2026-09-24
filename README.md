# Meridian — local teacher Graph RAG

A text-first teacher workspace backed by the existing mathematics graph and the local Qwen 27B GGUF. The flat React interface includes class/student context, a searchable roster, saved conversations with deletion, clickable evidence citations, prerequisite paths, and the exact Cypher queries used for each answer.

Soon to be made into an installable Mac app that allows you to upload your own real CSV information. 

## Open or start

The built application runs at **http://localhost:4310**. Neo4j Browser is at **http://localhost:7474/browser/**.

From `/Users/sanahrajesh/GraphRAGApplication`:

```sh
npm install
npm run dev
```

Development opens at **http://localhost:4311**. The launcher reuses running local Neo4j and Qwen services, or starts them if needed. It requires Node 22.13+ with `node:sqlite`, the project's installed Neo4j runtime, and `llama-server` on PATH. It only stops service processes it started itself. Stop an already running app before launching another instance on the same ports.

For the built interface, keep Neo4j and the Qwen server running, then:

```sh
npm run app:build
npm run app:start
```

The original ontology visualization remains in `index.html`; `npm run build` still rebuilds that artifact. `npm run app:build` builds Meridian separately.

## Local configuration

- `.neo4j.env`: existing Neo4j connection and password. Credentials stay on the server.
- `.app.env`: app port, model server, alias, GGUF path, and timeout. See `.app.env.example`.
- Located model: `/Users/sanahrajesh/UltimateDocumentEditor/Qwen3.8-27B-UD-IQ1_S.gguf`.
- Current llama.cpp server: `http://127.0.0.1:8091`, alias `qwen-local-27b`, 8,192-token context. The application reuses this existing server and checks its alias and reported parameter count. Merely setting a path does not change an already running model server.
- The native llama.cpp `/completion`, `/tokenize`, `/health`, and `/v1/models` endpoints are used. There is no hosted-model fallback.

All UI assets, including fonts, are served locally. Conversations and their evidence/query snapshots persist in `.runtime/teacher-app.sqlite`; graph data remain in Neo4j. Both local services bind to loopback. This is a single-user local application, without authentication or multi-teacher access controls.

## What happens for each question

1. **Understand:** Qwen generates a retrieval plan whose JSON schema restricts IDs to the live concept, student, and class catalog. Explicit grade/student references and cohort aliases resolve before validation. The current question selects ranking, screening, comparison, overview, diagnosis, profile, or lesson output. Prior context is supplied only for references needing it; people and mathematical topics resolve separately.
2. **Query:** trusted, parameterized Cypher retrieves observed correctness, attempts, hints, elapsed time, and synthetic affect ratings in that scope. The model does not execute arbitrary Cypher.
3. **Traverse:** Neo4j follows `PREREQUISITE_OF` edges upstream, finds shared ancestors and explanatory paths, and retrieves problem completions and authored diagnostic tasks. Self-pairs are excluded from shortest-path queries. Learner-by-concept aggregates check whether flags at the prerequisite and target occur in the same students; unrelated students are never pooled into a purported paired pattern.
4. **Assemble:** selected graph records receive evidence IDs and are token-budgeted for the model context. When investigations are available, Qwen receives those focused evidence records; full profiles and numerical summaries are rendered from the wider retrieval. The query inspector lists the IDs actually supplied to Qwen. The interface retains query text, parameters, result counts, and timings.
5. **Generate:** Rankings and prerequisite screening lead with learner names and exact retrieved results. Overall learner rankings compare final-correct proportion, independent-correct proportion, and then mean attempts/hints; the rule is displayed, and exact ties are reported. Qwen adds a brief evidence-bound explanation. Diagnosis and lesson requests instead explain prerequisite mechanisms; extended teaching plans appear for lesson requests. Exact numbers and problem-bank answer keys are rendered directly from Neo4j. Concept-specific instructional scaffolds in `app/instruction.mjs` provide diagnostic look-fors and teaching moves for all 48 concepts; these are authored suggestions, separate from the ontology and student observations. The application renders explicit struggle/success branches and an independent transfer check. A successful prerequisite diagnostic weakens the prerequisite-gap hypothesis.
6. **Check:** the server validates structure and citation existence and rejects selected unsupported mastery/calculation patterns, with one revision attempt. A failed run produces an explicit error, never a fabricated replacement answer. These checks do not prove the semantic correctness of generated hypotheses.

Progress streams while the pipeline runs. Answer text appears after validation. Cancellation stops the model request; incomplete runs are marked accordingly. Use the trash icon beside a conversation, then Delete, to remove its messages and saved evidence/query snapshots. Deleting a generating conversation cancels its request and prevents late writes. Mathematical and student records in Neo4j are unaffected. Citation checks establish that references exist, **not** that every model interpretation is correct. Teachers can inspect the underlying evidence and query trace.

## Dataset and interpretation

The graph contains **20 synthetic students, 3 synthetic grade cohorts, 96 problems, 600 completions, 48 concepts, and 80 prerequisite edges**. Cohorts are derived from grades 7–9, not actual classroom assignments. Application startup adds cohorts/enrollments idempotently, preserving the original ontology and practice records.

Correct final answers and independent correctness are separate measures. Independent correctness means correct on the first attempt without hints. Affect values are simulated post-problem ratings from 1 to 5, not diagnoses or stable student traits. Missing practice is explicitly unobserved; a prerequisite path suggests something to investigate and does not establish a knowledge gap.

Broad questions prioritize the count of incorrect final answers and supported/repeated completions, so tiny concept samples do not automatically outrank widespread cohort patterns. This is an interpretable selection heuristic, not a mastery score. Student profiles show every observed skill and count unobserved concepts; deeper investigations focus on selected priorities. Broad questions retrieve a bounded subset of students, paths, and examples. The evidence panel shows that subset and the actual query counts. This version supports recorded status, comparisons, and prerequisite-based next steps; it does not model mastery, evaluate intervention effectiveness, or establish longitudinal improvement. Arbitrary date-range reporting is not implemented.

Try:

- “Which prerequisites should I investigate for Student 01 when solving linear equations?”
- “What should I revisit with the Grade 8 cohort before teaching slope?”
- “Compare the Grade 7 and Grade 8 cohorts.”
- “Which students have the highest frustration ratings?”
- “Which students take the most time on their problems?”

## Validation and expansion

```sh
npm run app:test          # entity, citation, guidance, and rendering checks
npm run app:integration   # live graph scope/count/order and API checks; no generation
npm run app:smoke         # full Qwen + Neo4j pipeline and persistence check
node app/context-smoke.mjs # live topic-switch and contextual screening regression
node app/delete-integration.mjs # deletion during generation
npm run app:build
npm run graph:verify
```

Local student and class smoke tests take roughly one to three minutes on this device, depending on context and the shared model slot. The configured IQ1 quantization and a shared single model slot make latency and generation quality variable. A second application request receives a busy response until the current run finishes or stops.

`app/ui-check.mjs`, `app/chat-ui-check.mjs`, and `app/profile-ui-check.mjs`, and `app/conversation-ui-check.mjs` verify the interface through Playwright against a dedicated Chrome debugging instance on port 9242. Set `UI_URL` to test a different app port. Screenshots and smoke-test reports are written to ignored `test-results/`.

See [graph/README.md](graph/README.md) for import, expansion, backup, and restore. Restart the app after importing new students to add their grade enrollments, then refresh the interface. The retrieval catalog is read live for each question.
