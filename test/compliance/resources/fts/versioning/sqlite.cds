using {edge.hana.versioning as versioning} from '../../db/hana/versioning';

annotate versioning.versioned with {
  validFrom @(
    cds.on.insert : $now,
    cds.on.update : $now,
  );
};
