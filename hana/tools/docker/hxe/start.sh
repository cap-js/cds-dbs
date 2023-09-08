if [ $IMAGE_ID ] && [ $TAG ]; then
    echo "Using prepared HXE image"
    docker-compose -f ci.yml up -d;
else
    export VERSION=$(node ./latest.js);
    docker-compose -f hana.yml up -d;
fi
./ready.sh;
