import "dotenv/config";

function required(name: string): string {
    const value = process.env[name];
    if (!value || value.trim().length === 0) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const dbConnectionString = Deno.env.get("DATABASE_URL");

const config = {
    shouldGenerateLogfile: false,
    jwt: {
        // shared with the user service, which signs the access tokens
        accessKey: required('JWT_ACCESS_SECRET'),
        issuer: 'user-service',
    },
    order: {
        // an order that no courier accepts within this window expires
        expiryMs: 24 * 60 * 60 * 1000,
        // orders per page in GET /orders, same as the supplier list
        pageSize: 20,
    },
    // supplier service on the private docker network (alias supplier_api)
    supplierServiceUrl: Deno.env.get("SUPPLIER_SERVICE_URL") ?? 'http://supplier_api:3000',
    dbConnectionString,
};

export default config;
