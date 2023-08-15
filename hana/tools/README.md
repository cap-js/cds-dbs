# Tools

This folder contains some tools that are used to maintain the `HANA` service `lib` folder with up-to-date data.

## collation

Takes the collation dictionary and converts it to the `collations.json` file for easy consumption. In case the collation dictionary changes the `collation.js` file can be used to update the `collations.json` file.

## docker

Contains scripts that allow for anyone to start a `HANA` instance in their local docker. These scripts will be automatically used when running `npm run setup` in the `cds-dbs/hana` folder. The scripts will automatically detect what is the latest available `HANA` version for the current system and will `pull` the image and run any additional configuration scripts and run the respective health check to verify the system was fully initialized.

Initial setup will take significantly longer then subsequent setups. The longest time is mostly pulling the image. Once the image is on the system initial boot time will takes a few minutes. After that restarting the container takes under a minute.

To keep Github actions as fast as possible a prepared image is pushed to the Github repository. This means that the download is done within Github infrastructure and the boot time will be equivalent to the restart time rather then the initial boot time.
