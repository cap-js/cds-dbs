namespace basic.literals;

entity globals {
    bool : Boolean;
}

entity number {
    integer   : Integer;
    integer64 : Integer64;
    double    : cds.Double;
    // Decimal: (p,s) p = 1 - 38, s = 0 - p
    // p = number of total decimal digits
    // s = number of decimal digits after decimal seperator
    float     : cds.Decimal; // implied float
    decimal   : cds.Decimal(5, 4); // 𝝅 -> 3.1415
}

// NVARCHAR: Unicode string between 1 and 5000 length (default: 5000)
entity string {
    string : String;
    char   : String(1);
    short  : String(10);
    medium : String(100);
    large  : String(5000); // TODO: should be broken on HANA || switch to Binary
    blob   : LargeString; // NCLOB: Unicode binary (max size 2 GiB)
}

// ISO Date format (1970-01-01)
entity date {
    date : Date;
}

// ISO Time format (00:00:00)
entity time {
    time : Time;
}

// ISO DateTime format (1970-1-1T00:00:00Z)
entity dateTime {
    dateTime : DateTime;
}

// TODO: Verify that everyone agrees to only allow UTC timestamps
// ISO timestamp format (1970-1-1T00:00:00.000Z)
// HANA timestamp format (1970-1-1T00:00:00.0000000Z)
entity timestamp {
    timestamp : Timestamp;
}

entity array {
    string  : array of String;
    integer : array of Integer;
}

entity binaries {
    binary      : Binary;
    largebinary : LargeBinary;
}


/* Excluded from the tests until fully supported
entity vectors {
    vector : Vector;
}
*/