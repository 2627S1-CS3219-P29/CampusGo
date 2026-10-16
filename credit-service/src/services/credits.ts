export async function ensureCreditAccount(userId: number): Promise<void> {
    // Atomically create the account if absent.
    // Leave existing accounts and balances unchanged.
}