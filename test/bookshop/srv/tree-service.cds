using {sap.capire.bookshop as my} from '../db/schema';

@path: '/tree'
service TreeService {

  @odata.draft.enabled
  entity Books                 as projection on my.Books;

  @cds.redirection.target
  entity Genres                as
    projection on my.Genres {
      *,
      null as LimitedDescendantCount: Int64,
      null as DistanceFromRoot: Int64,
      null as DrillState: String,
      null as Matched: Int64,
      null as MatchedDescendantCount: Int64,
      null as LimitedRank: Int64,
    };

  annotate Genres with @Aggregation.RecursiveHierarchy #GenresHierarchy: {
    $Type                   : 'Aggregation.RecursiveHierarchyType',
    NodeProperty            : ID,
    ParentNavigationProperty: parent
  };

  entity GenresComp as
    projection on my.Genres {
      *,
      null as LimitedDescendantCount,
      null as DistanceFromRoot,
      null as DrillState,
      null as Matched,
      null as MatchedDescendantCount,
      null as LimitedRank,
      1    as root_ID : Integer,
      root: Association to Root on root.ID = root_ID,
    };

  annotate GenresComp with @Aggregation.RecursiveHierarchy #GenresCompHierarchy: {
    $Type                   : 'Aggregation.RecursiveHierarchyType',
    NodeProperty            : ID,
    ParentNavigationProperty: parent
  };

  entity Root {
    key ID     : Integer;
        name   : String;
        genres : Composition of many GenresComp on genres.root = $self;
  }

  entity GenresWithNodeIdAlias as
    projection on my.Genres {
      ID as node_id, * 
    };

  annotate GenresWithNodeIdAlias with @Aggregation.RecursiveHierarchy #GenresWithNodeIdAliasHierarchy: {
    $Type                   : 'Aggregation.RecursiveHierarchyType', 
    NodeProperty            : ID,
    ParentNavigationProperty: parent
  };

  entity GenresAliases as
    projection on my.Genres {
      null as node_id, *
    };

  annotate GenresAliases with @Aggregation.RecursiveHierarchy #GenresWithNodeIdAliasHierarchy: {
    $Type                   : 'Aggregation.RecursiveHierarchyType', 
    NodeProperty            : ID,
    ParentNavigationProperty: parent
  };
}