namespace search;

entity Books {
  key ID : Integer;
  title: String;

  author : Association to Authors;
  coAuthor_ID_unmanaged: Integer;
  coAuthorUnmanaged: Association to Authors on coAuthorUnmanaged.ID = coAuthor_ID_unmanaged;
}

@cds.search: {
    author.lastName
}
entity BooksSeachAuthorName: Books {}

// search through all searchable fields in the author
@cds.search: { author }
entity BooksSeachAuthor: Books {}

entity Authors {
  key ID : Integer;
  lastName: String;
  firstName: String;
  books: Association to Books on books.author = $self;
}
