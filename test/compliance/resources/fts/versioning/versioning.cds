using {edge.hana.versioning as versioning} from '../../db/hana/versioning';

annotate versioning.versioned with @sql.append: 'WITH SYSTEM VERSIONING HISTORY TABLE edge_hana_versioning_versioned_history';

annotate versioning.versioned with {
  validFrom @(
    hana.systemversioned,
    // When cds.valid.from is defined the column is turned into a key
    // the START column is not allowed to be a key column
    cds.valid.from: false,
    sql.append    : 'NOT NULL GENERATED ALWAYS AS ROW START'
  );
  validTo   @(
    hana.systemversioned,
    sql.append: 'NOT NULL GENERATED ALWAYS AS ROW END'
  );
  // IMPORTANT: the `data` column must always be the last defined column
  // As the @sql.append is doing a classic bit of SQL injection
  // to include the required period definition for the history table
  data      @(sql.append: ', PERIOD FOR SYSTEM_TIME (validFrom, validTo)')
}

annotate versioning.versioned.history with {
  // The history table is not allowed to have key columns (feature not supported)
  validFrom @(cds.valid.from: false);
}
