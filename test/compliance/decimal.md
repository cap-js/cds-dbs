## decimal test

```cds
entity number {
  ...
  decimal   : cds.Decimal(5, 4);
}
```

```javascript
await INSERT([
  { decimal: 1.0 },
  { decimal: 0.1 },
  { decimal: 9 },
]).into(number)

const result = await cds.run(`SELECT decimal, cast(decimal as ${cds.requires.db.impl === '@cap-js/hana' ? 'nvarchar' : 'text'}) as string FROM ${number}`)
```

All databases pad their `decimal` numbers. Even `SQLite3` does as `1.0` could have been `1`. It is important to keep in mind that `SQLite3` doesn't have a `scale` setting for their `real` data type. There for the `scale` of a `real` is still showing in the string result as `>0`. Where an `integer` has in implicit `scale` of `0`.

### HANA

```bash
hana-client [
  { DECIMAL: '1.0000', STRING: '1.0000' },
  { DECIMAL: '0.1000', STRING: '0.1000' },
  { DECIMAL: '9.0000', STRING: '9.0000' }
]

hdb [
  { DECIMAL: '1.0000', STRING: '1.0000' },
  { DECIMAL: '0.1000', STRING: '0.1000' },
  { DECIMAL: '9.0000', STRING: '9.0000' }
]
```

### Postgres

```bash
pg [
  { decimal: '1.0000', string: '1.0000' },
  { decimal: '0.1000', string: '0.1000' },
  { decimal: '9.0000', string: '9.0000' }
]
```

### SQLite3

in SQLite3 `real` doesn't have a `scale`

```bash
node:sqlite [
  [Object: null prototype] { decimal: 1, string: '1.0' },
  [Object: null prototype] { decimal: 0.1, string: '0.1' },
  [Object: null prototype] { decimal: 9, string: '9.0' }
]

better-sqlite3 [
  { decimal: 1, string: '1.0' },
  { decimal: 0.1, string: '0.1' },
  { decimal: 9, string: '9.0' }
]

sql.js [
  { decimal: 1, string: '1.0' },
  { decimal: 0.1, string: '0.1' },
  { decimal: 9, string: '9.0' }
]
```

### CAP java

```bash
# default
{
  "@context": "$metadata#literals_number",
  "@metadataEtag": "W/\"c72c5a00be9537eedd1442260745701d7d9f650d6c0130980629e7672af0bf94\"",
  "value": [
    { "decimal": 1.0000 },
    { "decimal": 0.1000 }
  ]
}

# Accept:'application/json;IEEE754Compatible=true'
{
  "@context": "$metadata#literals_number",
  "@metadataEtag": "W/\"c72c5a00be9537eedd1442260745701d7d9f650d6c0130980629e7672af0bf94\"",
  "value": [
    { "decimal": "1.0000" },
    { "decimal": "0.1000" }
  ]
}
```
