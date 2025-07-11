SELECT *,
    '$[' || lpad("$$RN$$", 6, '0') as _path_
FROM (
        SELECT *,
            ROW_NUMBER() OVER () as "$$RN$$"
        FROM (
                SELECT "$A".ID
                FROM sap_capire_bookshop_Authors as "$A"
            ) as "$A"
    ) as "$A"