namespace edge.hana.literals;

entity HANA_NUMBER {
    tinyint      : hana.TINYINT;
    smallint     : hana.SMALLINT;
    smalldecimal : hana.SMALLDECIMAL;
    real         : hana.REAL;
}

// VARCHAR: ASCII string between 1 and 2000 length (default: 1)
entity HANA_CHAR {
    char   : hana.CHAR; // implied length 1
    short  : hana.CHAR(10);
    medium : hana.CHAR(100);
    large  : hana.CHAR(2000);
    blob   : hana.CLOB; // CLOB: ASCII binary (max size 2 GiB)
}

// NVARCHAR: unicode string between 1 and 2000 length (default: 1)
entity HANA_NCHAR {
    char   : hana.NCHAR; // implied length 1
    short  : hana.NCHAR(10);
    medium : hana.NCHAR(100);
    large  : hana.NCHAR(2000);
}

// BLOB: binary (max size 2 GiB)
entity HANA_BINARY {
    binary : hana.BINARY;
}

// All of this:
// https://help.sap.com/docs/HANA_CLOUD_DATABASE/bc9e455fe75541b8a248b4c09b086cf5/7a2d5618787c10148dc4da810379e15b.html
entity HANA_ST {
    point    : hana.ST_POINT; // 2D point
    geometry : hana.ST_GEOMETRY; // 3D geometry
}
