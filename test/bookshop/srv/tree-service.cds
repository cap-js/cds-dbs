using {sap.capire.bookshop as my} from '../db/schema';


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
}
