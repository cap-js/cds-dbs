namespace test.vector;

entity Books {
    key ID          : Integer;
        title       : String(200);
        description : String(1200);
        embedding   : Vector(4);
}
