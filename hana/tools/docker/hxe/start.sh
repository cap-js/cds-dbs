if [ $HXE_PULL ] then
    wait $HXE_PULL;
fi

exists=$(docker images hanaexpress:current -q);
if [ $exists ]; then
    echo "Using prepared HXE image"
    docker-compose -f ci.yml up -d;
    docker exec hxe_hana_1 bash -c "until /check_hana_health -n -e ready-status > /dev/null; do sleep 1; done;"
    echo "HANA has started"
else
    export VERSION=$(node ./latest.js);
    docker-compose -f hana.yml up -d;
    ./ready.sh;
fi
