using {sap.capire.bookshop as my} from '../db/schema';

entity Root {
  key ID     : Integer;
      name   : String;
      genres : Composition of many my.Genres
                 on genres.root = $self;
}

extend my.Genres with {
  root : Association to Root;
};


@path: '/tree'
service TreeService {
  entity Genres as
    projection on my.Genres {
      *,
      null as LimitedDescendantCount,
      null as DistanceFromRoot,
      null as DrillState,
      null as Matched,
      null as MatchedDescendantCount,
      null as LimitedRank,
    };

    annotate Genres with @Aggregation.RecursiveHierarchy#GenresHierarchy: {
      $Type                   : 'Aggregation.RecursiveHierarchyType',
      NodeProperty            : ID,
      ParentNavigationProperty: parent
    };

  entity RootComp as projection on Root;
}
