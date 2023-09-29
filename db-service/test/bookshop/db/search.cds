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

// search over multiple associations
@cds.search: { authorWithAddress }
entity BooksSeachAuthorAndAddress: Books {
  authorWithAddress: Association to AuthorsSearchAddresses;
}

@cds.search: {
  address,
  note
}
entity AuthorsSearchAddresses : Authors {
  note: String;
  address: Association to Addresses;
}

@cds.search: {
  street: false
}
entity Addresses {
  key ID: Integer;
  street: String;
  city: String;
  zip: Integer;
}

// search with calculated elements

@cds.search: {
  address,
  note
}
entity AuthorsSearchCalculatedAddress : Authors {
  note: String;
  address: Association to CalculatedAddresses;
}

@cds.search: {
  city: false,
  calculatedAddress:
}
entity CalculatedAddresses : Addresses {
  calculatedAddress: String = street || ' ' || zip || '' || city
}

// calculated elements are not searchable by default
entity CalculatedAddressesWithoutAnno : Addresses {
  calculatedAddress: String = street || ' ' || zip || '' || city
}
