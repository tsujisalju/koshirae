import { z } from "zod";
import { CoinAmount, CoinType, SuiAddress, SuiObjectID } from "./primitives";
import { CoinLimitsState } from "./policy";
import { pageOf, PageQuery } from "./pagination";

export const VaultInput = z.object({
  periodLengthMs: z.number().int().positive(),
});
export type VaultInput = z.infer<typeof VaultInput>;

export const VaultBalances = z.object({
  balances: z.record(CoinType, CoinAmount),
});
export type VaultBalances = z.infer<typeof VaultBalances>;

export const Vault = z.object({
  id: SuiObjectID,
  version: z.number().int().nonnegative(),
  owner: SuiAddress,
  periodLengthMs: z.number().int().positive(),
  limits: z.record(CoinType, CoinLimitsState),
  // Balances deliberately not modelled. They are live chain
  // read via indexer/RPC. This schema only covers what the
  // vault itself governs.
});
export type Vault = z.infer<typeof Vault>;

export const ListByOwnerQuery = PageQuery.extend({ owner: SuiAddress });
export type ListByOwnerQuery = z.infer<typeof ListByOwnerQuery>;

export const VaultPage = pageOf(Vault);
export type VaultPage = z.infer<typeof VaultPage>;
