WITH RECURSIVE
  Hierarchy(HIERARCHY_LEVEL,HIERARCHY_PARENT_RANK,HIERARCHY_RANK,HIERARCHY_ROOT_RANK,HIERARCHY_TREE_SIZE,NODE_ID,PARENT_ID,ID,name) AS (
    SELECT 1,0,rowid,rowid,(SELECT COUNT(*) + 1 FROM sap_capire_bookshop_Genres as children WHERE children.parent_ID=root.ID),ID,parent_ID,ID,name 
    FROM sap_capire_bookshop_Genres AS root
    WHERE parent_ID IS NULL
    UNION ALL
    SELECT 
      Hierarchy.HIERARCHY_LEVEL + 1,
      Hierarchy.HIERARCHY_RANK,
      Genres.rowid,
      Hierarchy.HIERARCHY_ROOT_RANK,
      (SELECT COUNT(*) + 1 FROM sap_capire_bookshop_Genres as children WHERE children.parent_ID=Genres.ID),
      Genres.ID,
      Genres.parent_ID,
      Genres.ID,
      Genres.name
    FROM sap_capire_bookshop_Genres AS Genres
    JOIN Hierarchy ON Genres.PARENT_ID=Hierarchy.NODE_ID
    ORDER BY 1 DESC
  ),
  Ancestors(HIERARCHY_LEVEL,HIERARCHY_PARENT_RANK,HIERARCHY_RANK,HIERARCHY_ROOT_RANK,HIERARCHY_TREE_SIZE,HIERARCHY_DISTANCE,NODE_ID,PARENT_ID,ID,name) AS (
    SELECT HIERARCHY_LEVEL,HIERARCHY_PARENT_RANK,HIERARCHY_RANK,HIERARCHY_ROOT_RANK,HIERARCHY_TREE_SIZE,0,NODE_ID,PARENT_ID,ID,name
    FROM Hierarchy AS root
    WHERE name = 'Drama'
    UNION ALL
    SELECT 
      Hierarchy.HIERARCHY_LEVEL,
      Hierarchy.HIERARCHY_PARENT_RANK,
      Hierarchy.HIERARCHY_RANK,
      Hierarchy.HIERARCHY_ROOT_RANK,
      Hierarchy.HIERARCHY_TREE_SIZE,
      Ancestors.HIERARCHY_DISTANCE - 1,
      Hierarchy.NODE_ID,
      Hierarchy.PARENT_ID,
      Hierarchy.ID,
      Hierarchy.name
    FROM Ancestors AS Ancestors
    JOIN Hierarchy AS Hierarchy ON Hierarchy.NODE_ID=Ancestors.PARENT_ID
    ORDER BY 1
  )
SELECT 
  Hierarchy.HIERARCHY_LEVEL,
  Hierarchy.HIERARCHY_PARENT_RANK,
  Hierarchy.HIERARCHY_RANK,
  Hierarchy.HIERARCHY_ROOT_RANK,
  Hierarchy.HIERARCHY_TREE_SIZE,
  Ancestors.HIERARCHY_DISTANCE,
  Hierarchy.NODE_ID,
  Hierarchy.PARENT_ID,
  Hierarchy.ID,
  Hierarchy.name
FROM Hierarchy
INNER JOIN Ancestors
ON Hierarchy.HIERARCHY_RANK = Ancestors.HIERARCHY_RANK