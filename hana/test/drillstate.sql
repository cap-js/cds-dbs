SELECT
  name,
  descr,
  ID,
  "$$PARENT_ID$$" AS parent_ID,
  NODE_ID,
  PARENT_ID,
  (HIERARCHY_LEVEL -1) AS DistanceFromRoot,
  (HIERARCHY_TREE_SIZE - 1) AS LimitedDescendantCount,
  (hierarchy_distance) AS Distance,
  (HIERARCHY_RANK -1) AS "RANK"
FROM
  HIERARCHY_DESCENDANTS(
    SOURCE HIERARCHY(
      SOURCE (
        SELECT
          Genres.name,
          Genres.descr,
          Genres.ID,
          Genres.parent_ID as "$$PARENT_ID$$",
          ID AS NODE_ID,
          parent_ID as PARENT_ID
        FROM
          sap_capire_bookshop_Genres as Genres
      )
      START WHERE parent_ID IS NULL
    )
    START WHERE parent_ID IS NULL
  )