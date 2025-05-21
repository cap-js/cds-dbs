namespace complex.keywords;

// ORDER / ALTER / ASC / NUMBER are reserved words in ANSI SQL standard
entity Order {
  key ID    : Integer;
      alter : Composition of many Alter
                on alter.order = $self;
}

entity Alter {
  key ID     : Integer;
      number : Integer;
      order  : Association to Order;
}

entity ASC {
  key ID        : Integer;
      alias     : Integer;
      ![select] : Integer;
}

entity ![1234567890] {
  ![1]  : Boolean;
  ![2]  : UUID;
  ![3]  : UInt8;
  ![4]  : Int16;
  ![5]  : Int32;
  ![6]  : Int64;
  ![7]  : cds.Double;
  ![8]  : cds.Decimal;
  ![9]  : cds.Decimal(5, 4);
  ![10] : String;
  ![11] : String(1);
  ![12] : String(10);
  ![13] : String(100);
  ![14] : String(5000);
  ![15] : LargeString;
  ![16] : Date;
  ![17] : Time;
  ![18] : DateTime;
  ![19] : Timestamp;
  ![20] : LargeString;
  ![21] : LargeString;
  ![22] : Binary;
  ![23] : LargeBinary;
  ![24] : Boolean; // Vector;
}

entity special_chars {
  ![~]  : Boolean;
  ![`]  : UUID;
  ![!!] : UInt8;
  ![@]  : Int16;
  ![#]  : Int32;
  ![$]  : Int64;
  ![%]  : cds.Double;
  ![^]  : cds.Decimal;
  ![&]  : cds.Decimal(5, 4);
  ![*]  : String;
  ![(]  : String(1);
  ![)]  : String(10);
  ![_]  : String(100);
  ![+]  : String(5000);
  ![-]  : LargeString;
  ![=]  : Date;
  ![']  : Time;
  !["]  : DateTime;
  ![\1] : Timestamp;
  ![/]  : LargeString;
  ![,]  : LargeString;
  ![[]  : Binary;
  ![]]] : LargeBinary;
  ![💾] : Boolean; // Vector;
}
