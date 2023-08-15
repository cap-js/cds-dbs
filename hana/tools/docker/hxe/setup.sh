/run_hana --agree-to-sap-license --dont-check-system --dont-check-mount-points --master-password Manager1 &
until /check_hana_health -n -e ready-status > /dev/null; do sleep 1; done;
/usr/sap/HXE/HDB90/exe/hdbsql -i 90 -d SYSTEMDB -u SYSTEM -p Manager1 -I /usr/sap/HXE/start-hdi.sql

kill -TERM -- -0
wait
