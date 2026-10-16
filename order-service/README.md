# Order Service - Local Setup Guide

This guide covers everything required to spin up the Order Service, seed it with dummy errand data, and test the API routes locally.

Stack: Deno + Oak, Prisma 8 (`@prisma/orm-postgres`), PostgreSQL 18, the same as the user and supplier services.

## 1. Environment Setup
Copy the order service variables from the root `.env.example` into the root `.env` (compose reads it; no `order-service/.env` is needed):
```env
ORDER_DB_URL=postgresql://postgres:mysecretpassword@order_db:5432/orders
ORDER_DB_PW=mysecretpassword
```
`JWT_ACCESS_SECRET` must also be set, since the order service verifies the access tokens the user service signs.

## 2. Start the Service
From the repository root (the folder containing `compose.yaml`):
```docker compose --profile dev up -d --build order_db order_dev```

`order_dev` waits for the database, applies the schema (`deno task db:update_dev`) and starts with live reload. It is reachable as `order_api:3000` inside Docker and at `http://localhost:8004` from your machine.

## 3. Seed Data
Seed the database with dummy UI testing data:
```docker compose --profile dev exec order_dev deno task seed```

## 4. Changing the Schema
1. Edit `src/prisma/contract.prisma`
2. Regenerate `contract.json` and `contract.d.ts`: `docker compose --profile dev exec order_dev deno task contract:emit`
3. Apply it to the database: `docker compose --profile dev exec order_dev deno task db:update`



## API Testing Guide
-----------------

Authentication: every endpoint needs a signed-in user. Log in through the user service (POST http://localhost:8000/api/public/user/auth/login) and send the returned access token on every request:
- Header: "Authorization: Bearer <accessToken>"
- Without a valid token the service returns 401. The requester, caller and their roles always come from the token, so requesterId, callerId and userRole are not sent in the body.

Validation: request bodies are checked; invalid or unknown fields return 400 with the reason per field, e.g. `{ "error": "invalid request body", "fields": { "creditBounty": ["Must be at least 1"] } }`.

URLs: through the edge (as the frontend does) use http://localhost:8000/api/public/order/orders. The service is also exposed directly at http://localhost:8004/public/orders for debugging.

List Orders (GET)
- Method: GET
- URL: http://localhost:8000/api/public/order/orders?scope=open&page=1
- Query parameters (all optional):
    - scope: open (default) = errands a courier can accept (open, not expired, not your own); requested = errands you created; delivering = errands you are the courier on; all = every order (admins only, 403 otherwise)
    - status: comma separated, e.g. status=COMPLETED,CANCELLED,EXPIRED for past orders, or CREATED,ACCEPTED,PICKED_UP for active ones
    - page: 20 orders per page, newest first
- Result: same shape as the supplier list, e.g.
        { "data": [ ...orders ], "pagination": { "page": 1, "limit": 20, "total": 32, "totalPage": 2 } }
  Open orders past their expiry time are marked EXPIRED before listing. Invalid or unknown query parameters return 400.

Fetch One Order (GET)
- Method: GET
- URL: http://localhost:8000/api/public/order/orders/:id
- Result: 200 with the order. The requester, the assigned courier and admins can always see it; anyone else only while it is open (CREATED), otherwise 404. An open order past its expiry time is marked EXPIRED when fetched.

Create a New Order (POST)
- Method: POST
- URL: http://localhost:8000/api/public/order/orders
- Headers: Must include "Idempotency-Key" with a unique string (e.g., "test-req-123") for deduplication.
- Body: (JSON)
    Sample:
        {
          "supplierId": 3,
          "dropoffLocation": "Foyer@PGP",
          "itemDescription": "Printed CS3230 assignment",
          "creditBounty": 5,
          "additionalDetails": "Pages 1-20, double sided",
          "expiresInMinutes": 120
        }
    expiresInMinutes is optional: how long the errand waits for a courier, a whole number from 15 to 1440 (24 hours). Left out, it defaults to 24 hours. If no courier accepts in time, the errand expires.
    Pickup is always a registered supplier: supplierId is required and must be a live supplier in the supplier service (400 "Supplier not found" otherwise, 503 if the supplier service is down). The order service builds pickupLocation from it, e.g. "Printer @ Com 2, Com 2, Level 1", and stores that text as a snapshot. Dropoff is any place the requester types. Put anything more specific (e.g. a room number) in the optional additionalDetails. User ids (requesterId, courierId) are integers taken from the access token.
- Result: Returns a 201 Created status with the newly generated errand, including its auto-assigned UUID and enforced CREATED status. If sent a second time with the exact same Idempotency-Key header, it will safely return a 200 OK with "deduplicated": true instead of double-charging.

Update Order Status (PATCH)
- Method: PATCH
- URL: http://localhost:8000/api/public/order/orders/:id/status (Replace :id with an actual UUID from the GET request)
- Body: (JSON)
    Sample:
        {
          "targetStatus": "ACCEPTED"
        }
    targetStatus is one of ACCEPTED, PICKED_UP, COMPLETED, CANCELLED.
- Result: Returns a 200 OK with the newly updated state. The internal state machine enforces access rules: returns 409 Conflict if attempting to accept an already accepted order, 403 Forbidden if the requester attempts to accept their own order, and 403 Forbidden if anyone but the requester attempts to mark the order as COMPLETED.
- Every status change is a single conditional database update, so two requests racing on the same order (e.g. two couriers accepting at once) cannot both succeed; the loser gets 409.
