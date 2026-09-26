import { parse } from "@std/csv";
import type { Supplier } from "./types.ts";

export const suppliersTable: Supplier[] = []; // const var to store list of shops 

export async function initSupplierDatabase() {
    try{
        const csvPath = new URL("../../data/csv/supplier-seed-data.csv", import.meta.url);
        const content = await Deno.readTextFile(csvPath);
        const records = parse(content, { skipFirstRow: true });

        let currentId = 1;
        for (const row of records as Record<string, string>[]) {
            suppliersTable.push({
                id: currentId++, // assign id starting at 1  and increments
                name: row["Name"]?.trim() ?? "",
                type: row["Type"]?.trim() ?? "",
                building: row["Building"]?.trim() ?? "",
                floor: row["Floor"]?.trim() ?? "",
                locationDescription: row["Location Description"]?.trim() ?? "",
                latitude: parseFloat(row["Latitude"]) || 0.0,
                longitude: parseFloat(row["Longitude"]) || 0.0,
                startingTime: row["Starting Time"]?.trim() ?? "",
                closingTime: row["Closing Time"]?.trim() ?? "",
                imageUrl: row["Image URL"]?.trim() ?? "",
            }); // for loop
        }

        console.log(`[Supplier DB]: Successfully seeded ${suppliersTable.length} suppliers.`);
    } catch (error) {
      console.error(`[Supplier DB]: Error reading seed CSV:`, error);
    }


}