// test many-to-many relations
entity Classrooms {
    key ID     : Integer;
        pupils : Association to many ClassRoomPupil
                     on pupils.classroom = $self
}

entity Pupils {
    key ID        : Integer;
        classroom : Association to many ClassRoomPupil
                        on classroom.pupil = $self
}

entity ClassRoomPupil {
    key classroom : Association to Classrooms;
    key pupil     : Association to Pupils;
}
