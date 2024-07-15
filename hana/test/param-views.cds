using {sap.capire.bookshop.Books as Books} from '../../test/bookshop/db/schema.cds';

namespace sap.capire.bookshop;

entity ParamBooks(available : Integer) as
    select from Books {
        ID,
        title,
        stock,
        // Take foreign key for author association
        author.ID as author_ID,
        // author, Compiler does not like associations in parameterized views
    }
    where
        stock <= :available;
