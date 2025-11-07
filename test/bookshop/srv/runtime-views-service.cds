using { sap.capire.bookshop as schema } from '../db/schema';

// Create test model entities that map to actual schema
context testModel {
    // Map Order-related entities to Books (representing book orders)
    entity Order as projection on schema.Books {
        *,
        ID as OrderNo,
        stock as amount,
        author as header : redirected to OrderHeader
    } excluding { ID };
    
    // Map OrderHeader to Authors (representing order header with author info)  
    entity OrderHeader as projection on schema.Authors {
        *,
        ID as HeaderID,
        'active' as status : String,
        address as shippingAddress
    } excluding { books };
    
    // Create OrderItem as view combining Books with quantity info
    entity OrderItem {
        key ID: UUID;
        parent: Association to Order;
        book: Association to schema.Books;
        amount: Integer;
        quantity: Integer;
    };
    
    // Create OrderItemNote for additional order annotations
    entity OrderItemNote {
        key ID: UUID;
        orderItem: Association to OrderItem;
        note: String;
    };
    
    // Map other entities
    entity Publisher {
        key ID: UUID;
        name: String;
    };
    entity Edition {
        key ID: UUID;
        book: Association to schema.Books;
        editionType: Association to EditionType;
    };
    entity EditionType {
        key ID: UUID;
        name: String;
    };
    entity Category as projection on schema.Genres;
    entity Sales {
        key ID: UUID;
        amount: Decimal;
    };
    entity Fulfillment {
        key ffid: UUID;
        state: String;
    };
    entity Address {
        key ID: UUID;
        street: String;
        city: String;
        country: String;
    };
}

// Create bookshop namespace for compatibility  
context bookshop {
    entity Order as projection on testModel.Order;
    entity OrderHeader as projection on testModel.OrderHeader;
    entity OrderItem as projection on testModel.OrderItem;  
    entity OrderItemNote as projection on testModel.OrderItemNote;
    entity Book as projection on schema.Books;
    entity Author as projection on schema.Authors;
    entity Publisher as projection on testModel.Publisher;
    entity Edition as projection on testModel.Edition;
    entity Category as projection on testModel.Category;
    entity Sales as projection on testModel.Sales;
    entity Fulfillment as projection on testModel.Fulfillment;
    entity Address as projection on testModel.Address;
}

// Create mock entities for missing dependencies
context calculated {
    entity Employees {
        key ID: UUID;
        fullName: String;
        evenMoreComplexNumber: Integer;
        cheapLaptopManufacturer: String;
        number          : Integer;
        increasedNumber : Integer = number + 1;
        complexNumber = cast(
            increasedNumber * 100 as Integer
        );
    };
}

context assocs {
    entity Root {
        key ID: UUID;
    };
    entity ExternalEntity {
        key ID: UUID;
    };
}

context views {

    entity BooksWithVirtuals as
        select from schema.Books {
            *,
            author                          : redirected to AuthorsWithVirtuals,
            virtual null      as virtualStr : String
        }

    entity BooksWithVirtualsInlineAuthor as
        select from BooksWithVirtuals {
            *,
            author.name               as authorName     : String,
            author.address            as address,
            virtual author.virtualStr as authorVirtualStr : String
        }

    entity AuthorsWithVirtuals as
        select from schema.Authors {
            *,
            virtual null as virtualStr : String
        }

    view BookToAuthorRTView as
        select from schema.Books {
            *,
            author as authorView : redirected to runtimeViews1.Author
        }
        excluding {
            author
        };

    entity FictionAuthors as projection on schema.Books[genre.ID = 200] : author;

    entity BookItem as
        projection on schema.Books {
            *,
            ID         as bookId,
            title      as bookTitle @readonly,
            author.ID  as authorId
        };
}

context views2 {
    entity Book as
        projection on schema.Books {
            *,
            author : redirected to Author
        };

    entity Author as
        projection on schema.Authors {
            *,
            books : Association to many Book
                        on books.author = $self
        };

    annotate Book with {
        title @assert1: (not exists author.books[title = $self.title])
              @assert2: (author.books[1: $self.title = `The Raven`].ID is not null)  
              @assert3: (author.books[1: $self.author.name = `Emil`].ID = author.name)
    };
}

service runtimeViews0 {
    @cds.persistence.skip
    @cds.redirection.target
    entity Author         as projection on bookshop.Author;

    @cds.persistence.skip
    @cds.redirection.target  
    entity Book           as projection on bookshop.Book;

    @cds.persistence.skip
    entity Publisher      as projection on bookshop.Publisher;

    @cds.persistence.skip
    entity Edition        as projection on bookshop.Edition;

    @cds.persistence.skip
    entity Category       as projection on bookshop.Category;

    @cds.persistence.skip
    entity Order          as projection on bookshop.Order;

    @cds.persistence.skip
    entity OrderHeader    as projection on bookshop.OrderHeader;

    @cds.persistence.skip
    entity OrderItem      as projection on bookshop.OrderItem;

    @cds.persistence.skip
    entity OrderItemNote  as projection on bookshop.OrderItemNote;

    @cds.persistence.skip
    entity Sales          as projection on bookshop.Sales;

    @cds.persistence.skip
    entity Fulfillment    as projection on bookshop.Fulfillment;

    @cds.persistence.skip
    entity Address        as projection on bookshop.Address;

    @cds.persistence.skip
    entity Root           as projection on assocs.Root;

    @cds.persistence.skip
    entity ExternalEntity as projection on assocs.ExternalEntity;
}

