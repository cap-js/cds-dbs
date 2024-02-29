// model with a view and a parameterized entity
// model with a view and a parameterized entity
entity Books {
    key ID     : Integer;
    author: Association to Authors;
};

entity Authors {
    key ID    : Integer;
        name  : String;
};

entity PBooks(P1 : Integer, P2 : String(100)) as
    select from Books;
