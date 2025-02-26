const cds = require('../../cds.js')
const { Readable } = require('stream')

const { gen, rows, maps } = require('./data.js')
const { run } = require('./perf.js')

describe('Map - Composition', () => {
  const { expect } = cds.test(__dirname, __dirname + '/comp.cds')

  test('perf', async () => {
    const { Map } = cds.entities
    let s, dur

    await cds.run(`DROP TABLE Map_map`)
    await cds.run(`CREATE COLLECTION Map_map`)

    console.log('Starting Insert...')
    s = performance.now()
    await cds.run(insertSQL, [Readable.from(gen(), { objectMode: false })])
    dur = performance.now() - s
    console.log('Finished Insert:', dur, '(', (rows / dur), 'rows/ms)')

    const [{ count: rowCount }] = await cds.ql`SELECT count() FROM ${Map}`
    expect(rowCount).eq(rows)
    console.log('Validated Insert.')

    /*
Starting Insert...
Finished Insert: 11326.809322000001 ( 2.89295944413533 rows/ms)
Validated Insert.
$top=30 (v1)         avg: 2257 ms cold: 2335 ms
$top=30 (v2)         avg: 3877 ms cold: 3875 ms
ID='1'  (v1)         avg: 2236 ms cold: 2281 ms
ID='1'  (v2)         avg: 2249 ms cold: 2295 ms
$top=30 (v1,hint)    avg: 9 ms cold: 35 ms
$top=30 (v2,hint)    avg: 12 ms cold: 32 ms
ID='1'  (v1,hint)    avg: 4 ms cold: 31 ms
ID='1'  (v2,hint)    avg: 2249 ms cold: 2241 ms
    */

    await run(`$top=30 (v1)`, top30SQL1)
    await run(`$top=30 (v2)`, top30SQL2)

    await run(`ID='1'  (v1)`, oneSQL1)
    await run(`ID='1'  (v2)`, oneSQL2)

    const hint = `WITH HINT(SEMI_JOIN_REDUCTION)`
    await run(`$top=30 (v1,hint)`, top30SQL1 + hint)
    await run(`$top=30 (v2,hint)`, top30SQL2 + hint)

    await run(`ID='1'  (v1,hint)`, oneSQL1 + hint)
    await run(`ID='1'  (v2,hint)`, oneSQL2 + hint)
  })

})

const insertSQL = `DO (IN JSON NCLOB => ?) BEGIN
    Map = SELECT * FROM JSON_TABLE(:JSON, '$' COLUMNS(ID NVARCHAR(36) PATH '$.ID',"MAP" NVARCHAR(2147483647) FORMAT JSON PATH '$.map'));

    INSERT INTO "MAP" (ID)
      SELECT NEW.ID FROM :Map AS NEW;
    INSERT INTO Map_map SELECT '{"up__ID":"' || JSON_VALUE("MAP", '$[0].up__ID') || '","data":' || "MAP" || '}' FROM :Map AS NEW;
END;`

const top30SQL1 = `
WITH Map_map as (
  SELECT "up__ID" as up__ID, "data" as data FROM Map_map
),
"MAP" as (
  SELECT
    *,
    '$[' || lpad("$$RN$$", 6, '0') as _path_
  FROM
    (
      SELECT
        *,
        ROW_NUMBER() OVER () as "$$RN$$"
      FROM
        (
          SELECT
            "MAP".ID
          FROM
            "MAP" as "MAP"
          LIMIT
            30
        ) as "MAP"
    ) as "MAP"
),
"Map_map" as (
  SELECT
    *,
    _parent_path_ || '].map[' || lpad("$$RN$$", 6, '0') as _path_
  FROM
    (
      SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY _parent_path_) as "$$RN$$"
      FROM
        (
          SELECT
            map2.data,
            "MAP"._path_ as _parent_path_
          FROM
            "MAP" as "MAP"
            inner JOIN Map_map as map2 on "MAP".ID = up__ID
        ) as map2
    ) as map2
)
SELECT
  *
FROM
  (
    SELECT
      _path_ as "_path_",
      '{}' as "_blobs_",
      '{"map":null}' as "_expands_",
      (
        SELECT
          ID as "ID"
        FROM
          DUMMY FOR JSON (
            'format' = 'no',
            'omitnull' = 'no',
            'arraywrap' = 'no'
          ) RETURNS NVARCHAR(2147483647)
      ) as "_json_"
    FROM
      "MAP"
  )
UNION
ALL (
  SELECT
    _path_ as "_path_",
    '{}' as "_blobs_",
    '{}' as "_expands_",
    data as "_json_"
  FROM
    "Map_map"
)
ORDER BY
  "_path_" ASC
`

