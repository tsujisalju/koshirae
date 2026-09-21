import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL not set");
}

const relations = defineRelations(schema, () => ({}));

// postgres.js doesn't decode a percent-encoded unix-socket dir in the URL
// host (e.g. postgres://user@%2Fvar%2Frun%2Fpostgresql/db), which is the form
// drizzle-kit accepts — decode it and pass it as the `host` option instead.
const urlHost = decodeURIComponent(new URL(connectionString).hostname);
const client = urlHost.startsWith("/")
  ? postgres(connectionString, { host: urlHost })
  : postgres(connectionString);

export const db = drizzle({
  client,
  relations,
});
