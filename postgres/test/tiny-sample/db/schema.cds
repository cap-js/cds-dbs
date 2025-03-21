namespace my.bookshop;

entity Books {
  key ID : Integer;
  title  : String;
  stock  : Integer;
  author : Association to Authors;
}

entity Authors {
    key ID : Integer;
}
