import { z } from "zod";

// Query params shared by every list endpoint. The cursor is opaque to
// clients: pass back whatever the previous page returned as nextCursor.
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

// Every list endpoint returns this shape. nextCursor is null on the last page.
// A page may hold fewer than `limit` items while nextCursor is non-null.
// Clients should follow the cursor until it is null.
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
