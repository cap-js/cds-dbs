namespace sap.capire;

entity TestEntity {
    ID: Integer;
    title: String(32);
}

service bla {
    entity STestEntity as projection on TestEntity;
}
