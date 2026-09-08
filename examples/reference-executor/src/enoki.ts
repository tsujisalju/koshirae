import "dotenv/config";
import { EnokiClient } from "@mysten/enoki";

// Enoki's createSponsoredTransaction/executeSponsoredTransaction require a
// PRIVATE API key (confirmed via a live 403 — "Private API key required for
// this endpoint" — when the frontend attempted these calls with the public
// key). The public key used for zkLogin wallet registration on the frontend
// is not authorized for the gas station; the private key must never reach
// the browser, so these calls live here instead.
export const enokiClient = new EnokiClient({
  apiKey: process.env.ORONYX_ENOKI_PRIVATE_API_KEY!,
});
