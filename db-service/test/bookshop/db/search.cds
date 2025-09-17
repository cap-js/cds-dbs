namespace search;

entity Books {
    key ID                    : Integer;
        title                 : String;
        author                : Association to Authors;
        coAuthor_ID_unmanaged : Integer;
        coAuthorUnmanaged     : Association to Authors
                                    on coAuthorUnmanaged.ID = coAuthor_ID_unmanaged;
        shelf                 : Association to BookShelf;
        genre                 : Association to Genres;
}

entity Genres {
    key ID   : Integer;
        name : String;
}

@cds.search: {author.lastName}
entity BooksSearchAuthorName : Books {}

@cds.search: {title}
entity PathInSearchNotProjected as select from BooksSearchAuthorName {
    ID,
    title
};

entity NoSearchCandidateProjected as select from PathInSearchNotProjected {
    ID
};

// search through all searchable fields in the author
@cds.search: {author}
entity BooksSearchAuthor : Books {}

entity Authors {
    key ID        : Integer;
        lastName  : String;
        firstName : String;
        books     : Association to Books
                        on books.author = $self;
}

@cds.search: {books, books.genre.name}
entity AuthorSearchBooks : Authors {
}

// search over multiple associations
@cds.search: {authorWithAddress}
entity BooksSearchAuthorAndAddress : Books {
    authorWithAddress : Association to AuthorsSearchAddresses;
}

@cds.search: {
    address,
    note
}
entity AuthorsSearchAddresses : Authors {
    note    : String;
    address : Association to Addresses;
}

@cds.search: {street: false}
entity Addresses {
    key ID     : Integer;
        street : String;
        city   : String;
        zip    : Integer;
}

// search with calculated elements

@cds.search: {
    address,
    note
}
entity AuthorsSearchCalculatedAddress : Authors {
    note    : String;
    address : Association to CalculatedAddresses;
}

@cds.search: {
    city             : false,
    calculatedAddress: true
}
entity CalculatedAddresses : Addresses {
    calculatedAddress : String = street || ' ' || zip || '' || city
}

// calculated elements are not searchable by default
entity CalculatedAddressesWithoutAnno : Addresses {
    calculatedAddress : String = street || ' ' || zip || '' || city
}

@cds.search: {
    genre,
    books.doesNotExist
}
entity BookShelf {
    key ID    : Integer;
        genre : String;
        books : Composition of many Books
                    on books.shelf = $self;
}
