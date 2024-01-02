namespace compositions;

entity Supplement {
  key ID : Integer;
  name  : String(111);
  booking : Association to Booking;
}

entity Booking {
  key ID : Integer;
  name   : String(111);
  travel: Association to Travel;
  supplements  : Composition of many Supplement on supplements.booking = $self;
}

entity Travel {
  key ID : Integer;
  name   : String(111);
  bookings  : Composition of many Booking on bookings.travel = $self;
}