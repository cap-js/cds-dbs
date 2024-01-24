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
  integer     : Integer default 10;
  integer64   : Integer64 default 11;
  double      : cds.Double default 1.1;
  float       : cds.Decimal default 1.1;
  decimal     : cds.Decimal(5, 4) default 1.12345;
  string      : String default 'default';
  char        : String(1) default 'default';
  short       : String(10) default 'default';
  medium      : String(100) default 'default';
  large       : String(5000) default 'default';
  blob        : LargeString default 'default';
  date        : Date default '1970-01-01';
  time        : Time default '01:02:03';
  dateTime    : DateTime default '1970-01-01T01:02:03Z';
  timestamp   : Timestamp default '1970-01-01T01:02:03.123456789Z';
  // Binary default values don't make sense. while technically possible
  // binary      : Binary default 'YmluYXJ5'; // base64 encoded 'binary';
  // largebinary : LargeBinary default 'YmluYXJ5'; // base64 encoded 'binary';
}
