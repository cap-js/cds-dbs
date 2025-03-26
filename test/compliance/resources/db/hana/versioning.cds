using {
  cuid,
  temporal
} from '@sap/cds/common';

namespace edge.hana.versioning;

// The history table has to be defined before the origin table
// As the compiler doesn't know the dependency between the two entities
@readonly
entity versioned.history : temporal {
  ID   : UUID; // cuid doesn't work as it would make the ID column a key
  data : String(5000);
}

entity versioned : cuid, temporal {
  // Expose own history as an association
  history : Association to many versioned.history
              on history.ID = ID;
  data    : String(5000);
}
