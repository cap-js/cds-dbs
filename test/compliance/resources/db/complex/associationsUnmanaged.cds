namespace complex.associations.unmanaged;

entity Root {
  key ID       : Integer;
      fooRoot  : String(111);
      children : Composition of many Child
                   on children.parent = $self;
      static   : Association to many Child
                   on  static.parent =  $self
                   and static.ID     >  0
                   and fooRoot       != null;
}

entity Child {
  key ID        : Integer;
      fooChild  : String;
      parent_ID : Integer;
      parent    : Association to one Root
                    on parent.ID = $self.parent_ID;
      children  : Composition of many GrandChild
                    on children.parent = $self;
}

entity GrandChild {
  key ID            : Integer;
      fooGrandChild : String;
      parent_ID     : Integer;
      parent        : Association to one Child
                        on parent.ID = $self.parent_ID;
}

extend Root with {
  LimitedDescendantCount : Integer = null;
  DistanceFromRoot       : Integer = null;
  DrillState             : String  = null;
  Matched                : Boolean = null;
  MatchedDescendantCount : Integer = null;
  LimitedRank            : Integer = null;
}
