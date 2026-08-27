namespace search.ranking;

entity Genres {
  key ID   : Integer;
      name : String;
}

entity Books {
  key ID     : Integer;
      title  : String;
      author : Association to SearchAuthors;
      genre  : Association to Genres;
}

// to-many searchable path: an author matches via any of its books' title or genre name.
// The ranking ORDER BY must correlate a MAX(SCORE(...)) sub-select to each author row.
@cds.search: {books.title, books.genre.name}
entity SearchAuthors {
  key ID    : Integer;
      name  : String;
      books : Composition of many Books
                on books.author = $self;
}
