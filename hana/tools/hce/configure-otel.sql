ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'SYSTEM') SET ('expensive_statement', 'enable') = 'true' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'SYSTEM') SET ('expensive_statement', 'threshold_duration') = '0' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'SYSTEM') SET ('expensive_statement', 'trace_parameter_values') = 'false' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'SYSTEM') SET ('expensive_statement', 'use_in_memory_tracing') = 'false' WITH RECONFIGURE;
