// Credit does not expose RPC handlers yet. Register Credit-specific handlers
// on this router when adding an RPC endpoint; User's handlers belong in User.
export { RpcRouter, RpcBadRequest } from "../rpc/router.ts";
