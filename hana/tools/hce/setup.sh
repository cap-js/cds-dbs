#!/bin/bash
set -eo pipefail

/run_hana \
  --init \
  role=worker:services=indexserver,dpserver,diserver:database=H00:create \
  --system-password text:Manager1 \
  --database-password text:Manager1 \
  &
HANA_PID=$!

until /check_hana_health -n -e ready-status > /dev/null; do sleep 1; done

cd /usr/sap/H00/HDB00
. ./hdbenv.sh ""
hdbuserstore -i SET SYSDBKEY localhost:30013@SYSTEMDB SYSTEM Manager1
hdbsql -U SYSDBKEY -e -ssltrustcert -I /usr/sap/H00/configure.sql

kill -TERM "$HANA_PID"
wait "$HANA_PID" || true
