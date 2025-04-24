namespace my.bookshop;
using { Currency, managed, cuid } from '@sap/cds/common';

entity Products : managed {
  key ID : Integer;
  title  : localized String(111);
  descr  : localized String(1111);
  author : Association to Authors;
  stock  : Integer;
  price  : Decimal(9,2);
  currency : Currency;
}

// intentional indirection through a projection
entity Books as select from Products;
entity Books2 as projection on Books;

entity Authors : managed {
  key ID : Integer;
  name   : String(111);
  dateOfBirth  : Date;
  dateOfDeath  : Date;
  placeOfBirth : String;
  placeOfDeath : String;
  books  : Association to many Books on books.author = $self;
  image : LargeBin;
}

entity Orders : cuid, managed {
  OrderNo  : String;
  descr  : localized String(1111);
  total    : Decimal(9,2);
  currency : Currency;
}

@cds.persistence.skip
entity Imported {
  key ID : String;
}

@cds.persistence.skip: 'if-unused'
entity Unused {
  key ID : String;
}

type LargeBin: LargeBinary;