ALTER SYSTEM ALTER CONFIGURATION ('indexserver.ini', 'DATABASE', 'H00') SET ('session', 'enable_proxy_protocol') = 'false' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'System') SET ('public_hostname_resolution', 'use_default_route') = 'name' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('indexserver.ini','SYSTEM') SET ('sql','plan_cache_size') = '268435456' WITH RECONFIGURE;
EXEC 'ALTER SYSTEM ALTER CONFIGURATION (''global.ini'', ''system'') SET (''memorymanager'', ''global_allocation_limit'') = ''' || (SELECT (USED_PHYSICAL_MEMORY + FREE_PHYSICAL_MEMORY) * 1.5 / 1048576 FROM M_HOST_RESOURCE_UTILIZATION) || ''' WITH RECONFIGURE';

-- expensive_statement tracing is opt-in for local OTel development; see
-- configure-otel.sql (applied by ready.sh when start.sh is invoked with --otel).

-- Make PAGE the default load unit for all newly created column tables (NSE).
ALTER SYSTEM ALTER CONFIGURATION ('indexserver.ini', 'SYSTEM') SET ('table_default', 'default_load_unit') = 'PAGE' WITH RECONFIGURE;

-- Replacement for the deprecated _SYS_STATISTICS.SHARED_ALTER_PAGE_LOADABLE:
-- convert every existing COLUMN table (including partitions) to PAGE LOADABLE.
DO
BEGIN
  FOR t AS
    SELECT schema_name, table_name
      FROM TABLES
     WHERE table_type = 'COLUMN'
       AND load_unit  <> 'PAGE'
       AND schema_name NOT LIKE '\_SYS%' ESCAPE '\'
       AND schema_name NOT IN ('SYS', 'SYSTEM', 'HANA_XS_BASE')
  DO
    EXEC 'ALTER TABLE "' || :t.schema_name || '"."' || :t.table_name || '" PAGE LOADABLE CASCADE';
  END FOR;
END;

DO
BEGIN
  DECLARE v_isbn VARCHAR(20) = '';
  DECLARE CURSOR c_cursor1 (v_isbn VARCHAR(20)) FOR
    SELECT schema_name, table_name FROM m_cs_tables WHERE loaded != 'NO';

  FOR cur_row AS c_cursor1(v_isbn) DO
    EXEC 'UNLOAD ' || :cur_row.schema_name || '.' || :cur_row.table_name || ' DELETE PERSISTENT MEMORY';
  END FOR;
END;

