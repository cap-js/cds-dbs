namespace my;

entity Books {
  key ID     : Integer;
      title  : String;
      stock  : Integer;
      author : Association to Authors;
      genre  : Association to Genres;
}

entity BooksWithCalc : Books {
  authorFullName = author.firstName || ' ' || author.lastName;
}

entity Authors {
  key ID          : Integer;
      firstName   : String;
      lastName    : String;
      dateOfBirth : Date;
      dateOfDeath : Date;
      books       : Association to many Books
                      on books.author = $self;
}

entity Genres {
  key ID       : Integer;
      name     : String;
      parent   : Association to Genres;
      children : Composition of many Genres
                   on children.parent = $self;
}
