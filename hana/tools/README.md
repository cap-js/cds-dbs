# Tools

This folder contains some tools that are used to maintain the `HANA` service `lib` folder with up-to-date data.

## collation

Takes the collation dictionary and converts it to the `collations.json` file for easy consumption. In case the collation dictionary changes the `collation.js` file can be used to update the `collations.json` file.

## hce

Contains scripts that allow for anyone to start a `HANA` instance in their local docker. These scripts will be automatically used when running `npm start` in the `cds-dbs/hana` folder. The scripts will automatically detect what is the latest available `HANA` version for the current system and will `pull` the image and run any additional configuration scripts and run the respective health check to verify the system was fully initialized.

Initial setup will take significantly longer then subsequent setups. The longest time is mostly pulling the image. Once the image is on the system initial boot time will takes a few minutes. After that restarting the container takes under a minute.

