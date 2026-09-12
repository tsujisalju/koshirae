import { z } from "zod";

export const ActionType = z.enum([
  "transfer",
  "mockSwap",
  "stake",
  "cetusSwap",
]);
export type ActionType = z.infer<typeof ActionType>;

// Mirrors action type codes in /move/sources/capabilty.move directly
export const ACTION_TYPE_CODE: Record<ActionType, number> = {
  transfer: 0,
  mockSwap: 1,
  stake: 2,
  cetusSwap: 3,
};
