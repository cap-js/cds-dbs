entity Foo {
  key ID: Integer;
  a: String;
  b: String;
  c: String;
  x: Integer;
}

entity Foo2 {
  key ID: Integer;
  name: String;
  a: Integer;
  virtual something : String(11);
}

entity Books  {
  key ID   : Integer;
  author : Composition of Author ;
  descr : String;
  code : String;
}

entity Author {
    key id : Integer;
    key version : String;
    parent : Association to Books;
  }
  
entity Travel {
  key TravelUUID : UUID;
  TravelID       : Integer @readonly default 0;
  BeginDate      : Date;
  EndDate        : Date;
  BookingFee     : Decimal(16, 3);
  TotalPrice     : Decimal(16, 3) @readonly;
  Description    : String(1024);
  to_Booking     : Composition of many Booking on to_Booking.to_Travel = $self;
};

entity Booking {
  key BookingUUID   : UUID;
  FlightPrice       : Decimal(16, 3);
  to_BookSupplement : Composition of many BookingSupplement on to_BookSupplement.to_Booking = $self;
  to_Travel         : Association to Travel;
};

entity BookingSupplement {
  key BookSupplUUID   : UUID;
  Price               : Decimal(16, 3);
  to_Booking          : Association to Booking;
  to_Travel           : Association to Travel;
};

entity DBDeepEntityChild {
  key ID     : Integer;
      parent : Integer;
      otherName : String;
      otherName2 : String;
}

  entity EProjChild as projection on DBDeepEntityChild {
    ID as IDRename,
    parent as parentRename,
    otherName as otherNameRename,
    otherName2 as otherName2Rename
  }

entity DBDeepEntity {
  key ID         : Integer;
      parent     : Integer;
      otherName  : String;
      otherName2 : String;
      children   : Composition of many EProjChild
                     on children.parentRename = ID;
}

entity FProjDeep  as projection on DBDeepEntity {
  ID         as IDRename,
  parent     as parentRename,
  otherName  as otherNameRename,
  otherName2 as otherName2Rename,
  children   as childrenRename
}

service RenameService @(path:'/rename') {
  entity SProjDeep as projection on FProjDeep;
}
