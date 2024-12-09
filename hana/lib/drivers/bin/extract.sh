## TODO: use following find command to identify the source of the ABAP odbc linux driver and download it out of the HANA binaries
## docker exec hce-hana-1 find /hana/shared/ -name "libodbcHDB.so"
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/libsapcrypto.so > libsapcrypto.so
docker exec hce-hana-1 cat /hana/shared/H00/exe/linuxx86_64/HDB_4.00.000.00.1728375763_870b57d282c6ae9aedc90ae2f41f20321f3e060a/libodbcHDB.so > libodbcHDB.so
