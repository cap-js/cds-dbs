#!/bin/bash
set -eo pipefail

until docker cp ./otel.sh hce-hana-1:/otel.sh; do sleep 1; done
docker cp ./configure.sql hce-hana-1:/usr/sap/H00/configure.sql
docker cp ./configure-otel.sql hce-hana-1:/usr/sap/H00/configure-otel.sql

docker exec hce-hana-1 /bin/bash -c "while ! ./check_hana_health ; do sleep 10 ; done"

docker exec -i hce-hana-1 /bin/bash <<'EOF'
cd /usr/sap/H00/HDB00
. ./hdbenv.sh ""
hdbuserstore -i SET SYSDBKEY localhost:30013@SYSTEMDB SYSTEM Manager1
hdbsql -U SYSDBKEY -e -ssltrustcert -I /usr/sap/H00/configure.sql
hdbsql -U SYSDBKEY -e -ssltrustcert -I /usr/sap/H00/configure-otel.sql
EOF

docker exec -d hce-hana-1 /bin/bash -c "pgrep -f '^/bin/bash /otel.sh' >/dev/null || nohup /otel.sh >/dev/null 2>&1"
