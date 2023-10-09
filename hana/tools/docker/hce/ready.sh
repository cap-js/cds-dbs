docker exec hce_hana_1 /bin/bash -c "while ! ./check_hana_health ; do sleep 10 ; done;"
docker exec -it hce_hana_1 /bin/bash -c "\
cd /usr/sap/H00/HDB00;\
. ./hdbenv.sh;\
hdbuserstore -i SET SYSDBKEY localhost:30013@SYSTEMDB SYSTEM Manager1;\
hdbsql -U \"SYSDBKEY\" -e -ssltrustcert \"SELECT COUNT(ACTIVE_STATUS) FROM SYS_DATABASES.M_SERVICES WHERE ACTIVE_STATUS='YES'\";\
hdbsql -U \"SYSDBKEY\" -e -ssltrustcert \"ALTER SYSTEM ALTER CONFIGURATION ('indexserver.ini', 'DATABASE', 'H00') SET ('session', 'enable_proxy_protocol') = 'false' WITH RECONFIGURE;\";\
hdbsql -U \"SYSDBKEY\" -e -ssltrustcert \"ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'System') SET ('public_hostname_resolution', 'use_default_route') = 'name' WITH RECONFIGURE;\";\
"
