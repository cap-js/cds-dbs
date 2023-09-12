INSERT INTO
  sap_capire_bookshop_Books (
    createdAt,
    createdBy,
    modifiedAt,
    modifiedBy,
    ID,
    title,
    descr,
    author_ID,
    genre_ID,
    stock,
    price,
    currency_code,
    image
  )
SELECT
  coalesce(
    ISO(value ->> '$."createdAt"'),
    session_context('$now')
  ),
  coalesce(
    value ->> '$."createdBy"',
    session_context('$user.id')
  ),
  coalesce(
    ISO(value ->> '$."modifiedAt"'),
    session_context('$now')
  ),
  coalesce(
    value ->> '$."modifiedBy"',
    session_context('$user.id')
  ),
  value ->> '$."ID"',
  value ->> '$."title"',
  value ->> '$."descr"',
  value ->> '$."author_ID"',
  value ->> '$."genre_ID"',
  value ->> '$."stock"',
  value ->> '$."price"',
  value ->> '$."currency_code"',
  value ->> '$."image"'
FROM
  json_each(?);

UPDATE
  sap_capire_bookshop_Books AS Books
SET
  ID = 777,
  modifiedAt = coalesce(ISO(NULL), session_context('$now')),
  modifiedBy = coalesce(NULL, session_context('$user.id'))
;