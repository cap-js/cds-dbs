using {sap.capire.bookshop as my} from '../db/schema';

// Create bookshop namespace for compatibility
context bookshop {
  entity Edition {
    key ID          : Integer;
        book        : Association to views.Books;
        editionType : Association to EditionType;
  };

  entity EditionType {
    key ID   : Integer;
        name : String;
  };

  entity Category   as projection on my.Genres;

  entity Page {
    key ID   : Integer;
        text : String;
  };

  entity Review {
    key ID   : Integer;
        text : String;
        page : Association to Page;
  };

  @cds.persistence.skip
  entity PageView   as projection on Page;

  @cds.persistence.skip
  entity ReviewView as
    projection on Review {
      *,
      page : redirected to PageView
    };
}

context views {

  entity AuthorView as
    projection on my.Authors {
      *,
      reviews : Association to many bookshop.ReviewView
                  on reviews.ID = $self.ID,
      pages   : Association to many bookshop.PageView
                  on pages.ID = $self.ID
    };

  entity BooksView  as
    projection on my.Books {
      *,
      pages : Association to many bookshop.PageView
                on pages.ID = $self.ID,
      this  : Association to BooksView
                on this.ID = $self.ID
    };

  entity Author     as
    projection on my.Authors {
      *,
      reviews : Association to many bookshop.Review
                  on reviews.ID = $self.ID,
      pages   : Association to many bookshop.Page
                  on pages.ID = $self.ID
    };

  entity Books      as
    projection on my.Books {
      *,
      pages : Association to many bookshop.Page
                on pages.ID = $self.ID,
      this  : Association to Books
                on this.ID = $self.ID
    };


}

service runtimeViews0Service {
  @cds.redirection.target
  @cds.persistence.skip
  entity Author           as projection on views.AuthorView;

  @cds.persistence.skip
  entity Book             as projection on views.BooksView;

  @cds.persistence.skip
  entity Book_Renamed     as
    projection on views.BooksView {
      ID             as ID_Renamed, 
      ID             as ID_Renamed_Again,
      title          as title_Renamed,
      descr          as descr_Renamed,
      author         as author_Renamed,
      genre          as genre_Renamed,
      stock          as stock_Renamed,
      price          as price_Renamed,
      currency       as currency_Renamed,
      image          as image_Renamed,
      footnotes      as footnotes_Renamed,
      authorsAddress as authorsAddress_Renamed,
      pages          as pages_Renamed,
      this           as this_Renamed,
    };

  @cds.persistence.skip
  entity Edition          as projection on bookshop.Edition;

  @cds.persistence.skip
  view AuthorsAndBooks as
      select from Author {
        ID       as commonID,
        name     as commonName,
        'Author' as type
      }
    union all
      select from Book {
        ID     as commonID,
        title  as commonName,
        'Book' as type
      };

  @cds.persistence.skip
  view BookWithEditions_RTV as
    select from Book
    left join Edition
      on Edition.ID = Book.ID
    {
      Book.ID,
      Book.title,
      Edition.ID as editionID
    };

  @cds.persistence.skip
  view BookWithEditions_Existing as
    select from my.Books
    left join bookshop.Edition
      on Edition.ID = Books.ID
    {
      Books.ID,
      Books.title,
      Edition.ID as editionID
    };

  @cds.persistence.skip
  view BookWithEditions_Aliased as
    select from Book as BookAlias
    left join Edition as EditionAlias
      on EditionAlias.ID = BookAlias.ID
    {
      BookAlias.ID,
      BookAlias.title,
      EditionAlias.ID as editionID
    };

  @cds.persistence.skip
  @cds.redirection.target
  view BookRedirected as
    select from my.Books {
      key ID,
          'Redirected ' || title as title    : String,
          descr,
          author.ID              as authorID : Integer,
          author
    };

  entity AuthorRedirected as
    projection on Author {
      *,
      books : redirected to BookRedirected
                on books.author.ID = $self.ID
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
      'Book'      as type,
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
    };

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
      AuthorId   as Authorid
    };
}

service runtimeViewsErrorService {

  @cds.persistence.skip
  entity VirtualBook {
    id    : String;
    title : String;
  };

  entity VirtualBookView as select from VirtualBook;
}

service views0Service {
  @cds.redirection.target
  entity Author           as
    projection on views.Author {
      *,
      reviews : Association to many bookshop.Review
                  on reviews.ID = $self.ID,
      pages   : Association to many bookshop.Page
                  on pages.ID = $self.ID,
    };

  entity Book             as
    projection on views.Books {
      *,
      pages : Association to many bookshop.Page
                on pages.ID = $self.ID
    };

  entity Edition          as projection on bookshop.Edition;

  @cds.redirection.target
  view BookRedirected as
    select from my.Books {
      key ID,
          'Redirected ' || title as title    : String,
          descr,
          author.ID              as authorID : Integer,
          author
    };

  entity AuthorRedirected as
    projection on Author {
      *,
      books : redirected to BookRedirected
                on books.author.ID = $self.ID
    };

  entity Book_Renamed     as
    projection on views.BooksView {
      ID             as ID_Renamed, 
      ID             as ID_Renamed_Again,
      title          as title_Renamed,
      descr          as descr_Renamed,
      author         as author_Renamed,
      genre          as genre_Renamed,
      stock          as stock_Renamed,
      price          as price_Renamed,
      currency       as currency_Renamed,
      image          as image_Renamed,
      footnotes      as footnotes_Renamed,
      authorsAddress as authorsAddress_Renamed,
      pages          as pages_Renamed,
      this           as this_Renamed,
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
      'Book'      as type,
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
    };

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
  };
}

service views2Service {
  entity Book as
    projection on views1Service.Book {
      id,
      genre      as category,
      genre.name as categoryName,
      title,
      authorName as AuthorName,
      AuthorId   as Authorid
    };
}
