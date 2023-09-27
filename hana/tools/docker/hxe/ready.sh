until docker cp ./start-hdi.sql hxe_hana_1:/usr/sap/HXE/start-hdi.sql
do
  sleep 1
done

docker exec hxe_hana_1 bash -c "until /check_hana_health -n -e ready-status > /dev/null; do sleep 1; done;"
echo "HANA has started"
docker exec hxe_hana_1 bash -c "/usr/sap/HXE/HDB90/exe/hdbsql -i 90 -d SYSTEMDB -u SYSTEM -p Manager1 -I /usr/sap/HXE/start-hdi.sql > /dev/null && sleep 10"
echo "HDI has been enabled"
