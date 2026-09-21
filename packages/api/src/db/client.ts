import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { socketHostFromUrl } from "./socket-host";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL not set");
}

const relations = defineRelations(schema, () => ({}));

const socketHost = socketHostFromUrl(connectionString);
const client = socketHost
  ? postgres(connectionString, { host: socketHost })
  : postgres(connectionString);

export const db = drizzle({
  client,
  relations,
});
