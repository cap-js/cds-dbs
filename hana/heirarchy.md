
- virtual columns
  - rank => hierarchy_rank : Integer64;
  - DistanceFromRoot => hierarchy_level - 1  : Integer64;
  - LimitedDescendantCount => hierarchy_tree_size - 1
  - DrillState => inter.hierarchy_tree_size = 1 ? 'leaf' : result.hierarchy_tree_size = 1 'collapsed' : 'expanded' : String;
  - Matched => exists ? (ask java) : Boolean;
  - MatchedDescendantCount => exists ? (ask java) : Integer64;

- where => start
- search => where: [{xpr:where},'and',{func:'search',args:search}]
- recurse.where => where outside of heirarchy function
  - detect distance for direction
    - '=' {val} < 0 : ancestors : descendants
    - '<=' = ancestors
    - '>=' = descendants
    - 'between' {val} < 0 : ancestors : descendants
  - only distance (optional) => distance
    - distance = {val} => from/to
    - distance between {val} and {val} => from {min val} to {max val}
    - distance <=/>= {val} => from/to
  - DistanceFromRoot => (HIERARCHY_LEVEL - 1)
    - where clause outside of heirarchy function

- orderBy => sibling
- limit => (make sure it works)

```sql
SELECT ID,NAME, (CASE WHEN hierarchy_tree_size = 1 THEN 'leaf' ELSE 'not leaf' END) AS "DrillState", hierarchy_distance FROM HIERARCHY_ANCESTORS (
  SOURCE HIERARCHY (
    SOURCE (SELECT HIERARCHY_COMPOSITE_ID(ID) AS NODE_ID, HIERARCHY_COMPOSITE_ID(PARENT_ID) AS PARENT_ID, ID, NAME, DESCR FROM SAP_CAPIRE_BOOKSHOP_GENRES ORDER BY NAME)
  )
  START WHERE ID = 22
) WHERE HIERARCHY_DISTANCE <= -1
```