# Supplier Service

Stores the places on campus that errands can be requested from: **stores**, **facilities**
and **landmarks**. It covers FR 5 (admin management), FR 6 (listing, search, sort, filter)
and NFR 4 to 6.

## Database choice: PostgreSQL

We use one PostgreSQL 18 database per service (`supplier_db`). The supplier service is the
only thing that reads or writes it. Other services go through its API.

| FoC need | Why PostgreSQL fits |
| --- | --- |
| **The data has a fixed structure.** Every supplier has the same six fields from FR 5 (name, type, location, description, opening time, closing time). No supplier needs extra fields that others lack. | A fixed table schema matches this. A document database's flexible schema adds nothing here and would let bad records in. |
| **The rules are relational.** A store or facility sits *at* a landmark. A landmark still referenced by stores cannot be deleted or re-typed (FR 5.10, 5.11). | A foreign key from `locationId` to `supplier.id` makes the database enforce these rules instead of every code path. |
| **Validation belongs in the data layer.** Names must be unique (FR 5.5.1), type must be one of three values (FR 5.5.5), location is required for stores and facilities (FR 5.5.3), times must be valid (FR 5.5.6). | Unique indexes, `CHECK` constraints and the native `time` type reject bad rows even when the API has a bug. |
| **The main queries search, filter, sort and paginate.** | SQL does all four in one indexed query (see *Query patterns*). |
| **The data is small and mostly read.** It starts at 100 suppliers and may grow to 1,000 (NFR 5), with at most 40 req/s at peak (NFR 4). | A single Postgres instance handles this easily, so we don't need to shard or add a cache. If we ever need to scale, read replicas are the next step. |
| **Changes that touch several rows must be atomic.** Soft-deleting a landmark also soft-deletes its stores and writes audit rows. | Transactions make these multi-row changes all-or-nothing. |
| **The team already knows it.** | The user service already uses Postgres with Prisma 8. Reusing the same tools, migrations workflow and Docker setup saves time. |

We considered MongoDB and rejected it. Its strength is flexible, nested documents, and
supplier data has neither. We would also have to rebuild referential integrity and
case-insensitive uniqueness in application code.

## Schema

Source of truth: [src/prisma/contract.prisma](src/prisma/contract.prisma).

```mermaid
erDiagram
    supplier ||--o{ supplier : "locationId (store/facility -> landmark)"
    supplier ||--o{ supplierAuditLog : "supplierId"

    supplier {
        int id PK
        text name "unique, incl. deleted rows"
        text type "store | facility | landmark"
        text description "nullable"
        int locationId FK "landmark id; null only for landmarks"
        time opensAt "nullable"
        time closesAt "nullable"
        int createdBy "user id (user service)"
        int updatedBy "user id (user service)"
        timestamptz createdAt
        timestamptz updatedAt
        timestamptz deletedAt "null = live (soft delete)"
    }
    supplierAuditLog {
        int id PK
        int supplierId FK
        text action "create | update | delete"
        int actorUserId "user id (user service)"
        json snapshot "supplier row at the time"
        timestamptz createdAt
    }
```

### Why a single `supplier` table with a self-reference

In the mockups a landmark (e.g. `COM3`) is both a supplier you can pick and the location
of other suppliers (`Smooy@COM3`, `The Terrace@COM3`). Keeping all three types in one
table means:

- the supplier list, search and filters query one table, with no `UNION`s;
- a store's location is simply its landmark's `id`, and the foreign key guarantees that
  landmark exists;
- changing a landmark's type or deleting it is blocked while stores still point at it
  (FR 5.10). The FK uses `ON DELETE RESTRICT`.

### Supplier metadata

| Field | Stored as | Rules |
| --- | --- | --- |
| Name | `text` | Required, not blank. Unique across all rows, including deleted ones (`UNIQUE (name)`). A second index, `UNIQUE (lower(name)) WHERE "deletedAt" IS NULL`, also stops live suppliers from differing only by case. Because each name is unique and each row has exactly one `locationId`, a name maps to at most one location (FR 5.5.2). |
| Type | `text`, limited by a `CHECK` to `store`, `facility`, `landmark` | Anything else is rejected (FR 5.5.5). |
| Location | `locationId` pointing at `supplier.id` | Required for stores and facilities, forbidden for landmarks. Enforced by a `CHECK` (FR 5.5.3). |
| Description | `text`, nullable | Optional. |
| Opening hours | `opensAt` and `closesAt`, both `time` | Must be both set or both empty. Landmarks can't have hours. `closesAt < opensAt` means the supplier is open past midnight. The `time` type rejects invalid values such as `25:00` (FR 5.5.6). Times are Singapore local time. |
| Who and when | `createdBy`, `updatedBy`, `createdAt`, `updatedAt` | User ids come from the user service's JWT. They are not foreign keys, because the users table lives in another database. |
| Deleted | `deletedAt` | Soft delete, see below. |

