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
