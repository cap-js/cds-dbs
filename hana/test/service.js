module.exports = {
  "impl": "@cap-js/hana",
  "withHanaAssociations": false,
  "credentials": {
    "user": process.env.HANA_USER || "SYSTEM",
    "password": process.env.HANA_PASSWORD || "Manager1",
    "host": process.env.HANA_HOST || "localhost",
    "port": process.env.HANA_PORT || "30041",
    "useTLS": true,
    "encrypt": true,
    "sslValidateCertificate": false,
    "disableCloudRedirect": true,
    "driver": "hdb"
  }
}