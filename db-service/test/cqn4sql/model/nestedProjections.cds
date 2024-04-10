// based on cds.compiler specification which can be found under 'internalDoc/NestedProjectionByExample.md'
entity Employee {
  key id : String;
  name : String;
  job : String;
  department : Association to one Department;
  assets : Association to many Assets on assets.owner = $self;
  office {
    floor : String;
    room : String;
    building : Association to one Building;
    address {
      city : String;
      street : String;
      country : Association to one Country;
    };
    furniture {
      chairs: Integer;
      desks: Integer;
    }
  }
}
// to test inline with `*` as it doesnt suppport unmanaged associations
entity EmployeeNoUnmanaged {
  key id : String;
  name : String;
  job : String;
  department : Association to one Department;
  office {
    floor : String;
    room : String;
    building : Association to one Building;
    address {
      city : String;
      street : String;
      country : Association to one Country;
    };
    furniture {
      chairs: Integer;
      desks: Integer;
    }
  }
}

entity Department {
  key id : String;
  name : String;
  costCenter : String;
  head : Association to one Employee;
}
entity Building {
  key id : String;
  name: String;
}
entity Country {
  key code : String;
}
entity Assets {
  key id : String;
  owner : Association to one Employee;
  descr : String;
  lifetime {
    start : String;
    end : String;
  }
}

entity foo as  select from Employee {
  office.{
    floor,
    room
  }
};

context associationAndCompositionsDataService {
  entity CategoryBackAndForth1 {
  key cID1           : Integer;
  name1: String;
      otherCategory1 : Association to CategoryBackAndForth2;
      parentCategory1 : Association to CategoryBackAndForth1;
      childCategory1 : Composition of many CategoryBackAndForth1
                         on childCategory1.parentCategory1 = $self;
}

entity CategoryBackAndForth2 {
  key cID2           : Integer;
      otherCategory2 : Composition of CategoryBackAndForth1;
      parentCategory2 : Association to CategoryBackAndForth2;
      childCategory2 : Composition of many CategoryBackAndForth2
                         on childCategory2.parentCategory2 = $self;
}


}
