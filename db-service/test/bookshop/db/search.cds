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

// search all own searchable fields + those in `Authors`
@cds.search: {author}
entity BooksSearchAuthor : Books {}

entity Authors {
    key ID        : Integer;
        lastName  : String;
        firstName : String;
        books     : Composition of many Books
                        on books.author = $self;
}

// search all searchable fields in `Books` + `Genres:name` via `AuthorSearchBooks:books`
@cds.search: {books, books.genre.name}
entity AuthorSearchBooks : Authors {
}

// search only `books.title`
@cds.search: {books.title}
entity AuthorSearchOnlyBooksTitle : Authors {}

// search only `description` (default searchable elements of  `Books` are skipped)
@cds.search: {description}
entity BooksSearchOnlyDescription : Books {
    description : String;
}

entity BooksIgnoreVirtualElement : Books {
    virtual virtualElement : String;
}

@cds.search: { virtualElement: true } 
entity BooksIgnoreExplicitVirtualElement : Books {
    virtual virtualElement : String;
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

// exclude specific elements from search
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

@cds.search: {
    toMulti
}
entity MultipleLeafAssocAsKey {
    key toMulti : Association to MultipleKeys;
}

entity MultipleKeys {
    key ID1 : Integer;
    key ID2 : Integer;
    key ID3 : Integer;
    text: String;
}
