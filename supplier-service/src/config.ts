import "dotenv/config";

const dbConnectionString = Deno.env.get("DATABASE_URL");

const config = {
    shouldGenerateLogfile: false,
    dbConnectionString,
};

export default config;
