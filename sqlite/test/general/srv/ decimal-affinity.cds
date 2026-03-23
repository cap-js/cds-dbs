namespace cap.dbs.test.sqlite.general;

context schema {
    entity EntityWithDecimalFields {
        key ID                           : UUID;
            plainDecimal                 : Decimal;
            decimalWithScaleAndPrecision : Decimal(5, 2);
    };
}

service DecimalAffinityService {
    entity EntityWithDecimalFields as projection on schema.EntityWithDecimalFields;
}
