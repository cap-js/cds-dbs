// test many-to-many relations
entity Classrooms {
    key ID     : Integer;
        pupils : Association to many ClassRoomPupil
                     on pupils.classroom = $self
}

entity Pupils {
    key ID        : Integer;
        classrooms : Association to many ClassRoomPupil
                        on classrooms.pupil = $self
}

entity ClassRoomPupil {
    key classroom : Association to Classrooms;
    key pupil     : Association to Pupils;
}
