HOST=repositories.cloud.sap
VERSION=$(node ./latest.js)
if [ -z "$VERSION" ]; then
    echo "No version found"
    exit 1
fi

IMAGE=public.int.$HOST/com.sap.hana.cloud.hana/hana-master:$VERSION

echo $VERSION

if [ $(docker images $IMAGE -q) ]; then
    echo 'latest image is up-to-date';
else
    docker pull $IMAGE;
    echo 'latest image has been updated'
fi

docker tag $IMAGE hana-master:current
