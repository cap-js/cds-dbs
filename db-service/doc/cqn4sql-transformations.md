# cqn4sql — Path Expression Transformations

`cqn4sql` transforms high-level CAP Style CQNs into flat, SQL-ready CQN. This document covers how association path expressions are translated into joins, exists subqueries, and correlated subqueries.

All examples use CQL syntax. The right-hand side shows the transformed output.

---

## 1. Association Path in Columns / WHERE → LEFT JOIN

Accessing a field through a managed association produces a `LEFT OUTER JOIN`. The join correlates on the association's foreign key. The resulting column is aliased by joining path segments with underscores.

```sql
-- Input
SELECT from Books { ID, author.name }

-- Output
SELECT from Books
  left outer join Authors as author on author.ID = Books.author_ID
{ Books.ID, author.name as author_name }
```

Multiple fields from the same association share a single join. Different associations get separate joins.

### Multi-step paths

Each association step along the path produces its own join:

```sql
-- Input
SELECT from Books { genre.parent.descr }

-- Output
SELECT from Books
  left outer join Genres as genre   on genre.ID = Books.genre_ID
  left outer join Genres as parent  on parent.ID = genre.parent_ID
{ parent.descr as genre_parent_descr }
```

### Structures within association paths

Structure steps are absorbed into the flattened column name — only association steps produce joins:

```sql
-- Input
SELECT from Books { dedication.addressee.name }
-- `dedication` is a structure, `addressee` is an association inside it

-- Output
SELECT from Books
  left outer join Person as addressee
    on addressee.ID = Books.dedication_addressee_ID
{ addressee.name as dedication_addressee_name }
```

### Paths in WHERE / HAVING / ORDER BY

Association paths in query modifiers produce the same joins:

```sql
-- Input
SELECT from Books { ID } where author.name = 'Brontë'

-- Output
SELECT from Books
  left outer join Authors as author on author.ID = Books.author_ID
{ Books.ID }
where author.name = 'Brontë'
```

If a column and a WHERE clause both traverse the same association, they share the join.

### FK shortcut — no join needed

If the path accesses only a foreign key field (or the association itself without further navigation), no join is generated:

```sql
-- Input
SELECT from Books { author.ID }

-- Output (no join)
SELECT from Books { Books.author_ID as author_ID }

-- Selecting the association itself replaces it with its FK(s)
SELECT from Books { author }
-- Output
SELECT from Books { Books.author_ID }
```

---

## 2. Infix Filters → Additional JOIN ON Conditions

An infix filter on an association step adds the filter predicate to the join's `ON` clause:

```sql
-- Input
SELECT from Books { author[placeOfBirth = 'Marbach'].name }

-- Output
SELECT from Books
  left outer join Authors as author
    on author.ID = Books.author_ID
    and author.placeOfBirth = 'Marbach'
{ author.name as author_name }
```

The same association with **different filters** (or with/without a filter) produces **separate joins** with unique aliases:

```sql
-- Input
SELECT from Books {
  author[placeOfBirth = 'Marbach'].name as n1,
  author.name as n2
}

-- Output
SELECT from Books
  left outer join Authors as author
    on author.ID = Books.author_ID and author.placeOfBirth = 'Marbach'
  left outer join Authors as author2
    on author2.ID = Books.author_ID
{
  author.name  as n1,
  author2.name as n2
}
```

Infix filters also apply in `exists` and `FROM` navigation, where they become conditions in the `WHERE EXISTS` subquery.

---

## 3. WHERE EXISTS Subqueries

Both association paths in `FROM` and the `exists` predicate produce `WHERE EXISTS` correlated subqueries. The mechanics are the same — a `FROM` path like `Authors:books` is semantically equivalent to `SELECT from Books where exists author`.

### Association in FROM

An association step in the `FROM` clause rewrites the query target to the association's target entity and adds a `WHERE EXISTS` subquery correlating back to the source:

```sql
-- Input
SELECT from Authors:books { title }

-- Output
SELECT from Books as books { books.title }
where exists (
  SELECT 1 from Authors as Authors
  where Authors.ID = books.author_ID
)
```

Multi-step navigation produces nested subqueries:

```sql
-- Input
SELECT from Authors:books.genre { descr }

-- Output
SELECT from Genres as genre { genre.descr }
where exists (
  SELECT 1 from Books as books
  where books.genre_ID = genre.ID
    and exists (
      SELECT 1 from Authors as Authors
      where Authors.ID = books.author_ID
    )
)
```

`DELETE` uses the same transformation:

