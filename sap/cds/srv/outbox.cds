namespace cds.outbox;

entity Messages {
  key ID                   : UUID;
      timestamp            : Timestamp;
      target               : String;
      msg                  : LargeString;
      attempts             : Integer default 0;
      partition            : Integer default 0;
      lastError            : LargeString;
      lastAttemptTimestamp : Timestamp @cds.on.update: $now;
}
