using { Currency, managed, sap } from '@sap/cds/common';
namespace sap.capire.bookshop;

entity Books : managed {
  key ID : Integer;
  title  : localized String(111);
  descr  : localized String(1111);
  author : Association to Authors;
  genre  : Association to Genres;
  stock  : Integer;
  price  : Decimal;
  currency : Currency;
  image : LargeBinary @Core.MediaType : 'image/png';
  footnotes: array of String;
}

entity Authors : managed {
  key ID : Integer;
  name   : String(111);
  dateOfBirth  : Date;
  dateOfDeath  : Date;
  placeOfBirth : String;
  placeOfDeath : String;
  books  : Association to many Books on books.author = $self;
}

/** Hierarchically organized Code List for Genres */
entity Genres : sap.common.CodeList {
  key ID   : Integer;
  parent   : Association to Genres;
  children : Composition of many Genres on children.parent = $self;
}

entity A : managed {
  key ID  : Integer;
      B   : Integer;
      toB : Composition of many B
              on toB.ID = $self.B;
      C   : Integer;
      toC : Composition of many C
              on toC.ID = $self.C;
}

entity B : managed {
  key ID  : Integer;
      A   : Integer;
      toA : Composition of many A
              on toA.ID = $self.A;

      C   : Integer;
      toC : Composition of many C
              on toC.ID = $self.C;
}

entity C : managed {
  key ID  : Integer;
      A   : Integer;
      toA : Composition of many A
              on toA.ID = $self.A;
      B   : Integer;
      toB : Composition of many B
              on toB.ID = $self.B;
}
