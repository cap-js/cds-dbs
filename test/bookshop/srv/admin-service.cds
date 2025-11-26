using { sap.capire.bookshop as my } from '../db/schema';
service AdminService @(requires:'admin', path:'/admin') {
  entity Books as projection on my.Books;
  entity Authors as projection on my.Authors;
  entity A as projection on my.A;

  @cds.redirection.target: false
  entity RenameKeys as projection on my.Books {
    key ID as foo,
    author,
    author.name
  }
  entity Foo {
    key ID : Integer;
    bar : Association to one Bar;
  }

  entity Bar {
    key ID : Integer;
    key baz : Association to one Baz;
  }

  entity Baz {
    key code : String;
  }

  entity duplicateElements as projection on Foo {
    ID,
    bar.baz as barBaz @readonly,
    bar
  }

}
