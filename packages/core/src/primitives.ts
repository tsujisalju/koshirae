import { z } from "zod";
import { normalizeStructTag, SUI_TYPE_ARG } from "@mysten/sui/utils";

export function normalizeCoinType(coinType: string): string {
  return normalizeStructTag(coinType);
}

/** SUI in the same normalized form requests and chain reads carry. */
export const SUI_COIN_TYPE = normalizeCoinType(SUI_TYPE_ARG);

export const CoinAmount = z
  .string()
  .regex(/^\d+$/, "must be a decimal integer string");
export type CoinAmount = z.infer<typeof CoinAmount>;

export const SuiAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/, "must be a 0x-prefixed hex address");
export type SuiAddress = z.infer<typeof SuiAddress>;

export const SuiObjectID = SuiAddress;
export type SuiObjectID = z.infer<typeof SuiObjectID>;

export const CoinType = z
  .string()
  .regex(/^0x[0-9a-fA-F]+::\w+::\w+$/, "must be a fully-qualified coin type");
export type CoinType = z.infer<typeof CoinType>;
