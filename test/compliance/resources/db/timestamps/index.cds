entity DateTimeEntity {
  key dt: DateTime;
  int: Integer;
}

entity TimestampEntity {
  key ID : Integer;
  ts     : Timestamp;
}

entity TimestampView as projection on TimestampEntity {
  *,
  $now as now : Timestamp
}