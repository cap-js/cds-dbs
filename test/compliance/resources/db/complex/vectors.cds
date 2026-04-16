namespace complex.vectors;

entity Books {
    key ID          : Integer;
        title       : String(111);
        description : String(1200);
        embedding   : Vector(768) = (
            VECTOR_EMBEDDING(
                description, 'DOCUMENT', 'SAP_GXY.20250407'
            )
        ) stored;
}
