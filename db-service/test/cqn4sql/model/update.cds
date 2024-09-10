// dont use virtual key `isActiveEntity` in `UPDATE … where (<key>) in <subquery>`
// in case of path expressions
namespace bookshop;

entity Books {
  key ID : Integer;
  title  : String;
  stock  : Integer;
  author : Association to Authors;
}

entity Authors {
  key ID : Integer;
  name   : String;
  alive  : Boolean;
}

service CatalogService {
    @odata.draft.enabled
    @readonly entity Books as projection on bookshop.Books;

    @readonly entity Authors as projection on bookshop.Authors;
}