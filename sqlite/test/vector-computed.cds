namespace test.vector.computed;

entity Docs {
    key ID          : Integer;
        description : String(1200);
        embedding   : Vector(4) = (
            VECTOR_EMBEDDING(description, 'DOCUMENT', 'test-model')
        ) stored;
}