service runtimeViews1 {
    entity Order as
        projection on runtimeViews0.Order {
            *,
            header,
            header.status     as headerStatus : String,
            'delivered'       as fulfillmentState : String,
            virtual null      as virtualStr   : String
        }

    entity OrderHeader as
        projection on runtimeViews0.OrderHeader {
            *,
            virtual null as virtualStr : String
        }

    entity OrderItem     as select from runtimeViews0.OrderItem;

    entity OrderItemNote as
        select from runtimeViews0.OrderItemNote {
            *,
            note as description
        }
        excluding {
            note
        };

    entity Author as
        projection on runtimeViews0.Author {
            ID as id, *
        };

    entity Book as
        projection on runtimeViews0.Book {
            *,
            ID          as id,
            stock       as count,
            author      as Author,
            author.name as authorName,
            author.ID   as AuthorId
        }
        excluding {
            ID,
            stock,
            author
        };

    entity Edition as
        projection on runtimeViews0.Edition {
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

    entity Changes       as projection on VirtualChanges;

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

service runtimeViews2 {
    entity Order as
        select from runtimeViews1.Order {
                *,
            key OrderNo as ID,
                'test'  as virtualStr : String
        }
        excluding {
            OrderNo
        };

    entity OrderItem as
        select from runtimeViews1.OrderItem {
            *,
            amount as quantity,
            'test' as virtualStr : String
        }
        excluding {
            amount
        };

    entity OrderHeader as
        select from runtimeViews1.OrderHeader {
                *,
            key HeaderID,
                status                  as headerStatus,
                shippingAddress         as shippingAddress
        }
        excluding {
            status
        }

    entity Book as
        projection on runtimeViews1.Book {
            id,
            'fiction'  as cat,
            'books'    as cg,
            1          as cid,
            title,
            authorName as AuthorName,
            Author     as autor {
                id   as id,
                name as nombre
            }
        };
}

service runtimeViews3 {

    entity OrderWithExpressions as
        select from runtimeViews2.Order {
            *,
            'test'                            as literal  : String,
            upper(headerStatus)               as func     : String,
            'STATUS: ' || headerStatus        as concat   : String,
            (
                case
                    when headerStatus = 'canceled'
                         then-1
                    else 1
                end
            )                                 as caseWhen : Integer,
        };

    @cds.redirection.target: false
    entity OrderWithExpressionsSelf as
        select from runtimeViews2.Order {
            *,
            3                   as literal     : Integer,
            $self.literal * 100 as arithmExpr1 : Integer
        };

    @cds.redirection.target: false
    entity OrderWithExpressionsProjection as
        select from runtimeViews2.Order {
            *,
            3                         as literal     : Integer,
            $projection.literal * 200 as arithmExpr1 : Integer
        };
}

context runtimeViews {

    entity BooksWithHighStock as
        projection on runtimeViews1.Book {
            *
        }
        where
            count > 100;

    entity BooksWithLowStock as
        projection on runtimeViews1.Book {
            *
        }
        where
            count < 20;

    @cds.persistence.skip
    entity VirtualBook {
        id    : String;
        title : String
    };

    entity VirtualBookView    as select from VirtualBook;
}

service runtimeViews10 {

    entity Order as
        projection on runtimeViews0.Order {
            *,
            OrderNo as ID
        }
        excluding {
            OrderNo
        }

    entity OrderItem as
        select from runtimeViews0.OrderItem {
            *,
            amount as quantity
        }
        excluding {
            amount
        };
}

service runtimeViews20 {

    entity Order as
        projection on runtimeViews2.Order {
            *
        }

    @cds.java.runtimeView.mode: resolve
    @cds.redirection.target   : false
    entity OrderResolve as
        projection on runtimeViews2.Order {
            *
        }
}

service runtimeViewsCalculated {

    @cds.persistence.skip
    entity Employees as
        projection on calculated.Employees {
            *,
            fullName                as calc_fullName,
            evenMoreComplexNumber   as calc_number,
            cheapLaptopManufacturer as calc_manufacturer,
        }
        excluding {
            fullName,
            evenMoreComplexNumber,
            cheapLaptopManufacturer
        };
}

context draft {
    service runtimeViews1 {
        @odata.draft.enabled
        entity Book as projection on runtimeViews0.Book;
    }

    service runtimeViews2 {
        entity Book as projection on runtimeViews1.Book;
    }
}
