import { fromBase64 } from "@mysten/sui/utils";
import { ApiError } from "../errors";

const SUI_GRAPHQL_URL = process.env.SUI_GRAPHQL_URL;

// The indexer caps page size at 50 (serviceConfig.maxPageSize).
const GRAPHQL_PAGE_SIZE = 50;

// Bounds one request's work when most events are filtered out client-side.
const MAX_PAGES_PER_REQUEST = 10;

const INDEX_POLL_MS = 50;
const INDEX_TIMEOUT_MS = 5_000;

export async function graphqlQuery<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  // Checked per call, not at startup, so the API runs without GraphQL configured.
  if (!SUI_GRAPHQL_URL) throw new Error("SUI_GRAPH_URL is not set");
  const res = await fetch(SUI_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("GraphQL returned no data");
  return body.data;
}

// GraphQL counterpart of waitForAfterDigest. Events and transaction
// lookup become visible together, and GraphQL trails gRPC, so once this
// returns both read paths have caught up to the digest.
export async function waitForIndexedDigest(afterDigest: unknown): Promise<void> {
  if (typeof afterDigest !== "string") return;
  const deadline = Date.now() + INDEX_TIMEOUT_MS;
  for (;;) {
    const data = await graphqlQuery<{ transaction: { digest: string } } | null>(
      `query ($digest: String!) { transaction(digest: $digest) { digest } }`,
      { digest: afterDigest },
    );
    if (data?.transaction) return;
    if (Date.now() >= deadline) {
      throw new ApiError("transaction_not_found", `Transaction ${afterDigest} is not indexed yet`);
    }
    await new Promise((resolve) => setTimeout(resolve, INDEX_POLL_MS));
  }
}

const EVENTS_QUERY = `
  query ($filter: EventFilter!, $last: Int!, $before: String) {
    events(last: $last, before: $before, filter: $filter) {
      pageInfo { hasPreviousPage startCursor }
      edges { cursor node { contents { bcs } } }
    }
  }
  `;

interface EventsResponse {
  events: {
    pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
    edges: { cursor: string; node: { contents: { bcs: string } | null } }[];
  };
}

// Walks one event type from one sender, newest first, keeping the events
// `decode` accepts. The GraphQL filter can't match on event fields, so
// field-level filtering (e.g. "this vault's caps") happens in `decode`.
//
// The returned cursor is the last event examined, so the next call resumes
// exactly after it. When MAX_PAGES_PER_REQUEST runs out first, the page application
// hold fewer than `limit` items and still have a nextCursor.
export async function scanEvents<T>(opts: {
  type: string;
  sender: string;
  limit: number;
  cursor?: string;
  decode: (bcs: Uint8Array) => T | null;
}): Promise<{ items: T[]; nextCursor: string | null }> {
  const items: T[] = [];
  let before = opts.cursor ?? null;

  for (let page = 0; page < MAX_PAGES_PER_REQUEST; page++) {
    const { events } = await graphqlQuery<EventsResponse>(EVENTS_QUERY, {
      filter: { type: opts.type, sender: opts.sender },
      last: GRAPHQL_PAGE_SIZE,
      before,
    });
    // `last` still returns edges olders-first within the page.
    const newestFirst = [...events.edges].reverse();

    for (const [i, edge] of newestFirst.entries()) {
      const item = edge.node.contents ? opts.decode(fromBase64(edge.node.contents.bcs)) : null;
      if (item !== null) items.push(item);
      if (items.length === opts.limit) {
        const moreExist = i < newestFirst.length - 1 || events.pageInfo.hasPreviousPage;
        return { items, nextCursor: moreExist ? edge.cursor : null };
      }
    }

    if (!events.pageInfo.hasPreviousPage || !events.pageInfo.startCursor) {
      return { items, nextCursor: null };
    }
    before = events.pageInfo.startCursor;
  }
  return { items, nextCursor: before };
}
