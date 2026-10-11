import config from "../config.ts";
import log from "../log.ts";

export type PickupLookup =
    { found: true; pickupLocation: string } |
    { found: false; reason: "NOT_FOUND" | "UNAVAILABLE" };

interface SupplierResponse {
    name: string;
    floor: number | null;
    locationId: number;
}

interface LocationResponse {
    id: number;
    name: string;
}

/**
 * Looks up a live supplier in the supplier service and describes it as a pickup location,
 * e.g. "Printer @ Com 2, Com 2, Level 1".
 *
 * Uses the supplier service's public endpoints, forwarding the requester's own access token.
 * NOT_FOUND covers unknown and soft-deleted suppliers; UNAVAILABLE means the supplier
 * service could not be reached or failed.
 */
export const lookupPickup = async (supplierId: number, authorization: string): Promise<PickupLookup> => {
    const headers = { Authorization: authorization };
    try {
        const supplierRes = await fetch(`${config.supplierServiceUrl}/public/suppliers/${supplierId}`, { headers });
        if (supplierRes.status === 404)
            return { found: false, reason: "NOT_FOUND" };
        if (!supplierRes.ok) {
            log.error(`supplier service returned ${supplierRes.status} for supplier ${supplierId}`);
            return { found: false, reason: "UNAVAILABLE" };
        }
        const supplier = <SupplierResponse>await supplierRes.json();

        // suppliers only store locationId, the building name comes from the locations list
        const locationsRes = await fetch(`${config.supplierServiceUrl}/public/locations`, { headers });
        const locations = locationsRes.ok ? <LocationResponse[]>await locationsRes.json() : [];
        const building = locations.find(l => l.id === supplier.locationId)?.name;

        const parts = [supplier.name, building, supplier.floor === null ? null : `Level ${supplier.floor}`];
        return { found: true, pickupLocation: parts.filter(p => p).join(", ") };
    } catch (e) {
        log.error(`supplier service unreachable: ${e}`);
        return { found: false, reason: "UNAVAILABLE" };
    }
};
