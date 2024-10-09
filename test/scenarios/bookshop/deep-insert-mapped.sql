DO (IN input NCLOB => ?)
BEGIN
  DECLARE v_changes INT = 0;
  DECLARE v_l1_index INT = 0;
  DECLARE v_l1_last_index INT = -1;

  -- Parse the incoming root data
  v_sap_capire_bookshop_Genres = SELECT name AS name,descr AS descr,ID AS ID,parent_ID AS parent_ID,_JSON_ AS _JSON_ FROM JSON_TABLE(:input, '$' COLUMNS(name NVARCHAR(1020) PATH '$.name',descr NVARCHAR(4000) PATH '$.descr',ID INT PATH '$.ID',parent_ID INT PATH '$.parent_ID',_JSON_ NVARCHAR(2147483647) FORMAT JSON PATH '$') ERROR ON ERROR);

  -- Take root level update count to return "changes" result
  v_changes = record_count(:v_sap_capire_bookshop_Genres);

  -- This is bookshop.Genres and the composition is recursive so it need to keep going until no new genres are left
  WHILE record_count(:v_sap_capire_bookshop_Genres) > 0 DO
    -- Insert the current contents of "v_sap_capire_bookshop_Genres" as it will be overwritten in this loop
    INSERT INTO sap_capire_bookshop_Genres (name,descr,ID,parent_ID) SELECT name,descr,ID,parent_ID FROM :v_sap_capire_bookshop_Genres;
    -- Select all the children with their parent ID propogated (mostly the same as the root data JSON_TABLE, but with parent_ID prefixed)
    v_sap_capire_bookshop_Genres =
      WITH SRC AS (SELECT _JSON_ FROM :v_sap_capire_bookshop_Genres)
      SELECT name AS name,descr AS descr,ID AS ID,parent_ID as parent_ID,_JSON_ AS _JSON_ FROM JSON_TABLE(SRC._JSON_, '$' COLUMNS(parent_ID INT PATH '$.ID', children NVARCHAR(2147483647) FORMAT JSON PATH '$.children', NESTED PATH '$.children[*]' COLUMNS(name NVARCHAR(1020) PATH '$.name',descr NVARCHAR(4000) PATH '$.descr',ID INT PATH '$.ID',_JSON_ NVARCHAR(2147483647) FORMAT JSON PATH '$')) ERROR ON ERROR)
      WHERE LENGTH(children) > 2; -- Prevent parents to show up that have no children as "JSON_TABLE" does (SELECT * FROM PARENT LEFT JOIN PARENT.CHILDREN) So the parent also shows up when it does not have children
  END WHILE;

  -- Removed texts as it is not being used currently

  -- Debugging output queries to see intermediate results:
  -- SELECT * FROM :v_sap_capire_bookshop_Genres;
  -- INSERT INTO sap_capire_bookshop_Genres (name,descr,ID,parent_ID) SELECT name,descr,ID,parent_ID FROM :v_sap_capire_bookshop_Genres;
  -- INSERT INTO sap_capire_bookshop_Genres_texts (locale,name,descr,ID) SELECT locale,name,descr,ID FROM :v_sap_capire_bookshop_Genres_texts;
  -- SELECT * FROM sap_capire_bookshop_Genres;

  SELECT v_changes as "changes" FROM DUMMY;
END;