const top30SQL2 = `
WITH Map_map as (
  SELECT "up__ID" as up__ID, "data" as data FROM Map_map
)
SELECT
  '$[0' as "_path_",
  '{}' as "_blobs_",
  '{}' as "_expands_",
  (
    SELECT
      ID as "ID",
      map as "map"
    FROM
      DUMMY FOR JSON (
        'format' = 'no',
        'omitnull' = 'no',
        'arraywrap' = 'no'
      ) RETURNS NVARCHAR(2147483647)
  ) as "_json_"
FROM (
  SELECT
    "MAP".ID,
    (SELECT data FROM Map_map WHERE up__ID = "MAP".ID) as map
  FROM
    "MAP" as "MAP"
  LIMIT
    30
)
`

const oneSQL1 = `
WITH Map_map as (
  SELECT "up__ID" as up__ID, "data" as data FROM Map_map
),
"MAP" as (
  SELECT
    *,
    '$[' || lpad("$$RN$$", 6, '0') as _path_
  FROM
    (
      SELECT
        *,
        ROW_NUMBER() OVER () as "$$RN$$"
      FROM
        (
          SELECT
            "MAP".ID
          FROM
            "MAP" as "MAP"
          WHERE
            ID = '1'
        ) as "MAP"
    ) as "MAP"
),
"Map_map" as (
  SELECT
    *,
    _parent_path_ || '].map[' || lpad("$$RN$$", 6, '0') as _path_
  FROM
    (
      SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY _parent_path_) as "$$RN$$"
      FROM
        (
          SELECT
            map2.data,
            "MAP"._path_ as _parent_path_
          FROM
            "MAP" as "MAP"
            inner JOIN Map_map as map2 on "MAP".ID = up__ID
        ) as map2
    ) as map2
)
SELECT
  *
FROM
  (
    SELECT
      _path_ as "_path_",
      '{}' as "_blobs_",
      '{"map":null}' as "_expands_",
      (
        SELECT
          ID as "ID"
        FROM
          DUMMY FOR JSON (
            'format' = 'no',
            'omitnull' = 'no',
            'arraywrap' = 'no'
          ) RETURNS NVARCHAR(2147483647)
      ) as "_json_"
    FROM
      "MAP"
  )
UNION
ALL (
  SELECT
    _path_ as "_path_",
    '{}' as "_blobs_",
    '{}' as "_expands_",
    data as "_json_"
  FROM
    "Map_map"
)
ORDER BY
  "_path_" ASC
`

const oneSQL2 = `
WITH Map_map as (
  SELECT "up__ID" as up__ID, "data" as data FROM Map_map
)
SELECT
  '$[0' as "_path_",
  '{}' as "_blobs_",
  '{}' as "_expands_",
  (
    SELECT
      ID as "ID",
      map as "map"
    FROM
      DUMMY FOR JSON (
        'format' = 'no',
        'omitnull' = 'no',
        'arraywrap' = 'no'
      ) RETURNS NVARCHAR(2147483647)
  ) as "_json_"
FROM (
  SELECT
    "MAP".ID,
    Map_map.data as map
  FROM (
    SELECT
      "MAP".ID
    FROM
      "MAP" as "MAP"
    WHERE
      ID = '1'
  ) as "MAP"
  LEFT JOIN Map_map as Map_map
  ON "MAP".ID = Map_map.up__ID
)
`