```sql
-- Input
DELETE from Books:author

-- Output
DELETE from Authors as author
where exists (
  SELECT 1 from Books as Books
  where Books.author_ID = author.ID
)
```

### `exists` predicate

The `exists` predicate on an association expands into the same kind of subquery:

```sql
-- Input
SELECT from Books { ID } where exists author

-- Output
SELECT from Books { Books.ID }
where exists (
  SELECT 1 from Authors as author
  where author.ID = Books.author_ID
)
```

Multi-step `exists` paths nest subqueries:

```sql
-- Input
SELECT from Authors { ID } where exists books.genre

-- Output
SELECT from Authors { Authors.ID }
where exists (
  SELECT 1 from Books as books
  where books.author_ID = Authors.ID
    and exists (
      SELECT 1 from Genres as genre
      where genre.ID = books.genre_ID
    )
)
```

### Infix filters

Filters on association steps become additional conditions in the subquery. This applies to both `exists` predicates and `FROM` path steps:

```sql
-- Input
SELECT from Authors { ID } where exists books[title = 'Hamlet']

-- Output
SELECT from Authors { Authors.ID }
where exists (
  SELECT 1 from Books as books
  where books.author_ID = Authors.ID
    and books.title = 'Hamlet'
)
```

### Join-relevant paths in infix filters → INNER JOIN

When an infix filter contains an association path that accesses a non-FK field, an **inner join** is added inside the EXISTS subquery. This applies identically to `exists` predicates and `FROM` path steps.

```sql
-- exists predicate
SELECT from Authors { ID }
where exists books[genre.name = 'Thriller']

-- equivalent scoped query
SELECT from Books[genre.name = 'Thriller']:author { ID }

-- both produce the same output
SELECT from Authors { Authors.ID }
where exists (
  SELECT 1 from Books as books
    inner join Genres as genre on genre.ID = books.genre_ID
  where books.author_ID = Authors.ID
    and genre.name = 'Thriller'
)
```

Multi-step paths produce chained inner joins:

```sql
-- Input
SELECT from Authors { ID }
where exists books[genre.parent.name = 'Fiction']

-- Output
SELECT from Authors { Authors.ID }
where exists (
  SELECT 1 from Books as books
    inner join Genres as genre  on genre.ID = books.genre_ID
    inner join Genres as parent on parent.ID = genre.parent_ID
  where books.author_ID = Authors.ID
    and parent.name = 'Fiction'
)
```

A nested infix filter on the association step folds its condition into the ON clause:

```sql
-- Input
SELECT from Authors { ID }
where exists books[genre[name = 'Drama'].ID is not null]

-- Output
SELECT from Authors { Authors.ID }
where exists (
  SELECT 1 from Books as books
    inner join Genres as genre
      on genre.ID = books.genre_ID and genre.name = 'Drama'
  where books.author_ID = Authors.ID
    and genre.ID is not null
)
```

**Why inner join, not left outer?** Consider `exists books[genre.name is null]`. With a left outer join, a book that has *no* genre at all would produce a NULL `genre.name` row — and incorrectly satisfy the `is null` condition. An inner join eliminates books without a matching genre first, so only books whose genre genuinely has a NULL name match the filter.

### Exception: leaf infix filter on FROM

When the infix filter is on the **leaf** of the FROM ref (i.e., no further association navigation after it), no EXISTS subquery is created. Instead, the join-relevant path becomes a regular left join on the main query, and the filter goes into the main WHERE clause — equivalent to writing the filter in WHERE directly:

```sql
-- Input
SELECT from Books[genre.name like '%Fiction'] { ID }

-- Equivalent to
SELECT from Books { ID } where genre.name like '%Fiction'

-- Output (both produce)
SELECT from Books
  left join Genres as genre on genre.ID = Books.genre_ID
{ Books.ID }
where genre.name like '%Fiction'
```

---

## 4. Expand → Correlated Subquery

An `expand` column (nested projection on an association) is transformed into a correlated subquery, marked with `expand: true` in the output CQN.

### To-one

```sql
-- Input
SELECT from Books { author { name } }

-- Output
SELECT from Books {
  (SELECT author.name from Authors as author
   where Books.author_ID = author.ID) as author
}
```

### To-many

```sql
-- Input
SELECT from Authors { books { title } }

-- Output
SELECT from Authors {
  (SELECT books.title from Books as books
   where Authors.ID = books.author_ID) as books
}
```

### Paths inside expand

Association paths within the expand subquery produce joins inside that subquery:

```sql
-- Input
SELECT from Authors { books { title, genre.name } }

-- Output
SELECT from Authors {
  (SELECT books.title, genre.name as genre_name
   from Books as books
     left outer join Genres as genre on genre.ID = books.genre_ID
   where Authors.ID = books.author_ID) as books
}
```

