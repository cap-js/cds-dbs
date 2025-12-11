// dont use virtual key `isActiveEntity` in `UPDATE … where (<key>) in <subquery>`
// in case of path expressions
namespace update;

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

entity Orders {
  key ID: UUID;
  Items: composition of many {
    key book: Association to Books;
    price: Decimal = book.stock * 2;
  }
}

service CatalogService {
   @odata.draft.enabled
   entity Books as projection on update.Books;

   entity Authors as projection on update.Authors;
}
