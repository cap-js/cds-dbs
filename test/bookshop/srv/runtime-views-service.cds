using {sap.capire.bookshop as my} from '../db/schema';

// Create bookshop namespace for compatibility
context bookshop {
    // Map other entities
    entity Publisher {
        key ID   : UUID;
            name : String;
    };

    entity Edition {
        key ID          : UUID;
            book        : Association to views.Books;
            editionType : Association to EditionType;
    };

    entity EditionType {
        key ID   : UUID;
            name : String;
    };

    entity Category as projection on my.Genres;
}

context views {

    entity Books as
        projection on my.Books {
            *,
            editions : Association to many bookshop.Edition
                           on editions.book = $self
        };

}

service runtimeViews0Service {
    @cds.persistence.skip
    @cds.redirection.target
    entity Author  as projection on my.Authors;

    @cds.persistence.skip
    entity Book    as projection on views.Books;


    @cds.persistence.skip
    entity Edition as projection on bookshop.Edition;

    @cds.persistence.skip
    view AuthorsAndBooks as
    select from Author {
        ID          as commonID,
        name        as commonName,
        'Author'    as type
    }
    union all
    select from Book {
        ID          as commonID,
        title       as commonName,
        'Book'      as type
    };

    @cds.persistence.skip
    view BookWithEditions as
    select from Book
        left join Edition on Edition.ID = Book.ID
    {
        Book.ID,
        Book.title,
        Edition.ID       as editionID
    };
    
    entity AuthorRedirected as projection on Author {
        *,
        books: redirected to my.BookRedirected on books.authorID = $self.ID
    };

}

service runtimeViews1Service {

    entity Book    as
        projection on runtimeViews0Service.Book {
            *,
            ID          as id,
            stock       as count,
            author.name as authorName,
            author.ID   as AuthorId,
            author {
                placeOfBirth,
                dateOfBirth
            }
        }
        excluding {
            ID,
            stock
        };

    entity Edition as
        projection on runtimeViews0Service.Edition {
            book             as parent,
            ID               as editionNumber,
            editionType.name as editionName,
            editionType      as edition,
            change   : Association to Changes
                           on change.ID = editionNumber,
            changes  : Composition of many Changes
                           on changes.editionID = editionNumber,
            external : Composition of many ExternalChanges
                           on external.editionID = editionNumber
        }

    entity Changes as projection on VirtualChanges;

    @cds.persistence.skip
    entity VirtualChanges {
        key ID          : UUID;
            editionID   : UUID;
            description : String;
    }

    @cds.external
    @cds.persistence.skip
    entity ExternalChanges {
        key ID        : UUID;
            editionID : UUID;
    }

}

service runtimeViews2Service {
    entity Book as
        projection on runtimeViews1Service.Book {
            id,
            genre      as category,
            genre.name as categoryName,
            title,
            authorName as AuthorName,
            AuthorId as Authorid
        };
}

service runtimeViewsErrorService {

    @cds.persistence.skip
    entity VirtualBook {
        id    : String;
        title : String
    };

    entity VirtualBookView  as select from VirtualBook;
}

service views0Service {
    @cds.redirection.target
    entity Author  as projection on my.Authors;

    entity Book    as projection on views.Books;

    entity Edition as projection on bookshop.Edition;

    entity AuthorRedirected as projection on Author {
        *,
        books: redirected to my.BookRedirected on books.authorID = $self.ID
    };
}

service views1Service {
    entity Book    as
        projection on views0Service.Book {
            *,
            ID          as id,
            stock       as count,
            author.name as authorName,
            author.ID   as AuthorId,
            author {
                placeOfBirth,
                dateOfBirth
            }
        }
        excluding {
            ID,
            stock
        };

    entity Edition as
        projection on views0Service.Edition {
            book             as parent,
            ID               as editionNumber,
            editionType.name as editionName,
            editionType      as edition,
            change   : Association to Changes
                           on change.ID = editionNumber,
            changes  : Composition of many Changes
                           on changes.editionID = editionNumber,
            external : Composition of many ExternalChanges
                           on external.editionID = editionNumber
        }

    entity Changes as projection on VirtualChanges;

    entity VirtualChanges {
        key ID          : UUID;
            editionID   : UUID;
            description : String;
    }

    @cds.external
    entity ExternalChanges {
        key ID        : UUID;
            editionID : UUID;
    }    
}

service views2Service {
    entity Book as
        projection on views1Service.Book {
            id,
            genre      as category,
            genre.name as categoryName,
            title,
            authorName as AuthorName,
            AuthorId as Authorid
        };
}
