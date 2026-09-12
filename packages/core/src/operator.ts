import { z } from "zod";
import { SuiObjectID } from "./primitives";

export const OperatorCap = z.object({
  id: SuiObjectID,
  agentCapId: SuiObjectID,
  generation: z.number().int().nonnegative(),
});
export type OperatorCap = z.infer<typeof OperatorCap>;
