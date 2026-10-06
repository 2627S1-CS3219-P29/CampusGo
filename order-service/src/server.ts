import { prisma } from "./db.ts";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // GET /orders -> Fetch all open orders for the frontend dashboard
  if (req.method === "GET" && url.pathname === "/orders") {
    try {
      const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'desc' } // Shows newest orders first
      });
      
      return new Response(JSON.stringify(orders), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Failed to fetch orders" }), { status: 500 });
    }
  }

  // POST /orders -> Create a new order (Erands async workflow)
  if (req.method === "POST" && url.pathname === "/orders") {
    try {
      const body = await req.json();
      
      const newOrder = await prisma.order.create({
        data: {
          requesterId: body.requesterId,
          pickupLocation: body.pickupLocation,
          dropoffLocation: body.dropoffLocation,
          itemDescription: body.itemDescription,
          creditBounty: body.creditBounty,
          status: "CREATED", // Enforcing the initial lifecycle state
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // Expires in 24 hrs
        },
      });

      return new Response(JSON.stringify(newOrder), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Failed to create order" }), { status: 400 });
    }
  }

  // 404 Fallback for undefined routes
  return new Response("Endpoint Not Found", { status: 404 });
});


