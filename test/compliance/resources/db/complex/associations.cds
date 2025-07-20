namespace complex.associations;

entity Root {
  key ID        : Integer;
      fooRoot   : String;
      recursiveToOne : Composition of one Root;
      parent    : Association to Root;
      recursive : Composition of many Root
                    on recursive.parent = $self;
      children  : Composition of many Child
                    on children.parent = $self;
}

entity Child {
  key ID       : Integer;
      fooChild : String;
      parent   : Association to one Root;
      children : Composition of many GrandChild
                   on children.parent = $self;
      static   : Association to many Root
                   on  static.children =  $self
                   and static.ID       >  0
                   and fooChild        != null;
}

entity GrandChild {
  key ID            : Integer;
      fooGrandChild : String;
      parent        : Association to one Child;
}

extend Root with {
  LimitedDescendantCount : Integer = null;
  DistanceFromRoot       : Integer = null;
  DrillState             : String  = null;
  Matched                : Boolean = null;
  MatchedDescendantCount : Integer = null;
  LimitedRank            : Integer = null;
}

entity RootPWithKeys as
  projection on Root {
    key ID,
        fooRoot,
        children,
        null as LimitedDescendantCount,
        null as DistanceFromRoot,
        null as DrillState,
        null as Matched,
        null as MatchedDescendantCount,
        null as LimitedRank,
  };
