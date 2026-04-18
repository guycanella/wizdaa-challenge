export default () => ({
    port: parseInt(process.env.PORT || '3000', 10),
    hcm: {
      baseUrl: process.env.HCM_BASE_URL || 'http://localhost:3001',
      timeout: parseInt(process.env.HCM_TIMEOUT || '5000', 10),
      retryAttempts: parseInt(process.env.HCM_RETRY_ATTEMPTS || '3', 10),
      retryBaseDelay: parseInt(process.env.HCM_RETRY_BASE_DELAY || '1000', 10),
    },
    sync: {
      cronExpression: process.env.SYNC_CRON || '0 */6 * * *', // every 6 hours
      enabled: process.env.SYNC_ENABLED !== 'false',
    },
  });