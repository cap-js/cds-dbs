using {
  Currency,
  managed,
  sap
} from '@sap/cds/common';

namespace sap.capire.bookshop;

@(
  cds.remote.source: 'Northwind',
  cds.remote.entity: 'Products'
)
entity Products {
  CategoryID      : Integer;
  Discontinued    : Boolean;
  ProductID       : Integer;
  ProductName     : String;
  QuantityPerUnit : String;
  ReorderLevel    : Int16;
  SupplierID      : Integer;
  UnitPrice       : Decimal;
  UnitsInStock    : Int16;
  UnitsOnOrder    : Int16;
  Supplier        : Association to one Suppliers
                      on SupplierID = Supplier.SupplierID;
}

@(
  cds.remote.source: 'Northwind',
  cds.remote.entity: 'Suppliers'
)
entity Suppliers {
  SupplierID   : Integer;
  CompanyName  : String;
  ContactName  : String;
  ContactTitle : String;
  Address      : String;
  City         : String;
  Region       : String;
  PostalCode   : String;
  Country      : String;
  Phone        : String;
  Fax          : String;
  HomePage     : String;
  Products     : Association to many Products
                   on SupplierID = Products.SupplierID;
}

type HANABool  : String(5); // REVISIT: stored as TRUE/FALSE would be good to be a boolean

@(
  cds.remote.source: 'Self',
  cds.remote.schema: 'SYSTEM',
  cds.remote.entity: 'TARGET',
  cds.remote.replicated // Creates the default behavior RTR replication
)
entity Target {
  key ID     : Integer;
      ![KEY] : String(255);
      VALUE  : String(255);
}

@(
  cds.remote.source: 'Bookshop',
  cds.remote.entity: 'Books'
)
entity Books : managed {
  key ID             : Integer;
      title          : localized String(111);
      descr          : localized String(1111);
      author         : Association to Authors;
      genre          : Association to Genres default 10;
      stock          : Integer;
      price          : Decimal;
      currency       : Currency;
      image          : LargeBinary @Core.MediaType: 'image/png';
      footnotes      : array of String;
      authorsAddress : String = author.address;
}

@(
  cds.remote.source: 'Bookshop',
  cds.remote.entity: 'Authors'
)
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
