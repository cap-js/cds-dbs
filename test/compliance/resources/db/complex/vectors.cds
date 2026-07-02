namespace complex.vectors;

entity Books {
    key ID          : Integer;
        title       : String(111);
        description : String(1200);
        embedding   : Vector(384) @cds.vectorSource: 'description';
}
