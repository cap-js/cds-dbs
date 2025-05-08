# redirected-to-complex

The redirected target is a complex view, for example, contains a JOIN or UNION.

The message's severity is `Info` and is raised by the compiler.
It is emitted to help developers identify possible modeling issues.

## Example

Erroneous code example:

```cds
entity Main {
    key id : Integer;
    // self association for example purpose only
    toMain : Association to one Main;
}
entity Secondary {
    content: String;
};
entity CrossJoin as SELECT from Main, Secondary;
entity RedirectToComplex as projection on Main {
    id,
    toMain: redirected to CrossJoin, // ❌
};
```

`Main:toMain` is a to-one association.  Since `Main` contains a single key,
which is used in the managed association, we know that following the
association returns a single result.

The cross join in the view `CrossJoin` results in multiple rows with the same
`id`.  Following the redirected view now returns multiple results, effectively
making the to-one association a to-many association.

Visualizing the tables with a bit of data, this issue becomes obvious:

```markdown
Main                        Secondary
| id  | toMain_id |         | content |
|-----|-----------|         |---------|
| 1   | 2         |         | 'Hello' |
| 2   | 1         |         | 'World' |

CrossJoin
| id  | toMain_id | content |
|-----|-----------|---------|
| 1   | 2         | 'Hello' |
| 1   | 2         | 'World' |
| 2   | 1         | 'Hello' |
| 2   | 1         | 'World' |
```

## How to Fix

First, ensure that the redirected association points to an entity that is
a reasonable redirection target.  That means, the redirection target shouldn't
accidentally make it a to-many association.

Then add an explicit ON-condition or explicit foreign keys to the redirected
association.  That will silence the compiler message.

## Related Messages

- `redirected-to-ambiguous`
- `redirected-to-unrelated`
