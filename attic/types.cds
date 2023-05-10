entity Types {
  Boolean : Boolean;
  Integer : Integer;
  Integer64 : Integer64;
  Int64 : Int64;
  Int32 : Int32;
  Int16 : Int16;
  UInt8 : UInt8;
  Double : Double;
  Decimal : Decimal;
  String : String;
  LargeString : LargeString;
  Date : Date;
  Time : Time;
  DateTime : DateTime;
  Timestamp : Timestamp;
  Binary : Binary;
  LargeBinary : LargeBinary;
}

entity HANATypes {
  TINYINT : hana.TINYINT;
  SMALLINT : hana.SMALLINT;
  SMALLDECIMAL : hana.SMALLDECIMAL;
  REAL : hana.REAL;
  CHAR : hana.CHAR(7);
  CLOB : hana.CLOB;
  NCHAR : hana.NCHAR;
  BINARY : hana.BINARY;
  ST_POINT : hana.ST_POINT;
  ST_GEOMETRY : hana.ST_GEOMETRY;
}
