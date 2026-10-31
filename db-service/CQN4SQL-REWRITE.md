# CQN4SQL compiler rewrite

## Objective and acceptance boundary

Replace the transformation and its private inference machinery with a compiler
that reads caller-owned CQN and CSN, plans each query scope once, and emits fresh
SQL-shaped CQN. Preserve the existing feature set, result metadata, error
contracts, projection order, and deterministic aliases. The baseline includes
current main, especially left joins in expand/EXISTS filters, and the correctness
and ownership regressions from PR #1774.

Completion requires the reference and infer compatibility tests, all local
db-service/SQLite tests, and the remote HANA tests to pass. HANA runs remotely;
the HANA container does not run on this ARM development machine. Existing
reference expectations stay unchanged except where execution demonstrates a
semantic correction. Record every such exception.

## Architecture

1. **Read-only input and explicit options.** Capture database capabilities and
   feature settings at the boundary. Preserve extension descriptors without
   evaluating accessors. Treat literal values and write payloads as opaque.
2. **Model descriptors.** Derive physical leaf paths, keys, association key
   pairs, and calculation templates without invoking memoizing CSN getters.
   Cache externally for the duration of a compilation. Cross-call caching needs
   an explicit immutable model generation and is not assumed.
3. **Scopes and bindings.** Bind references to explicit source occurrences and
   element identities. Nested scopes retain their parent. Clause lookup rules,
   correlation, `$self`, and `$main` are explicit. Never attach SQL planning
   state to input syntax or model definitions.
4. **Query plans.** An ordered projection plan, dependency graph, and association
   prefix trie record all decisions. A reference retains source/join identities
   rather than copied aliases. Filters, parameters, and scope distinguish
   association traversals. Calculations share templates, never bound occurrences.
5. **Expression and association rules.** One expression traversal handles
   functions, lists, comparisons, and EXISTS with explicit SELECT boundaries.
   Preserve opaque token sequences and grouping. Common association correlation
   rules serve joins, expands, navigation, and write predicates while retaining
   their different cardinality and null semantics.
6. **Emission.** Emit owned output from completed plans. Emission performs no
   name resolution or join discovery. Preserve aliases and column order without
   retaining input objects as prototypes of mutable output syntax.
7. **Metadata boundary.** Plans carry logical result metadata independently of
   a single target entity. Adapt it to the existing renderer/service API; no
   consumer depends on inference mutating the original query. Keep the public
   infer compatibility facade separate from SQL lowering. Use cds.infer where
   it supplies the needed semantics without repeating a full inference pass.

## Algorithms and performance criteria

- Map lookup for source aliases; element lookup across the current scope's
  sources for unqualified references, with ambiguity detection.
- Ordered projection arrays plus maps for replacement, exclusion, and aliases.
- Dependency ordering and cycle detection for `$self` and calculations.
- Association prefix tries with compatible traversal reuse, cached filter keys,
  and monotone foreign-key/join decisions.
- Lazy structures for simple queries. Process each nested query occurrence once.
- Work should scale with syntax, reference lengths, dependencies, and emitted
  output. Do not claim constant cost for expanded output or share bindings
  across different scopes just because the same syntax object was reused.
- Measure transformation separately from parsing, rendering, and execution;
  include ordinary selects as well as wide/deep and unmanaged-association cases.

## Implementation sequence (completed)

1. Capture baseline tests and representative outputs; preserve both current main
   and the prior refactor as reference implementations outside production code.
2. Implement model descriptors, scopes, bindings, ordered projections, and fresh
   emission for scalar/structured queries and managed associations.
3. Complete expressions, calculations, dependencies, unmanaged conditions,
   navigation, EXISTS, inline/expand, subqueries, and write operations.
4. Complete search, localization, runtime views, inference compatibility, and
   result metadata. Remove the old production pipeline rather than retaining a
   fallback that hides unsupported cases.
5. Run the full reference corpus; fix implementations before considering any
   expectation changes. Add execution regressions for discovered semantic bugs.
6. Verify immutable inputs/models, reused queries, scoped calculations, cycles,
   query-occurrence counts, unknown metadata, and opaque payloads.
7. Run local integration suites, remote HANA (including quoted names), lint, and
   representative benchmarks. Record final results and remaining tradeoffs.

## Validation record

Completed on 2026-10-30 against main at `c176754c`. The production implementation
contains no fallback to either the original transformer or PR #1774.

### Module boundaries

