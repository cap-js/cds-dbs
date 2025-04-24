using {
  Currency,
  managed,
  sap
} from '@sap/cds/common';

namespace sap.capire.bookshop;

entity Books : managed {
  key ID             : Integer;
      title          : localized String(111);
      descr          : localized String(1111);
      author         : Association to Authors;
      genre          : Association to Genres default 10;
      stock          : Integer;
      price          : Decimal;
      dummyDecimal   : Decimal;
      currency       : Currency;
      image          : LargeBinary @Core.MediaType: 'image/png';
      footnotes      : array of String;
      authorsAddress : String = author.address;
      pages: Composition of many Pages on pages.book = $self;
}

entity Pages : managed {
  key number    : Integer;
  key book  : Association to Books;
      text  : String(1111);
      footnotes: Composition of many {
        key number : Integer;
        text       : String(1111);
      }
}

entity Authors : managed {
  key ID           : Integer;
      name         : String(111);
      dateOfBirth  : Date;
      dateOfDeath  : Date;
      placeOfBirth : String;
      placeOfDeath : String;
      books        : Association to many Books
                       on books.author = $self;

      street       : String;
      city         : String;
      address      : String = street || ', ' || city;
}

/** Hierarchically organized Code List for Genres */
entity Genres : sap.common.CodeList {
  key ID       : Integer;
      parent   : Association to Genres;
      children : Composition of many Genres
                   on children.parent = $self;
}


entity A : managed {
  key ID  : Integer;
      B   : Integer;
      toB : Composition of many B
              on toB.ID = $self.B;
}

entity B : managed {
  key ID  : Integer;
      A   : Integer;
      toA : Composition of many A
              on toA.ID = $self.A;
}

entity BooksAnnotated as projection on Books;
