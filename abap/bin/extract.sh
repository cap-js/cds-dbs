## TODO: use following find command to identify the source of the ABAP odbc linux driver and download it out of the HANA binaries
## docker exec hce-hana-1 find /hana/shared/ -name "ODBC_driver_for_ABAP.so"
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/libsapcrypto.so > libsapcrypto.so
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/sapgenpse > sapgenpse
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/ODBC_driver_for_ABAP.so > ODBC_driver_for_ABAP.so
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/libicudata65.so > libicudata65.so
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/libicudecnumber.so > libicudecnumber.so
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/libicui18n65.so > libicui18n65.so
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/libicuuc65.so > libicuuc65.so
