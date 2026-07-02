-- DEBUG => this.dbc._native.prepare(cds.utils.fs.readFileSync(__dirname + '/deep-genres.sql','utf-8')).exec([JSON.stringify(query.UPDATE.data)])
DO (IN JSON NCLOB => ?) BEGIN

  -- Extract genres with a depth of 3 (like: '$.children[*].children[*]')
  Genres = SELECT
    NEW.name,
    NEW."$.NAME",
    NEW.descr,
    NEW."$.DESCR",
    NEW.ID,
    NEW."$.ID",
    NEW.parent_ID,
    NEW."$.PARENT_ID",
    NEW."$.CHILDREN"
  FROM 
    JSON_TABLE(
      :JSON,
      '$' COLUMNS(
        name NVARCHAR(1020) PATH '$.name',
        "$.NAME" NVARCHAR(2147483647) FORMAT JSON PATH '$.name',
        descr NVARCHAR(4000) PATH '$.descr',
        "$.DESCR" NVARCHAR(2147483647) FORMAT JSON PATH '$.descr',
        ID INT PATH '$.ID',
        "$.ID" NVARCHAR(2147483647) FORMAT JSON PATH '$.ID',
        parent_ID INT PATH '$.parent_ID',
        "$.PARENT_ID" NVARCHAR(2147483647) FORMAT JSON PATH '$.parent_ID',
        "$.CHILDREN" NVARCHAR(2147483647) FORMAT JSON PATH '$.children'
      )
      ERROR ON ERROR
    ) AS NEW
      UNION ALL
  SELECT
    NEW.name,
    NEW."$.NAME",
    NEW.descr,
    NEW."$.DESCR",
    NEW.ID,
    NEW."$.ID",
    NEW.parent_ID,
    NEW."$.PARENT_ID",
    NEW."$.CHILDREN"
  FROM 
    JSON_TABLE(
      :JSON,
      '$.children[*]' COLUMNS(
        name NVARCHAR(1020) PATH '$.name',
        "$.NAME" NVARCHAR(2147483647) FORMAT JSON PATH '$.name',
        descr NVARCHAR(4000) PATH '$.descr',
        "$.DESCR" NVARCHAR(2147483647) FORMAT JSON PATH '$.descr',
        ID INT PATH '$.ID',
        "$.ID" NVARCHAR(2147483647) FORMAT JSON PATH '$.ID',
        parent_ID INT PATH '$.parent_ID',
        "$.PARENT_ID" NVARCHAR(2147483647) FORMAT JSON PATH '$.parent_ID',
        "$.CHILDREN" NVARCHAR(2147483647) FORMAT JSON PATH '$.children'
      )
      ERROR ON ERROR
    ) AS NEW
  UNION ALL
  SELECT
    NEW.name,
    NEW."$.NAME",
    NEW.descr,
    NEW."$.DESCR",
    NEW.ID,
    NEW."$.ID",
    NEW.parent_ID,
    NEW."$.PARENT_ID",
    NEW."$.CHILDREN"
  FROM 
    JSON_TABLE(
      :JSON,
      '$.children[*].children[*]' COLUMNS(
        name NVARCHAR(1020) PATH '$.name',
        "$.NAME" NVARCHAR(2147483647) FORMAT JSON PATH '$.name',
        descr NVARCHAR(4000) PATH '$.descr',
        "$.DESCR" NVARCHAR(2147483647) FORMAT JSON PATH '$.descr',
        ID INT PATH '$.ID',
        "$.ID" NVARCHAR(2147483647) FORMAT JSON PATH '$.ID',
        parent_ID INT PATH '$.parent_ID',
        "$.PARENT_ID" NVARCHAR(2147483647) FORMAT JSON PATH '$.parent_ID',
        "$.CHILDREN" NVARCHAR(2147483647) FORMAT JSON PATH '$.children'
      )
      ERROR ON ERROR
    ) AS NEW;

  -- DELETE all children of parents that are no longer in the dataset
  DELETE FROM TestService_Genres WHERE
    (parent_ID) IN (SELECT ID FROM :Genres WHERE "$.CHILDREN" IS NOT NULL)
    AND
    (ID) NOT IN (SELECT ID FROM :Genres);
  
  -- UPSERT new deep genres entries
  UPSERT sap_capire_bookshop_Genres (name, descr, ID, parent_ID)
  SELECT
    CASE
        WHEN OLD.ID IS NULL THEN NEW.name
        ELSE (
            CASE
                WHEN "$.NAME" IS NULL THEN OLD.name
                ELSE NEW.name
            END
        )
    END as name,
    CASE
        WHEN OLD.ID IS NULL THEN NEW.descr
        ELSE (
            CASE
                WHEN "$.DESCR" IS NULL THEN OLD.descr
                ELSE NEW.descr
            END
        )
    END as descr,
    NEW.ID as ID,
    CASE
        WHEN OLD.ID IS NULL THEN NEW.parent_ID
        ELSE (
            CASE
                WHEN "$.PARENT_ID" IS NULL THEN OLD.parent_ID
                ELSE NEW.parent_ID
            END
        )
    END as parent_ID
  FROM
      :Genres AS NEW
      LEFT JOIN sap_capire_bookshop_Genres AS OLD ON NEW.ID = OLD.ID;
END;