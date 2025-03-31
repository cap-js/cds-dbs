using {edge.hana.versioning as versioning} from '../../db/hana/versioning';

annotate versioning.versioned with @sql.append: 'WITH SYSTEM VERSIONING HISTORY TABLE edge_hana_versioning_versioned_history';

annotate versioning.versioned with {
  validFrom @(
    hana.systemversioned,
    sql.append: 'NOT NULL GENERATED ALWAYS AS ROW START'
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
