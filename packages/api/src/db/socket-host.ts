// postgres.js doesn't decode a percent-encoded unix-socket dir in the URL host
// (postgres://user@%2Fvar%2Frun%2Fpostgresql/db) — the form drizzle-kit
// accepts. Detect only that form on the raw string (no URL parsing, so TCP /
// multi-host URLs are never touched) and return the decoded dir for the
// `host` option; undefined means "pass the URL through unchanged".
export function socketHostFromUrl(connectionString: string): string | undefined {
  const m = /^postgres(?:ql)?:\/\/(?:[^@/?#]*@)?(%2F[^/?#:]*)/i.exec(
    connectionString,
  );
  return m ? decodeURIComponent(m[1]) : undefined;
}
