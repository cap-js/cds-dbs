// test many-to-many relations
entity Classrooms {
    key ID     : Integer;
        name: String;
        info: {
            capacity: Integer;
            location: String;
        };
        pupils : Association to many ClassRoomPupil
                     on pupils.classroom = $self
}

entity Pupils {
    key ID         : Integer;
        classrooms : Association to many ClassRoomPupil
                         on classrooms.pupil = $self
}

entity ClassRoomPupil {
    key classroom : Association to Classrooms;
    key pupil     : Association to Pupils;
}
// -----------------------------------------------------

entity ForeignKeyIsAssoc {
    key ID         : Integer;   
        my: Association to TeachersRoom;
}

entity TeachersRoom {
    key room: Association to Classrooms { ID as number, name, info.location };
}
