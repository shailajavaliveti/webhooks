'use strict'

/**
 * New Relic agent configuration.
 *
 * See lib/config.defaults.js in the agent distribution for a more complete
 * description of configuration variables and their potential values.
 */
exports.config = {
  /**
   * Array of application names.
   */
  app_name: ['RallyWebhooksConsumer'],
  /**
   * Disable the agent by default, on prod servers
   * set the NEW_RELIC_ENABLED environment variable to 'true'
   * to enable the agent (will override this setting)
  */
  agent_enabled: false,
  /**
   * Your New Relic license key.
   */
  license_key: 'd48330fabd5db4101333fb6a9e7d1ae07da7a1d9',
  logging: {
    /**
     * Level at which to log. 'trace' is most useful to New Relic when diagnosing
     * issues with the agent, 'info' and higher will impose the least overhead on
     * production applications.
     */
    level: 'warn'
  },
  proxy: 'http://proxy.fm.intel.com:911/'
}
