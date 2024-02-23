// ORDER / ALTER is a reserved word in the ANSI SQL standard
entity Order {
  key ID : Integer;
  alter: composition of many Alter on alter.order = $self;
}

entity Alter {
  key ID : Integer;
  number: Integer;
  order: Association to Order;
}
