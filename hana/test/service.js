module.exports = {
  "impl": "@cap-js/hana",
  "credentials": {
    "user": process.env.HANA_USER || "SYSTEM",
    "password": process.env.HANA_PASSWORD || "Manager1",
    "host": process.env.HANA_HOST || "localhost",
    "port": process.env.HANA_PORT || "30041",
    "useTLS": false,
    "encrypt": false,
    "sslValidateCertificate": false,
    "disableCloudRedirect": false,
    "driver": "hana-client"
  }
}