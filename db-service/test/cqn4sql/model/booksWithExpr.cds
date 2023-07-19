namespace booksCalc;



entity Books {
  key ID : Integer;
  title : String;
  author : Association to Authors;

  a : Integer;
  b : Integer;
  length : Decimal;
  width : Decimal;
  height : Decimal;
  stock : Integer;
  price : Decimal;


  // ---

  stock2 = stock;
  ctitle = substring(title, 3, stock);

  // -- nested
  area : Decimal = length * width;
  volume : Decimal = area * height;
  storageVolume : Decimal = stock * volume;

  // -- with paths
  authorLastName = author.lastName;
  authorName = author.name;
  authorAdrText = author.addressText;



}

entity Authors {
  key ID : Integer;
  firstName : String;
  lastName : String;
 
  books : Association to many Books on books.author = $self;
  address : Association to Addresses;

  name : String = firstName || ' ' || lastName;

  bigBooksTitle = books[area > 22].title;


  m : Integer;
  n : Integer;
  // ---
  c = m + n;

  addressText = address.text;
}

entity Addresses {
  key ID : Integer;
  street : String;
  city : String;

  text = street || ', ' || city;

  x : Integer;
  y : Integer;
  // ---
  c = x + y;
}