namespace complex.associations.unmanaged;

entity Root {
  key ID                 : Integer;
      fooRoot            : String(111);
      children_ID        : Integer;
      children           : Composition of many Child
                             on children.ID = $self.children_ID;
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