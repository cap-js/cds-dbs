ALTER SYSTEM ALTER CONFIGURATION ('indexserver.ini', 'DATABASE', 'H00') SET ('session', 'enable_proxy_protocol') = 'false' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'System') SET ('public_hostname_resolution', 'use_default_route') = 'name' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'System') SET ('expensive_statement', 'enable') = 'TRUE' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'System') SET ('expensive_statement', 'threshold_duration') = '0' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'System') SET ('expensive_statement', 'trace_parameter_values') = 'FALSE' WITH RECONFIGURE;
ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'System') SET ('expensive_statement', 'use_in_memory_tracing') = 'FALSE' WITH RECONFIGURE;
