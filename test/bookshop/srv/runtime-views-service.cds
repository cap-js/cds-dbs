using {sap.capire.bookshop as my} from '../db/schema';

using { API_BUSINESS_PARTNER as external } from './external/API_BUSINESS_PARTNER.csn';

// Create bookshop namespace for compatibility
context bookshop {
    // Map Order-related entities to Books (representing book orders)
    entity Order {
        key OrderNo        : Integer;
            status         : String(20);
            header         : Composition of one OrderHeader;
            items          : Composition of many OrderItem
                                 on items.parent = $self;
            fulfillment    : Composition of one Fulfillment
                                 on fulfillment.ffid = fulfillment_id;
            fulfillment_id : Integer;
    }

    // Map OrderHeader to Authors (representing order header with author info)
    entity OrderHeader {
        key HeaderID        : Integer;
            createdAt       : DateTime default $now;
            status          : String(20) default 'open';

            @cascade: {
                insert: true,
                update: true,
                delete: false
            }
            shippingAddress : Association to one Address;
    }

    // Create OrderItem as view combining Books with quantity info
    entity OrderItem {
        key ID       : UUID;
            parent   : Association to Order;
            book     : Association to views.Books;
            amount   : Integer;
            quantity : Integer;
    };

    // Create OrderItemNote for additional order annotations
    entity OrderItemNote {
        key ID        : UUID;
            orderItem : Association to OrderItem;
            note      : String;
    };

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

    entity Sales {
        key ID     : UUID;
            amount : Decimal;
    };

    entity Fulfillment {
        key ffid  : UUID;
            state : String;
    };

    entity Address {
        key ID      : UUID;
            street  : String;
            city    : String;
            country : String;
    };
}

// Create mock entities for missing dependencies
context calculated {
    entity Employees {
        key ID                      : UUID;
            fullName                : String;
            evenMoreComplexNumber   : Integer;
            cheapLaptopManufacturer : String;
            number                  : Integer;
            increasedNumber         : Integer = number + 1;
        complexNumber = cast(
            increasedNumber * 100 as Integer
        );
    };
}

context assocs {
    entity Root {
        key ID : UUID;
    };

    entity ExternalEntity {
        key ID : UUID;
    };
}

context views {

    entity Books as projection on my.Books {
        *,
        editions : Association to many bookshop.Edition on editions.book = $self
    };

    entity BooksWithVirtuals             as
        select from my.Books {
            *,
            author                     : redirected to AuthorsWithVirtuals,
            virtual null as virtualStr : String
        }

    entity BooksWithVirtualsInlineAuthor as
        select from BooksWithVirtuals {
            *,
            author.name               as authorName       : String,
            author.address            as address,
            virtual author.virtualStr as authorVirtualStr : String
        }

    entity AuthorsWithVirtuals           as
        select from my.Authors {
            *,
            virtual null as virtualStr : String
        }

    view BookToAuthorRTView as
        select from my.Books {
            *,
            author as authorView : redirected to runtimeViews1Service.Author
        }
        excluding {
            author
        };

    entity FictionAuthors                as projection on my.Books[genre.ID = 200] : author;

    entity BookItem                      as
        projection on my.Books {
            *,
            ID        as bookId,
            title     as bookTitle @readonly,
            author.ID as authorId
        };
}

