using { sap.capire.bookshop as my } from '../db/schema';
service AdminService @(requires:'admin', path:'/admin') {
  entity Books as projection on my.Books;
  entity Authors as projection on my.Authors;

  @cds.redirection.target: false
  entity RenameKeys as projection on my.Books {
    key ID as foo,
    author,
    author.name
  }
}
