# CQN to SQL-shaped CQN

`../cqn4sql.js` owns the input copy and coordinates the transformation. Modules
receive a context for one query scope; no query state is shared between calls.

| Modules | Responsibility |
| --- | --- |
| `clone`, `model` | Own the CQN graph; read linked model keys without populating CSN caches |
| `resolve/*`, `join-tree` | Resolve source and column references, plan joins and deterministic aliases |
| `columns`, `projections`, `flatten` | Project scalar values, structures, foreign keys, inlines and expands |
| `expressions`, `enums` | Rewrite predicates, functions, comparisons and enum literals |
| `sources`, `joins` | Rewrite navigation, EXISTS, joins, subqueries and correlations |
| `select`, `search`, `runtime-views` | Query modifiers, search ranking and CTEs |

Reference planning remains necessary for SQL: a later column or predicate can
require a join or alias used by an earlier column. It collects element metadata
from the references it already resolves. It does not call the legacy infer API.
Association expands are resolved when their SQL subquery is transformed, avoiding
a separate inference traversal. Grouped expands need nested links in advance to
match the GROUP BY; the compatibility `../infer` API also requests nested metadata.

Keep these ownership rules when adding transformations:

- Definitions, calculated values, ON conditions and runtime-view queries belong
  to the caller. Copy expressions before linking or rewriting them.
- Calculated expressions are copied and cached within their query scope. Never
  store SQL aliases or reference links on model elements.
- Use `keysOf` and `foreignKeysOf`: CDS reflection getters may cache on the model.
- Outer-scope arrays are copied when adding a scope. Resolved CTEs retain their
  metadata when copied; ordinary CQN is relinked so edited queries can be reused.
- Streams, iterators and binary values are opaque payloads; cloning must not
  consume them or manufacture objects without their native internal state.

Run the reference suite before the broader db-service and SQLite suites. Existing
SQL expectations should stay stable, including column order and generated aliases.