### Constraints enforced by the database

These were each tested against a real Postgres 18 instance:

| Constraint | Rejects |
| --- | --- |
| `supplier_name_key` (unique constraint) | Reusing any existing name exactly, even a deleted supplier's |
| `supplier_name_active` (unique index) | Adding `com3` while `COM3` exists |
| `supplier_location_by_type` | A store or facility without a location, or a landmark with one |
| `supplier_hours_paired` | An opening time with no closing time, or the reverse |
| `supplier_landmark_no_hours` | A landmark with opening hours |
| `supplier_name_not_blank` | Empty or whitespace-only names |
| `supplier_type_check` (generated from the enum) | Types other than the three allowed |
| `supplier_locationId_fkey` | Hard-deleting a landmark that stores still reference |

### Enforced in the service layer

A `CHECK` constraint can only see one row, so these rules live in the API:

- **`locationId` must point at a live landmark**, not at a store or a deleted row.
- **Deleting or re-typing a landmark (FR 5.10, 5.11).** Changing the type of a landmark
  that stores point at is rejected. Deleting a landmark soft-deletes its stores and
  facilities in the same transaction, which is how we read "cascade" in FR 5.11.
- **Deleting a supplier with an ongoing errand (FR 5.8).** Before deleting, the service
  asks the order service whether any open errand references the supplier, and rejects
  the delete with an explanation if one does.

### Soft delete and preserving history (FR 5.9)

A delete sets `deletedAt` rather than removing the row, so supplier ids stored in old
errands still resolve. Every read filters on `"deletedAt" IS NULL`. Because `name` is
unique across all rows, a deleted supplier's name can't be reused as it is. The API
should either rename the row on delete (e.g. append `#<id>`) or tell the admin to
restore the old supplier.

As a second safeguard, the order service should also copy the supplier's name and
location into the errand when it is created. A completed errand then shows the details
as they were at that time, even if the supplier is renamed later.

### Audit log (FR 5.12, NFR 6)

Every create, update or delete appends a row to `supplierAuditLog`, holding who made the
change and a JSON snapshot of the supplier. It is written in the same transaction as the
change, so a supplier can't change without leaving a log entry. The service only ever
inserts into this table.

## Query patterns

| Query | Used for | How it runs |
| --- | --- | --- |
| Get one supplier by id | Supplier details (FR 6.1), order service lookups | Primary key |
| List suppliers, paginated and sorted by name A–Z or Z–A | Supplier list (FR 6, 6.3.1) | `ORDER BY lower(name)` uses the `supplier_name_active` index. Pagination uses `LIMIT`/`OFFSET`, which is fine at 1,000 rows |
| Search by name | Search box (FR 6.2) | `lower(name) LIKE lower('%' \|\| $q \|\| '%')`. At 1,000 rows a scan takes well under a millisecond. If it ever grows much larger, a `pg_trgm` index would speed it up |
| Filter by type | Store / Facility / Landmark chips (FR 6.4.1) | Index on `type` |
| Filter to suppliers open now | "Open now" filter (FR 6.4.2) | Compares the Singapore time right now, `(now() AT TIME ZONE 'Asia/Singapore')::time`, against `opensAt` and `closesAt`, handling hours that run past midnight. Suppliers with no hours listed are left out |
| List suppliers at a landmark | Landmark details, delete and re-type checks (FR 5.10, 5.11) | Index on `locationId` |
| Search, sort and filter together | FR 6.7 | All of the above combine as `AND` conditions in one query |
| Audit history of a supplier | Admin audit view | Index on `supplierAuditLog.supplierId` |

## Run locally

Start the database: `docker compose --profile dev up -d supplier_db`. It listens on
`localhost:5433`.

Create `.env` in this folder:

```bash
DATABASE_URL=postgresql://postgres:mysecretpassword@localhost:5433/suppliers
```

Apply the schema: `deno task db:init` the first time, and `deno task db:update` after
changes.

After editing `src/prisma/contract.prisma`, run `deno task contract:emit` to regenerate
`contract.json` and `contract.d.ts`.
