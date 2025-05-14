using {sap.capire.bookshop.Books as Books} from '../../test/bookshop/db/schema.cds';

namespace sap.capire.bookshop;

@cds.persistence.exists
@cds.persistence.calcview
entity CalcAuthors(NAME : String) {
  key ID    : Integer;
      NAME  : String(111);
      books : Association to many Books
                on ID = books.author.ID;
}

view PublicCalcAuthors(name : String) as
  select from CalcAuthors (
    NAME: :name
  );
