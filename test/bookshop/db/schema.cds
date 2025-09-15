using {
  Currency,
  managed,
  sap
} from '@sap/cds/common';

namespace sap.capire.bookshop;

entity Books : managed {
  key ID             : Integer;
      @assert: (case
        when title is null  then 'is missing'
        when trim(title)='' then 'must not be empty'
      end)
      title          : localized String(111);
      descr          : localized String(1111);
      @assert: (case
        when author is null then 'is missing'
        when not exists author then 'does not exist'
        when sum(author.books.price) > 111 then author.name || ' already earned too much with their books'
        when count(author.books.ID) -1 > 1 then author.name || ' already wrote too many books'
      end)
      author         : Association to Authors;
      @assert: (case
        when genre is null then null // genre may be null
        when not exists genre then 'does not exist'
      end)
      genre          : Association to Genres;
      @assert: (case
        when stock <= 0 then 'must be a positive number'
      end)
      stock          : Integer;
      @assert: (case
        // when price is not null and not price between 0 and 500 then 'must be between 0 and 500'
        when price <= 0 or price > 500 then 'must be between 0 and 500'
        when price is null and exists author.books.genre[name = 'Drama']
          then 'Price must be specified for books by drama queens'
      end)
      price          : Decimal;
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
