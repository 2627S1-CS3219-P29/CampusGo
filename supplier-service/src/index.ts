import { connectDatabase } from "./prisma/db.ts";
import log from "./log.ts";

// placeholder entry point until the API is added
await connectDatabase();
log.info("supplier database connected");
