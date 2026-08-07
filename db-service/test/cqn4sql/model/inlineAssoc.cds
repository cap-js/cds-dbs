namespace issue;
entity Cities {
  key ID      : Integer;
      name    : String;
      country : String;
}
entity Addresses {
  key ID      : Integer;
      city    : Association to Cities;
      street  : String;
}
entity Authors {
  key ID      : Integer;
      address : Association to Addresses;
}
