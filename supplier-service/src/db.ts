import { PrismaClient } from "npm:@prisma/client@^5.22.0";
import { parse } from "@std/csv";

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: Deno.env.get("DATABASE_URL"),
    },
  },
});

export async function initSupplierDatabase() {
  try {
    // 1. Connect to PostgreSQL
    await prisma.$connect();
    console.log("[Supplier DB]: Connected to PostgreSQL successfully.");

    // 2. Idempotent check: only seed if the table is empty
    const existingCount = await prisma.supplier.count();
    if (existingCount > 0) {
      console.log(`[Supplier DB]: Database already initialized (${existingCount} suppliers found). Skipping seed.`);
      return;
    }

    // 3. Resolve CSV file path and read contents
    const csvUrl = new URL("../../data/csv/supplier-seed-data.csv", import.meta.url);
    const csvRawText = await Deno.readTextFile(csvUrl);
    const records = parse(csvRawText, { skipFirstRow: true });

    // 4. Batch insert the campus suppliers into PostgreSQL
    for (const row of records as Record<string, string>[]) {
      const name = row["Name"]?.trim();
      if (!name) continue;

      await prisma.supplier.create({
        data: {
          name: name,
          type: row["Type"]?.trim() || "Food",
          building: row["Building"]?.trim() || "",
          floor: row["Floor"]?.trim() || "",
          locationDescription: row["Location Description"]?.trim() || "",
          latitude: parseFloat(row["Latitude"]) || 0.0,
          longitude: parseFloat(row["Longitude"]) || 0.0,
          startingTime: row["StartingTime"]?.trim() || "0900hrs",
          closingTime: row["ClosingTime"]?.trim() || "1800hrs",
          imageUrl: row["ImageURL"]?.trim() || null,
          isActive: true,
        },
      });
    }

    const seededCount = await prisma.supplier.count();
    console.log(`[Supplier DB]: Successfully seeded ${seededCount} suppliers into PostgreSQL.`);
  } catch (error) {
    console.error("[Supplier DB]: Failed to initialize database:", error);
    throw error;
  }
}