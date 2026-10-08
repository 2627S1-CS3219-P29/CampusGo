import { config as loadEnv } from 'dotenv';

// Resolve from this file so commands can run from either project directory.
loadEnv({ path: new URL('../../.env', import.meta.url), quiet: true });

const config = {
  dbConnectionString:
    process.env.DATABASE_URL?.trim() || process.env.CREDIT_DB_URL?.trim(),
};

export default config;
