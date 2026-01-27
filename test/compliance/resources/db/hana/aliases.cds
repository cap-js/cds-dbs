namespace edge.hana.aliases;

entity SelfReferencingEntity {
    key ID                                  : Integer;
        associationNameWithLotsOfCharacters : Association to one SelfReferencingEntity;
}
