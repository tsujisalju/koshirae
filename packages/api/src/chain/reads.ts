import {
  ACTION_TYPE_CODE,
  ActionType,
  AgentCap,
  CoinLimitsState,
  normalizeCoinType,
  OperatorCap,
  SuiObjectID,
  Vault,
} from "@koshirae/core";
import { bcs } from "@mysten/sui/bcs";
import { CETUS_ORIGINAL_PACKAGE_ID, KOSHIRAE_ORIGINAL_PACKAGE_ID, suiClient } from "./client";
import { normalizeStructTag } from "@mysten/sui/utils";
import { ObjectError, TransactionError } from "@mysten/sui/client";
import { ApiError } from "../errors";

const ACTION_CODE_TO_TYPE = Object.fromEntries(
  Object.entries(ACTION_TYPE_CODE).map(([type, code]) => [code, type as ActionType]),
) as Record<number, ActionType>;

/* BCS Twins */
// Translates raw on-chain bytes into object shapes

// A single-field Move struct serializes identically to its inner field in BCS
// (no length/tag framing), so UID/ID wrappers can be read as a plain address.
const TypeNameBcs = bcs.struct("TypeName", { name: bcs.string() });

const CoinLimitsBcs = bcs.struct("CoinLimits", {
  spendingLimitPerTx: bcs.u64(),
  spendingLimitPeriod: bcs.u64(),
  periodSpent: bcs.u64(),
  periodStartMs: bcs.u64(),
});

// Mirrors sui::vec_map::VecMap<K, V>, which BCS-encodes as `{ contents: vector<Entry<K, V>> }`.
const CoinLimitsMapBcs = bcs.struct("VecMap<TypeName,CoinLimits>", {
  contents: bcs.vector(
    bcs.struct("Entry<TypeName,CoinLimits>", {
      key: TypeNameBcs,
      value: CoinLimitsBcs,
    }),
  ),
});

// Mirrors sui::vec_set::VecSet<T>, which BCS-encodes as `{ contents: vector<T> }`.
const VecSetU8Bcs = bcs.struct("VecSet<u8>", {
  contents: bcs.vector(bcs.u8()),
});
const VecSetAddressBcs = bcs.struct("VecSet<address>", {
  contents: bcs.vector(bcs.Address),
});

// sui::bag::Bag only carries its own UID and a size counter on-chain; the
// entries live in dynamic fields and aren't part of this struct's bytes.
const BagBcs = bcs.struct("Bag", { id: bcs.Address, size: bcs.u64() });

const VaultBcs = bcs.struct("Vault", {
  id: bcs.Address,
  version: bcs.u64(),
  owner: bcs.Address,
  balances: BagBcs,
  limits: CoinLimitsMapBcs,
  periodLengthMs: bcs.u64(),
});

const AgentCapBcs = bcs.struct("AgentCap", {
  id: bcs.Address,
  version: bcs.u64(),
  vaultId: bcs.Address,
  owner: bcs.Address,
  generation: bcs.u64(),
  periodLengthMs: bcs.u64(),
  limits: CoinLimitsMapBcs,
  allowedActions: VecSetU8Bcs,
  allowedTargets: VecSetAddressBcs,
  protocolTargets: VecSetAddressBcs,
  riskThreshold: bcs.u8(),
  expiryMs: bcs.u64(),
  active: bcs.bool(),
  lastNonce: bcs.u64(),
  maxPendingWindowMs: bcs.u64(),
});

// Field order mirrors capability.move's PendingAction exactly.
const PendingActionBcs = bcs.struct("PendingAction", {
  id: bcs.Address,
  capId: bcs.Address,
  vaultId: bcs.Address,
  actionType: bcs.u8(),
  target: bcs.Address,
  amount: bcs.u64(),
  onchainFloor: bcs.u8(),
  reportedRisk: bcs.u8(),
  riskScore: bcs.u8(),
  createdAtMs: bcs.u64(),
  expiryMs: bcs.u64(),
});

const OperatorCapBcs = bcs.struct("OperatorCap", {
  id: bcs.Address,
  agentCapId: bcs.Address,
  generation: bcs.u64(),
});

function parseCoinLimitMap(
  map: ReturnType<(typeof CoinLimitsMapBcs)["parse"]>,
): Record<string, CoinLimitsState> {
  const result: Record<string, CoinLimitsState> = {};
  for (const entry of map.contents) {
    const coinType = normalizeCoinType(`0x${entry.key.name}`);
    result[coinType] = {
      spendingLimitPerTx: entry.value.spendingLimitPerTx,
      spendingLimitPeriod: entry.value.spendingLimitPeriod,
      periodSpent: entry.value.periodSpent,
      periodStartMs: Number(entry.value.periodStartMs),
    };
  }
  return result;
}

function parseAllowedActions(codes: number[]): ActionType[] {
  return codes.map((code) => {
    const type = ACTION_CODE_TO_TYPE[code];
    if (!type) throw new Error(`Unknown action code: ${code}`);
    return type;
  });
}

const koshiraeType = (module: string, name: string) =>
  normalizeStructTag(`${KOSHIRAE_ORIGINAL_PACKAGE_ID}::${module}::${name}`);

