namespace basic.common;

using {
  cuid     as _cuid,
  managed  as _managed,
  temporal as _temporal
} from '@sap/cds/common';

entity cuid : _cuid {}
entity managed : _cuid, _managed {}
entity temporal : _cuid, _temporal {}

// Set default values for all literals from ./literals.cds
entity ![default] : _cuid {
  uuidDflt  : UUID default '00000000-0000-0000-4000-000000000000';
  bool      : Boolean default false;
  integer8  : UInt8 default 8;
  integer16 : Int16 default 9;
  integer32 : Int32 default 10;
  integer64 : Int64 default 11;
  double    : cds.Double default 1.1;
  float     : cds.Decimal default 1.1;
  decimal   : cds.Decimal(5, 4) default 1.11111;
  string    : String default 'default';
  char      : String(1) default 'd';
  short     : String(10) default 'default';
  medium    : String(100) default 'default';
  large     : String(5000) default 'default';
  // HANA Does not support default values on BLOB types
  // default value cannot be created on column of data type NCLOB: BLOB
  // blob        : LargeString default 'default';
  date      : Date default '1970-01-01';
  date_lit  : Date default date'2021-05-05';
  time      : Time default '01:02:03';
  dateTime  : DateTime default '1970-01-01T01:02:03Z';
  timestamp : Timestamp default '1970-01-01T01:02:03.123456789Z';
  // HANA Does not support default functions in general
  func      : Date default current_utctimestamp();
// Binary default values don't make sense. while technically possible
// binary      : Binary default 'YmluYXJ5'; // base64 encoded 'binary';
// largebinary : LargeBinary default 'YmluYXJ5'; // base64 encoded 'binary';
// Vector default values probably also don't make sense
// vector : Vector default '[1.0,0.5,0.0,...]';
}

entity keys {
  key id      : Integer;
  key default : String default 'defaulted';
      data    : String;
}
