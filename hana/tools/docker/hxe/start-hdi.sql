-- Ensures that the HDI is enabled on the system
DO
BEGIN
  DECLARE dbName NVARCHAR(25) = 'HXE';
  DECLARE diserverCount INT = 0;
  SELECT COUNT(*) INTO diserverCount FROM SYS_DATABASES.M_SERVICES WHERE SERVICE_NAME = 'diserver' AND DATABASE_NAME = :dbName AND ACTIVE_STATUS = 'YES';
  IF diserverCount = 0 THEN 
    EXEC 'ALTER DATABASE ' || :dbName || ' ADD ''diserver''';
  END IF;
END;

-- Grants HDI privileges to SYSTEM
CREATE LOCAL TEMPORARY TABLE #PRIVILEGES LIKE _SYS_DI.TT_API_PRIVILEGES;
INSERT INTO #PRIVILEGES (PRINCIPAL_NAME, PRIVILEGE_NAME, OBJECT_NAME) SELECT 'SYSTEM', PRIVILEGE_NAME, OBJECT_NAME FROM _SYS_DI.T_DEFAULT_DI_ADMIN_PRIVILEGES;
CALL _SYS_DI.GRANT_CONTAINER_GROUP_API_PRIVILEGES('_SYS_DI', #PRIVILEGES, _SYS_DI.T_NO_PARAMETERS, ?, ?, ?);
DROP TABLE #PRIVILEGES;

-- Forces all statistics tables to use NSE
CALL _SYS_STATISTICS.SHARED_ALTER_PAGE_LOADABLE;

-- Selects all tables that are loaded and unloads them from memory
DO
BEGIN
  DECLARE v_isbn VARCHAR(20) = '';
  DECLARE CURSOR c_cursor1 (v_isbn VARCHAR(20)) FOR
    SELECT schema_name,table_name FROM m_cs_tables WHERE loaded != 'NO';

  FOR cur_row AS c_cursor1(v_isbn) DO
    EXEC 'UNLOAD ' || :cur_row.schema_name || '.' || :cur_row.table_name || ' DELETE PERSISTENT MEMORY';
  END FOR;
END;

-- Configure maximum memory allocation to 8192MiB as this does not translate to physical memory
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'system') SET ('memorymanager', 'global_allocation_limit') = '10240' WITH RECONFIGURE;