const AGENT_CAP_TYPE = koshiraeType("capability", "AgentCap");
const VAULT_TYPE = koshiraeType("capability", "Vault");
const OPERATOR_CAP_TYPE = koshiraeType("operator_cap", "OperatorCap");

async function getObjectOrNotFound(objectId: string, label: string) {
  try {
    const { object } = await suiClient.getObject({
      objectId,
      include: { content: true },
    });
    return object;
  } catch (err) {
    if (err instanceof ObjectError && err.reason !== "unknown") {
      throw new ApiError("not_found", `${label} ${objectId} not found`);
    }
    throw err;
  }
}

async function getTypedObject(objectId: string, expectedType: string, label: string) {
  const object = await getObjectOrNotFound(objectId, label);
  if (object.type !== expectedType) {
    throw new ApiError("not_found", `${objectId} is not a Koshirae ${label}`);
  }
  return object;
}

export async function fetchAgentCap(id: string): Promise<AgentCap> {
  const object = await getTypedObject(id, AGENT_CAP_TYPE, "AgentCap");
  const f = AgentCapBcs.parse(object.content);
  return AgentCap.parse({
    id,
    version: Number(f.version),
    vaultId: f.vaultId,
    owner: f.owner,
    generation: Number(f.generation),
    periodLengthMs: Number(f.periodLengthMs),
    limits: parseCoinLimitMap(f.limits),
    allowedActions: parseAllowedActions(f.allowedActions.contents),
    allowedTargets: f.allowedTargets.contents,
    protocolTargets: f.protocolTargets.contents,
    riskThreshold: f.riskThreshold,
    expiryMs: Number(f.expiryMs),
    active: f.active,
    lastNonce: Number(f.lastNonce),
    maxPendingWindowMs: Number(f.maxPendingWindowMs),
  });
}

export async function fetchOperatorCap(id: string): Promise<{ cap: OperatorCap; owner: string }> {
  const object = await getTypedObject(id, OPERATOR_CAP_TYPE, "OperatorCap");
  const owner = object.owner.AddressOwner;
  if (!owner) {
    throw new ApiError("invalid_request", `OperatorCap ${id} is not held by an address`);
  }
  const f = OperatorCapBcs.parse(object.content);
  return {
    cap: OperatorCap.parse({
      id,
      agentCapId: f.agentCapId,
      generation: Number(f.generation),
    }),
    owner,
  };
}

export async function fetchVault(id: string): Promise<Vault> {
  const object = await getTypedObject(id, VAULT_TYPE, "Vault");
  const f = VaultBcs.parse(object.content);
  return Vault.parse({
    id,
    version: Number(f.version),
    owner: f.owner,
    periodLengthMs: Number(f.periodLengthMs),
    limits: parseCoinLimitMap(f.limits),
  });
}

export async function fetchPoolCoinTypes(poolId: string) {
  const object = await getObjectOrNotFound(poolId, "Cetus pool");
  const prefix =
    normalizeStructTag(`${CETUS_ORIGINAL_PACKAGE_ID}::pool::Pool<`.replace("<", "")) + "<";
  const match = object.type?.startsWith(prefix) ? /Pool<(.+),\s*(.+)>$/.exec(object.type) : null;
  if (!match) throw new ApiError("invalid_request", `Target ${poolId} is not a Cetus pool`);
  return {
    coinTypeA: normalizeCoinType(match[1].trim()),
    coinTypeB: normalizeCoinType(match[2].trim()),
  };
}

export function objectIdParam(value: string, name: string): string {
  const parsed = SuiObjectID.safeParse(value);
  if (!parsed.success) throw new ApiError("invalid_request", `${name} is not a valid object ID`);
  return parsed.data;
}

// PendingAction<T> is generic, so match the base tag followed by "<".
const PENDING_ACTION_TYPE_PREFIX = koshiraeType("capability", "PendingAction") + "<";

export async function fetchPendingActionExpiry(id: string): Promise<Date> {
  const object = await getObjectOrNotFound(id, "PendingAction");
  if (!object.type?.startsWith(PENDING_ACTION_TYPE_PREFIX)) {
    throw new ApiError("not_found", `${id} is not a Koshirae PendingAction`);
  }
  const f = PendingActionBcs.parse(object.content);
  return new Date(Number(f.expiryMs));
}

// One-shot existence check (no polling). A digest the API built but nobody
// signed will never appear, so this must not use waitForTransaction.
export async function transactionExistsOnChain(digest: string): Promise<boolean> {
  try {
    await suiClient.core.getTransaction({ digest });
    return true;
  } catch (err) {
    if (err instanceof TransactionError && err.reason === "notFound") return false;
    throw err;
  }
}

// waitForTransaction rejects with its AbortSignal.timeout() reason, a
// DOMException named "TimeoutError" (read from @mysten/sui 2.29.0 source).
export function isTimeoutError(err: unknown): boolean {
  // Checked by shape: DOMException's relationship to Error varies by runtime.
  return (
    typeof err === "object" && err !== null && (err as { name?: unknown }).name === "TimeoutError"
  );
}
