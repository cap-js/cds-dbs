namespace complex;

entity Books {
  key ID : Integer;
  title  : String(111);
  author : Association to Authors;
}

entity Authors {
  key ID : Integer;
  name   : String(111);
  books  : Association to many Books on books.author = $self;
}

entity JoinBooksAndAuthors as
  select
    Books.ID as BookId,
    Authors.ID as AuthorId
  from Books
  left outer join Authors
    on Authors.ID = Books.author.ID;