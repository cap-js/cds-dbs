/* eslint-disable no-console */

/**
 * HANA database cleanup utility for cds-dbs tests
 * Adapted from /Users/i543501/SAPDevelop/dev/cds/tests/_runtime/utils/setup.js
 * 
 * Drops old HANA artifacts created during test runs to prevent resource accumulation:
 * - Schemas (existing logic)
 * - User groups
 * - HDI container groups
 */

const serviceConfig = require('../service.js')

/**
 * Drop old HANA schemas created during test runs
 * @param {Object} client - HANA client instance
 */
const dropOldSchemas = async (client) => {
  if (!process.env.CI) process.stdout.write('>>>>> dropping old schemas\n')

  const credentials = serviceConfig.credentials

  // cleanup schemas which are older than two days and were created by the executing user
  // Same SQL query pattern as CDS implementation
  const select = `SELECT SCHEMA_NAME,CREATE_TIME,CURRENT_DATE FROM SYS.SCHEMAS
   WHERE (SCHEMA_NAME LIKE 'SERVICES_%' OR SCHEMA_NAME LIKE '00%' OR SCHEMA_NAME LIKE '20%' OR SCHEMA_NAME LIKE 'TEST_%')
   AND SCHEMA_OWNER = '${credentials.user}'
   AND DAYS_BETWEEN(CREATE_TIME, CURRENT_DATE) >= 2
   AND SCHEMA_NAME != '${credentials.user}'`

  const result = await client.exec(select)

  if (result.length > 0) {
    if (!process.env.CI) process.stdout.write(`>>>>> dropping schemas that are more than 2 days old: ${JSON.stringify(result)} \n`)
    await Promise.all(result.map(element => client.exec(`DROP SCHEMA ${element.SCHEMA_NAME} CASCADE`)))
  }
}

/**
 * Drop old HANA user groups created during test runs
 * @param {Object} client - HANA client instance
 */
const dropOldUserGroups = async (client) => {
  if (!process.env.CI) process.stdout.write('>>>>> dropping old user groups\n')

  const credentials = serviceConfig.credentials

  // Find old user groups created by tests - pattern based cleanup
  const selectUserGroups = `
    SELECT USERGROUP_NAME, CREATE_TIME, CURRENT_DATE 
    FROM SYS.USERGROUPS
    WHERE USERGROUP_NAME LIKE '%_USERS'
    AND CREATOR = '${credentials.user}'
    AND DAYS_BETWEEN(CREATE_TIME, CURRENT_DATE) >= 2`

  const usergroups = await client.exec(selectUserGroups)
  for (const usergroup of usergroups) {
    // get users in the usergroup
    const selectUsers = `SELECT USER_NAME FROM SYS.USERS WHERE USERGROUP_NAME = '${usergroup.USERGROUP_NAME}'`
    const users = await client.exec(selectUsers)
    // remove all users from usergroup
    // or DROP USER ${user.USER_NAME} ?
    if (users.length > 0 && false) await Promise.all(users.map((user) => client.exec(`ALTER USER ${user.USER_NAME} UNSET USERGROUP`)))
    // drop the usergroup
    if (false) await client.exec(`DROP USERGROUP ${usergroup.USERGROUP_NAME}`)
    if (false && !process.env.CI) process.stdout.write(`>>>>> dropped usergroup: ${usergroup.USERGROUP_NAME}\n`)
  }
}

/**
 * Drop old HDI container groups created during test runs
 * @param {Object} client - HANA client instance
 */
const dropOldContainerGroups = async (client) => {
  if (!process.env.CI) process.stdout.write('>>>>> dropping old container groups\n')

  const credentials = serviceConfig.credentials
  // Find old container groups - HDI specific cleanup
  const select = `SELECT CONTAINER_GROUP_USERGROUP_NAME, CONTAINER_GROUP_NAME, CREATE_TIMESTAMP_UTC FROM _SYS_DI.M_ALL_CONTAINER_GROUPS
    WHERE CREATE_USER_NAME = '${credentials.user}'
    AND DAYS_BETWEEN(CREATE_TIMESTAMP_UTC, CURRENT_DATE) >= 2`

  const containerGroups = await client.exec(select)

  if (containerGroups.length > 0 && false) {
    // Use HDI container group API for proper cleanup
    await Promise.all(containerGroups.map(element =>
      client.exec(`CALL _SYS_DI.DROP_CONTAINER_GROUP('${element.CONTAINER_GROUP_NAME}', _SYS_DI.T_NO_PARAMETERS, ?, ?, ?)`)
    ))
    if (!process.env.CI) process.stdout.write(`>>>>> dropping container groups that are more than 2 days old: ${JSON.stringify(containerGroups)} \n`)
  }
}

/**
 * Main cleanup orchestrator function - cleans up all HANA artifacts
 */
const cleanupHanaArtifacts = async () => {
  let hana, client
  const credentials = serviceConfig.credentials
  
  try {
    hana = require('@cap-js/hana/lib/drivers').default
    client = new hana.driver(credentials)
    await client.connect()

    await dropOldSchemas(client)
    await dropOldUserGroups(client)
    await dropOldContainerGroups(client)

    if (!process.env.CI) process.stdout.write('>>>>> HANA cleanup completed \n')

  } catch (error) {
    if (!process.env.CI) process.stdout.write(`>>>>> error in HANA cleanup: ${error} \n`)
  } finally {
    if (client) await client.disconnect()
  }
}

module.exports = {
  cleanupHanaArtifacts,
  dropOldSchemas,
  dropOldUserGroups,
  dropOldContainerGroups
}

// Execute cleanup when run directly (for package.json script)
if (require.main === module) cleanupHanaArtifacts()