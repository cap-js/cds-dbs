exists=$(docker images hana-master:current -q);
if [ $exists ]; then
    docker-compose -f hana.yml up -d;
    ./ready.sh;
else
    ./update.sh;
    if [ $? -ne 0 ]; then
        echo "hana-master:current image not found";
        exit 1;
    fi
    ./start.sh;
fi
