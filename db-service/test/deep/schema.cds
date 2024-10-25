entity Root {
    key ID          : Integer;
        toOneChild  : Composition of one Child;
        toManyChild : Composition of many Child;
}

entity Child {
    key ID             : Integer;
        toOneSubChild  : Composition of one SubChild;
        toManySubChild : Composition of many SubChild;
        toOneChild     : Composition of one Child;
        toManyChild    : Composition of many Child;
        text           : String;
}

entity SubChild {
    key ID      : Integer;
        subText : String
}

entity Recursive {
    key ID             : Integer;
        toOneRecursive : Composition of one Recursive;
        toOneTransient : Composition of one Transient;
}

entity Transient {
    key ID             : Integer;
        toOneRecursive : Composition of one Recursive;
}

entity BaseRoot {
  key ID: Integer;
  toOneChild: Composition of one ProjChild;
}

entity BaseChild {
  key ID: Integer;
      text: String;
}

entity ProjRoot as projection on BaseRoot {
  ID as rID,
  toOneChild as rToOneChild
}

entity ProjChild as projection on BaseChild {
  ID as rID,
  text as rText
}

service keyAssocs {
    entity Header {
    key uniqueName : String(50);
    key realm      : String(50);
        l1s  : Composition of many L1 on l1s.header = $self;
}


entity L1 {
    key ID: UUID;
    key header              : Association to Header;
        number              : Integer;
        l2s    : Composition of many L2 on l2s.l1 = $self;
}

entity L2 {
    key ID: UUID;
    key l1    : Association to L1;
        percentage  : Double;
}
}

service bla {
    entity RootUUID {
        key ID         : UUID;
            name       : String;
            toOneChild : Composition of one ChildUUID;
            toManySkip : Composition of many skipChild 
                             on toManySkip.backlink = $self;
            toOneSkip  : Composition of one skipChild;
    }
    @cds.persistence.skip: false
    entity ChildUUID {
        key ID             : UUID;
            text           : String;
            toManySubChild : Composition of many SubChildUUID
                                 on toManySubChild.backlink = $self;

    }

    entity SubChildUUID {
        key ID             : UUID;
            text           : String;
            backlink       : Association to ChildUUID;
            toOneSkipChild : Composition of one skipChild;
    }

    @cds.persistence.skip
    entity skipChild {
        key ID       : UUID;
            text     : String;
            backlink : Association to RootUUID;
    }

    entity SProjRoot as projection on ProjRoot;
    entity SProjChild as projection on ProjChild;
}


