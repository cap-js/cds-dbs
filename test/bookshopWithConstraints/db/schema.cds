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
      @assert.constraint.stockNotEmpty : {
        condition: ( stock >= 0 ),
        message: 'STOCK_NOT_EMPTY',
        parameters: {title: (title), ID: (ID)}     // to be inserted into the message
      }
      stock          : Integer;
      price          : Decimal;
      dummyDecimal   : Decimal;
      currency       : Currency;
      image          : LargeBinary @Core.MediaType: 'image/png';
      footnotes      : array of String;
      authorsAddress : String = author.address;
      pages: Composition of many Pages on pages.book = $self;
}

@assert.constraint : {
  condition: ( book.stock >= number ),
  parameters: {book: (book.title), number: (number), stock: (book.stock)},
  message: 'STOCK_GREATER_THAN_PAGES',
}
entity Pages : managed {
  key number    : Integer;
  key book  : Association to Books;
      text  : String(1111);
}

@assert.constraint.dates : {
  condition: ( days_between(dateOfBirth, dateOfDeath) >= 0 ),
  message: 'LIFE_BEFORE_DEATH',
  parameters: [(dateOfBirth), (name), (dateOfDeath)]
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

annotate Genres:name with @assert.constraint: {condition: (length(name) <= 25), parameters: [(name)], message: 'GENRE_NAME_TOO_LONG'};

entity A : managed {
  key ID  : Integer;
      B   : Integer;
      toB : Composition of many B
              on toB.ID = $self.B;
      C   : Integer;
      toC : Composition of many C
              on toC.ID = $self.C;
}

@assert.constraint.foreign: {
  condition: (A != 42),
  message: 'A must not be 42',
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

entity Values {
  key ID    : Integer;
      value : String;
}

entity BooksAnnotated as projection on Books;