| Module | Responsibility |
| --- | --- |
| `cqn4sql.js` | Capture options, plan, allocate names, emit queries and CTEs |
| `syntax.js` | Descriptor-preserving syntax copies and opaque payload ownership |
| `model.js` | Per-compilation model facts, flattened leaves, keys and types |
| `scope.js`, `bind.js` | Lexical sources, association tries, reference and calculation binding |
| `projections.js` | Ordered wildcards, replacements, dependencies, inline and expand |
| `expressions.js`, `associations.js` | Expressions, tuple lowering and shared association correlations |
| `plan.js` | Query scopes, navigation, expands and write selection |
| `aliases.js` | Final alias allocation and physical reference locations |
| `metadata.js`, `logical.js` | Conditional type completion and inference compatibility |
| `search.js`, `views.js` | Search/ranking and shared runtime-view CTE planning |
| `emit.js` | SQL-shaped CQN from completed plans |

Mutable state belongs to the compiler and its plans. Input CQN and CSN are never
enriched with SQL state or cached search columns. Emitted syntax is owned by the
result; model definitions remain shared metadata, and literals, streams and write
payloads remain opaque. Query class prototypes and extension descriptors are
preserved. A query is planned once per occurrence; correlation can complete its
join requirements before aliases and physical locations are finalized. Emission
does not resolve model references or discover joins.

The private infer entry point is a 15-line facade over the same planner in
metadata-only mode. SQL lowering does not invoke it. SQLService and HANAService
use `cds.infer.target` at the service boundary; joins and FROM subqueries retain
result metadata without requiring a single entity target. No external `@sap/cds`
files were changed: its installed inference API does not yet replace all the
compatibility behavior covered by this repository's infer tests.

### Test results

All final runs used Node.js v22.23.3.

| Suite | Passed | Skipped |
| --- | ---: | ---: |
| db-service, including cqn4sql references and infer compatibility | 1,182 | 21 |
| SQLite, better-sqlite3 | 857 | 286 |
| SQLite, sql.js | 857 | 286 |
| Remote HANA, full suite | 860 | 293 |
| Remote HANA, quoted-name bookshop | 183 | 15 |

Lint passed with zero errors and seven existing warnings. `git diff --check`
passed. Remote tests used the configured HANA endpoint through VPN, not a local
HANA container. PostgreSQL was outside this first verification boundary.

Local commands:

```sh
CDS_REQUIRES_DB_DRIVER=better-sqlite3 npm test
CDS_REQUIRES_DB_DRIVER=sql.js npm test -w sqlite
npm run lint
```

Thirty added regression cases cover frozen inputs/models, descriptor accessors,
opaque write payloads, per-path and filtered calculations, inline wildcard
execution, nested inference, dependency cycles, a reverse-ordered 200-column
dependency chain, one planning call per nested FROM scope, runtime-view
immutability, and aliased expands used by CDS query cloning.

Only three existing expectations changed:

- Two inline calculation ON conditions now use `department.id =
  self.department_id` instead of `department.id = Employee.department_id`. A
  calculation on an associated employee must read that employee's department.
  Execution regressions with different root/associated rows verify this semantic
  correction.
- The search test now asserts that `__searchableColumns` is absent from the
  model. Its SQL expectation is unchanged.

### Performance and size

Transformation timings exclude parsing, model loading, SQL rendering and database
execution. Each implementation received its own model and query, with 200 warmup
calls followed by seven batches of 1,000 calls. Values below are median
microseconds per transformation on this ARM development machine. The baseline
is main at `c176754c`.

| Query | Main | Rewrite |
| --- | ---: | ---: |
| Scalar select | 9.7 | 7.8 |
| Root wildcard | 17.0 | 20.5 |
| Association joins | 15.7 | 11.6 |
| EXISTS with association filter | 30.0 | 15.4 |
| Nested expands | 61.2 | 24.3 |
| Calculated columns | 22.9 | 19.1 |
| Wide projection, 200 columns | 302.9 | 211.3 |

Warm root wildcards are about 21% slower in this measurement. The other sampled
cases improve by 1.20–2.52 times. Main benefits from mutation-based caches across
calls; this implementation deliberately keeps derived facts per compilation so
mutable input models cannot leave stale cross-call results. These are sampled
microbenchmarks, not an end-to-end throughput claim. Broader unmanaged-association
and allocation profiling remains useful follow-up work.

Production JavaScript for the cqn4sql entry point/modules, infer JavaScript and
shared utils decreased from **4,796 to 1,543 physical lines**, a reduction of
**3,253 lines (67.8%)**. This measurement includes blank/comment lines and excludes
tests, this document, and the shared search/service files.
