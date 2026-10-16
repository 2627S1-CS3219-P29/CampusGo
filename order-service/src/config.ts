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
        // how long an order waits for a courier before it expires; the requester picks a
        // duration within these limits, or gets the default (24h, the original fixed value)
        expiry: {
            defaultMinutes: 24 * 60,
            minMinutes: 15,
            maxMinutes: 24 * 60,
            // a collected errand is overdue after its deadline, and only expires (refunding the
            // requester) once this much longer has passed, so a late courier holding the item can still deliver
            collectedGraceMinutes: 2 * 60,
            // how often the background job expires due errands
            checkIntervalMs: 60_000,
        },
        // orders per page in GET /orders, same as the supplier list
        pageSize: 20,
    },
    // supplier service on the private docker network (alias supplier_api)
    supplierServiceUrl: Deno.env.get("SUPPLIER_SERVICE_URL") ?? 'http://supplier_api:3000',
    dbConnectionString,
};

export default config;
