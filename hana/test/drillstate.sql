SELECT
  name,
  descr,
  ID,
  "$$PARENT_ID$$" AS parent_ID,
  NODE_ID,
  PARENT_ID,
  (HIERARCHY_LEVEL -1) AS DistanceFromRoot,
  CASE
    WHEN DESCENDANTCOUNT = 1 THEN 'leaf'
    WHEN HIERARCHY_TREE_SIZE = 1 THEN 'collapsed'
    ELSE 'expanded'
  END AS DrillState,
  (HIERARCHY_TREE_SIZE - 1) AS LimitedDescendantCount,
  (HIERARCHY_RANK -1) AS "RANK"
FROM
  HIERARCHY_DESCENDANTS_AGGREGATE(
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
    ) MEASURES (COUNT(*) AS DESCENDANTCOUNT)
    -- WHERE -- TODO: Find out what we can address inside this WHERE clause
  )