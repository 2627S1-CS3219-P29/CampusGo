import { Application, Router } from "@oak/oak";
import { initSupplierDatabase, suppliersTable } from "./db.ts";
import type { Supplier } from "./types.ts";

// 1. Boot up database by loading the CSV
await initSupplierDatabase();

// 2. Set up API routes
const router = new Router({ prefix: "/public/suppliers" });

// GET /public/suppliers — List all suppliers with search & type filter
router.get("/", (ctx) => {
  const search = ctx.request.url.searchParams.get("search")?.toLowerCase();
  const type = ctx.request.url.searchParams.get("type")?.toLowerCase();

  let results = suppliersTable;

  if (type) {
    results = results.filter((s) => s.type.toLowerCase() === type);
  }

  if (search) {
    results = results.filter(
      (s) =>
        s.name.toLowerCase().includes(search) ||
        s.building.toLowerCase().includes(search) ||
        s.locationDescription.toLowerCase().includes(search)
    );
  }

  ctx.response.status = 200;
  ctx.response.body = results;
});

// GET /public/suppliers/:id — Get details of one specific supplier
router.get("/:id", (ctx) => {
  const id = Number(ctx.params.id);
  const supplier = suppliersTable.find((s) => s.id === id);

  if (!supplier) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Supplier not found" };
    return;
  }

  ctx.response.status = 200;
  ctx.response.body = supplier;
});

// POST /public/suppliers — Create a new supplier (FR 5.1 & FR 5.5.1)
router.post("/", async (ctx) => {
  const body = await ctx.request.body.json();

  if (!body.name) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Supplier name is required" };
    return;
  }

  const exists = suppliersTable.some(
    (s) => s.name.trim().toLowerCase() === body.name.trim().toLowerCase()
  );
  if (exists) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Supplier with this name already exists" };
    return;
  }

  const newSupplier: Supplier = {
    id: suppliersTable.length + 1,
    name: body.name.trim(),
    type: body.type?.trim() || "Food",
    building: body.building?.trim() || "",
    floor: body.floor?.trim() || "",
    locationDescription: body.locationDescription?.trim() || "",
    latitude: Number(body.latitude) || 0.0,
    longitude: Number(body.longitude) || 0.0,
    startingTime: body.startingTime?.trim() || "0900hrs",
    closingTime: body.closingTime?.trim() || "1800hrs",
    imageUrl: body.imageUrl?.trim() || "",
  };

  suppliersTable.push(newSupplier);
  ctx.response.status = 201;
  ctx.response.body = newSupplier;
});

// PUT /public/suppliers/:id — Update an existing supplier (FR 5.3)
router.put("/:id", async (ctx) => {
  const id = Number(ctx.params.id);
  const index = suppliersTable.findIndex((s) => s.id === id);

  if (index === -1) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Supplier not found" };
    return;
  }

  const body = await ctx.request.body.json();
  suppliersTable[index] = {
    ...suppliersTable[index],
    name: body.name?.trim() ?? suppliersTable[index].name,
    type: body.type?.trim() ?? suppliersTable[index].type,
    building: body.building?.trim() ?? suppliersTable[index].building,
    floor: body.floor?.trim() ?? suppliersTable[index].floor,
    locationDescription: body.locationDescription?.trim() ?? suppliersTable[index].locationDescription,
    startingTime: body.startingTime?.trim() ?? suppliersTable[index].startingTime,
    closingTime: body.closingTime?.trim() ?? suppliersTable[index].closingTime,
    imageUrl: body.imageUrl?.trim() ?? suppliersTable[index].imageUrl,
  };

  ctx.response.status = 200;
  ctx.response.body = suppliersTable[index];
});

// DELETE /public/suppliers/:id — Delete a supplier (FR 5.4)
router.delete("/:id", (ctx) => {
  const id = Number(ctx.params.id);
  const index = suppliersTable.findIndex((s) => s.id === id);

  if (index === -1) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Supplier not found" };
    return;
  }

  suppliersTable.splice(index, 1);
  ctx.response.status = 200;
  ctx.response.body = { message: "Supplier deleted" };
});

// 3. Initialize Oak Application & CORS
const app = new Application();

// Enable CORS so the Vue frontend on port 5173 can query this service
app.use(async (ctx, next) => {
  ctx.response.headers.set("Access-Control-Allow-Origin", "*");
  ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = 204;
    return;
  }
  await next();
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = 3001;
console.log(`[supplier-service]: Starting on port ${PORT}...`);
await app.listen({ port: PORT });