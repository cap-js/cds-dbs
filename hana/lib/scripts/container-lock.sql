-- Ensures the lock table used by container-database.sql exists.
--
-- Previously the container creation locked the system table
-- _SYS_DI.T_DEFAULT_CONTAINER_USER_PRIVILEGES via `FOR UPDATE` to serialize
-- concurrent container group creation. HANA revoked UPDATE on that system table
-- (error 258 "MISSING UPDATE ON _SYS_DI.T_DEFAULT_CONTAINER_USER_PRIVILEGES"),
-- so we now maintain our own lock table "_CDS_DI_LOCK" instead.
--
-- Creating the table is idempotent (guarded by a SYS.TABLES check). When multiple
-- connections race to create it, HANA rejects the losers with an internal-error
-- rollback ("object with the same name being created from another transaction")
-- that cannot be caught by the CONTINUE HANDLER below; the caller retries in that
-- case (see HANAService.database), and on retry the table already exists.
DO BEGIN
  DECLARE TABLE_EXISTS INT;
  DECLARE ROW_EXISTS INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;

  SELECT COUNT(*) INTO TABLE_EXISTS FROM SYS.TABLES
    WHERE SCHEMA_NAME = CURRENT_SCHEMA AND TABLE_NAME = '_CDS_DI_LOCK';
  IF :TABLE_EXISTS = 0 THEN
    CREATE COLUMN TABLE "_CDS_DI_LOCK" (ID INT);
  END IF;

  -- SELECT ... FOR UPDATE only locks existing rows, so ensure exactly one row exists.
  SELECT COUNT(*) INTO ROW_EXISTS FROM "_CDS_DI_LOCK";
  IF :ROW_EXISTS = 0 THEN
    INSERT INTO "_CDS_DI_LOCK" (ID) VALUES (1);
  END IF;
  COMMIT;
END;
