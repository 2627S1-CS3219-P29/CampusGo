import postgres from '@prisma/orm-postgres/runtime';
import config from '../config.ts';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  url: config.dbConnectionString,
});

let connection: Promise<void> | undefined;

export function connectDatabase(): Promise<void> {
  if (!config.dbConnectionString) {
    return Promise.reject(new Error(
      'Set CREDIT_DB_URL in the project root .env, or provide DATABASE_URL in the environment.',
    ));
  }

  connection ??= db.connect().then(() => undefined).catch((error: unknown) => {
    connection = undefined;
    throw error;
  });
  return connection;
}
