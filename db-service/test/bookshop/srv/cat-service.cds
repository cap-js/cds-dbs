using { bookshop as my } from '../db/schema';
service CatalogService @(path:'/browse') {

  /** For displaying lists of Books */
  @readonly entity ListOfBooks as projection on Books
  excluding { descr };

  /** For display in details pages */
  @readonly entity Books as projection on my.Books { *,
    author.name as author
  } excluding { createdBy, modifiedBy };

  // @requires: 'authenticated-user'
  action submitOrder ( book: Books:ID, amount: Integer ) returns { stock: Integer };
  event OrderedBook : { book: Books:ID; amount: Integer; buyer: String };

  entity RootP  as
        projection on my.Root {
            key ID,
                children
        };

    entity ChildP as
        projection on my.Child {
            key ID,
                parent
        }
}