context views2 {
    entity Book   as
        projection on my.Books {
            *,
            author : redirected to Author
        };

    entity Author as
        projection on my.Authors {
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

@path: '/runtimeViews0'
service runtimeViews0Service {
    @cds.persistence.skip
    entity Author         as projection on my.Authors;

    @cds.persistence.skip
    entity Book           as projection on views.Books;

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

@path: '/runtimeViews1'
service runtimeViews1Service {
    entity Order         as
        projection on runtimeViews0Service.Order {
            *,
            header,
            header.status as headerStatus     : String,
            'delivered'   as fulfillmentState : String,
            virtual null  as virtualStr       : String
        }

    entity OrderHeader   as
        projection on runtimeViews0Service.OrderHeader {
            *,
            virtual null as virtualStr : String
        }

    entity OrderItem     as select from runtimeViews0Service.OrderItem;

    entity OrderItemNote as
        select from runtimeViews0Service.OrderItemNote {
            *,
            note as description
        }
        excluding {
            note
        };

    entity Author        as
        projection on runtimeViews0Service.Author {
            ID as id, *
        };

    entity Book          as
        projection on runtimeViews0Service.Book {
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

    entity Edition       as
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

@path: '/runtimeViews2'
service runtimeViews2Service {
    entity Order       as
        select from runtimeViews1Service.Order {
                *,
            key OrderNo as ID,
                'test'  as virtualStr : String
        }
        excluding {
            OrderNo
        };

    entity OrderItem   as
        select from runtimeViews1Service.OrderItem {
            *,
            amount as quantity,
            'test' as virtualStr : String
        }
        excluding {
            amount
        };

    entity OrderHeader as
        select from runtimeViews1Service.OrderHeader {
                *,
            key HeaderID,
                status          as headerStatus,
                shippingAddress as shippingAddress
        }
        excluding {
            status
        }

    entity Book        as
        projection on runtimeViews1Service.Book {
            id,
            genre  as category,
            genre.name as categoryName,
            title,
            authorName as AuthorName,
            Author     as autor
        };
}

@path: '/runtimeViews3'
service runtimeViews3Service {

    entity OrderWithExpressions           as
        select from runtimeViews2Service.Order {
            *,
            'test'                     as literal  : String,
            upper(headerStatus)        as func     : String,
            'STATUS: ' || headerStatus as concat   : String,
            (
                case
                    when headerStatus = 'canceled'
                         then-1
                    else 1
                end
            )                          as caseWhen : Integer,
        };

    @cds.redirection.target: false
    entity OrderWithExpressionsSelf       as
        select from runtimeViews2Service.Order {
            *,
            3                   as literal     : Integer,
            $self.literal * 100 as arithmExpr1 : Integer
        };

    @cds.redirection.target: false
    entity OrderWithExpressionsProjection as
        select from runtimeViews2Service.Order {
            *,
            3                         as literal     : Integer,
            $projection.literal * 200 as arithmExpr1 : Integer
        };
}

@path: '/runtimeViews4'
service runtimeViews4Service {

    entity BooksWithHighStock as
        projection on runtimeViews1Service.Book {
            *
        }
        where
            count > 100;

    entity BooksWithLowStock  as
        projection on runtimeViews1Service.Book {
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

    @cds.persistence.skip
    view MyRemoteView as
    select from external.A_BusinessPartner {
        key BusinessPartner,
        BusinessPartnerName,
        CreationDate
    };

    entity BusinessPartners as projection on MyRemoteView;
}

@path: '/runtimeViews5'
service runtimeViews5Service {

    entity Order     as
        projection on runtimeViews0Service.Order {
            *,
            OrderNo as ID
        }
        excluding {
            OrderNo
        }

    entity OrderItem as
        select from runtimeViews0Service.OrderItem {
            *,
            amount as quantity
        }
        excluding {
            amount
        };
}

@path: '/runtimeViews6'
service runtimeViews6Service {

    entity Order        as
        projection on runtimeViews2Service.Order {
            *
        }

    @cds.java.runtimeView.mode: resolve
    @cds.redirection.target   : false
    entity OrderResolve as
        projection on runtimeViews2Service.Order {
            *
        }
}

@path: '/runtimeViewsCalculated'
service runtimeViewsCalculatedService {

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
    @path: '/runtimeViewsDraft1'
    service runtimeViewsDraft1Service {
        @odata.draft.enabled
        entity Book as projection on runtimeViews0Service.Book;
    }

    @path: '/runtimeViewsDraft2'
    service runtimeViewsDraft2Service {
        entity Book as projection on runtimeViews1Service.Book;
    }
}