Expand subqueries are processed recursively — nested expands produce nested correlated subqueries.

---

## 5. Inline → Flattened Columns

`inline` (`.{}` syntax on a **structure**) flattens the nested projection into the parent column list. Unlike expand, no subquery is created.

```sql
-- Input
SELECT from Employee { office.{ floor, room } }

-- Output
SELECT from Employee {
  Employee.office_floor,
  Employee.office_room
}
```

Inline on an **association** works like expand for to-one but flattens the result into the parent columns instead of producing a subquery.

---

## 6. UPDATE / DELETE with Association Paths

Since SQL `UPDATE` / `DELETE` do not support joins, association paths in `WHERE` are rewritten into a key-based subquery:

```sql
-- Input
UPDATE Books set stock = 0 where author.name like '%Brontë%'

-- Output
UPDATE Books as Books2
where Books2.ID in (
  SELECT Books.ID from Books
    left outer join Authors as author on author.ID = Books.author_ID
  where author.name like '%Brontë%'
)
```

The original table alias is renamed (Books → Books2) to avoid collision with the inner query.

---

## Alias Rules

| Scenario | Alias |
|---|---|
| No explicit alias | Generated from entity name (`$B` for Books, `$a` for author) |
| Explicit `as` clause | Preserved (`as Books` → `Books`) |
| Join alias | Derived from association name (`author`, `genre`) |
| Alias collision | Numeric suffix added (`author`, `author2`, `author3`) |
| Recursive self-association | Each step gets incremented alias (`parent`, `parent2`, `parent3`) |

---

## Limitations

| Area | Limitation |
|---|---|
| **Custom JOINs** | If the query already has explicit join args in `from`, cqn4sql skips all transformations and returns the query unchanged. |
| **Unmanaged associations** | Cannot be selected as values (no FK). Can only be traversed in paths where the ON condition provides the join. |

### Join-relevant paths in infix filters

Outside of `exists` subqueries and `FROM` path expressions, infix filters that contain join-relevant association paths (non-FK access) are **currently rejected**:

```sql
-- REJECTED: non-FK access `books.title` in infix filter of a regular column path
SELECT from Books { author[books.title = 'foo'].name }
-- Error: Only foreign keys of "books" can be accessed in infix filter
```

The `exists` / `FROM` cases work because the infix filter is already inside a subquery, where an inner join can be added naturally. For regular column paths, the filter sits in a LEFT JOIN's ON condition — there is no subquery to host the inner join.

#### Planned: correlated EXISTS in ON condition ([#1361](https://github.com/cap-js/cds-dbs/pull/1361))

PR [#1361](https://github.com/cap-js/cds-dbs/pull/1361) lifts this restriction by rewriting the join-relevant infix filter into a correlated `EXISTS` subquery within the join's ON condition:

```sql
-- Input
SELECT from Books { author[books.genre.name = 'Drama'].name }

-- Planned output
SELECT from Books
  left join Authors as author
    on author.ID = Books.author_ID and exists (
      SELECT 1 from Authors as Authors2
        inner join Books  as books on books.author_ID = Authors2.ID
        inner join Genres as genre on genre.ID = books.genre_ID
      where genre.name = 'Drama' and Authors2.ID = author.ID
    )
{ author.name as author_name }
```

The same concept applies to expand subqueries. When the infix filter is on the expand leaf, the inner join is added directly in the correlated subquery:

```sql
-- Input
SELECT from Books { author[books.title = 'foo'] { name } }

-- Planned output
SELECT from Books {
  (SELECT author.name from Authors as author
    inner join Books as books on books.author_ID = author.ID
   where Books.author_ID = author.ID and books.title = 'foo') as author
}
```

Nested infix filters with join-relevant paths at multiple levels produce nested EXISTS subqueries:

```sql
-- Input
SELECT from Books {
  author[books[genre.name = 'Science Fiction'].title = 'Sunlit Man'].name
}

-- Planned output
SELECT from Books
  left join Authors as author
    on author.ID = Books.author_ID and exists (
      SELECT 1 from Authors as Authors2
        inner join Books as books
          on books.author_ID = Authors2.ID and exists (
            SELECT 1 from Books as Books3
              inner join Genres as genre on genre.ID = Books3.genre_ID
            where genre.name = 'Science Fiction' and Books3.ID = books.ID
          )
      where books.title = 'Sunlit Man' and Authors2.ID = author.ID
    )
{ author.name as author_name }
```
