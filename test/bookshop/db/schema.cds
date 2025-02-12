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
      // @assert.constraint: ( stock <= price ) //> implicit name: @assert.constraint.stock
      // default message: @assert.constraint.stock failed (lookup in i18n)
      // 
      // @assert.constraint: { //> implicit name: @assert.constraint.stock
      //   condition: ( stock <= price ),
      //   message: '{i18n>stockLessThanPrice}'
      // }
      @assert.constraint.stockNotEmpty : {
        condition: ( stock >= 0 ),
        message: 'The stock must be greater than or equal to 0',
        parameters: []     // to be inserted into the message
      } 
      // @assert.constraint : {
      //   condition: ( stock <= price ),
      //   message: 'The stock must be less than or equal to price',
      //   parameters: []     // to be inserted into the message
      // } 
      stock          : Integer;
      price          : Decimal;
      // one of the tests inserts a very big decimal which
      // collides with our constraint above :D
      dummyDecimal   : Decimal;
      currency       : Currency;
      image          : LargeBinary @Core.MediaType: 'image/png';
      footnotes      : array of String;
      authorsAddress : String = author.address;
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

entity Values {
  key ID    : Integer;
      value : String;
}

entity BooksAnnotated as projection on Books;
