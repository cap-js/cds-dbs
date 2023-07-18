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
  c1 = a + b;
  c2 : Integer = a + b;
  c3 = a - b;

  ctitle = substring(title, 3, stock);

  // -- nested
  cc1 = c1 * c3;
  cc2 = cc1 / c1;
  area : Decimal = length * width;
  volume : Decimal = area * height;
  storageVolume : Decimal = stock * volume;

  // -- with paths
  authorLastName = author.lastName;
  authorName = author.name;
  authorFullName = author.firstName || ' ' || author.lastName;
  authorFullNameWithAddress = authorFullName || ' ' || authorAdrText;
  authorAdrText = author.addressText;

  // ca3 = f.ca; // F:ca is a calculated element with an assoc path

}

entity Authors {
  key ID : Integer;
  firstName : String;
  lastName : String;
 
  books : Association to many Books on books.author = $self;
  address : Association to Addresses;

  name : String = firstName || ' ' || lastName;

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