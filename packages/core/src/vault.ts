import { z } from "zod";
import { CoinType, SuiAddress, SuiObjectID } from "./primitives";
import { CoinLimitsState } from "./policy";

export const VaultInput = z.object({
  periodLengthMs: z.number().int().positive(),
});
export type VaultInput = z.infer<typeof VaultInput>;

export const Vault = z.object({
  id: SuiObjectID,
  owner: SuiAddress,
  periodLengthMs: z.number().int().positive(),
  limits: z.record(CoinType, CoinLimitsState),
  // Balances deliberately not modelled. They are live chain
  // read via indexer/RPC. This schema only covers what the
  // vault itself governs.
});
export type Vault = z.infer<typeof Vault>;
