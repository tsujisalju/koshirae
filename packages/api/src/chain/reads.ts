import {
  ACTION_TYPE_CODE,
  ActionType,
  AgentCap,
  CoinLimitsState,
  normalizeCoinType,
  OperatorCap,
  Vault,
} from "@koshirae/core";
import { bcs } from "@mysten/sui/bcs";
import { suiClient } from "./client";

const ACTION_CODE_TO_TYPE = Object.fromEntries(
  Object.entries(ACTION_TYPE_CODE).map(([type, code]) => [
    code,
    type as ActionType,
  ]),
) as Record<number, ActionType>;

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
  owner: bcs.Address,
  balances: BagBcs,
  limits: CoinLimitsMapBcs,
  periodLengthMs: bcs.u64(),
});

const AgentCapBcs = bcs.struct("AgentCap", {
  id: bcs.Address,
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

export async function fetchAgentCap(id: string): Promise<AgentCap> {
  const { object } = await suiClient.getObject({
    objectId: id,
    include: { content: true },
  });
  const f = AgentCapBcs.parse(object.content);
  return AgentCap.parse({
    id,
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

export async function fetchOperatorCap(id: string): Promise<OperatorCap> {
  const { object } = await suiClient.getObject({
    objectId: id,
    include: { content: true },
  });
  const f = OperatorCapBcs.parse(object.content);
  return OperatorCap.parse({
    id,
    agentCapId: f.agentCapId,
    generation: Number(f.generation),
  });
}

export async function fetchVault(id: string): Promise<Vault> {
  const { object } = await suiClient.getObject({
    objectId: id,
    include: { content: true },
  });
  const f = VaultBcs.parse(object.content);
  return Vault.parse({
    id,
    owner: f.owner,
    periodLengthMs: Number(f.periodLengthMs),
    limits: parseCoinLimitMap(f.limits),
  });
}

export async function fetchOperatorCapOwner(id: string): Promise<string> {
  const { object } = await suiClient.getObject({ objectId: id });
  if (object.owner.AddressOwner) {
    return object.owner.AddressOwner;
  }
  throw new Error(`OperatorCap ${id} is not address-owned`);
}

export async function findCreatedObjectId(
  digest: string,
  typePrefix: string,
): Promise<string | undefined> {
  const result = await suiClient.waitForTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  });
  const tx = result.Transaction ?? result.FailedTransaction;
  const objectTypes = tx?.objectTypes ?? {};
  const created = (tx?.effects?.changedObjects ?? []).find(
    (c) =>
      c.idOperation === "Created" &&
      objectTypes[c.objectId]?.startsWith(typePrefix),
  );
  return created?.objectId;
}

export async function fetchPoolCoinTypes(
  poolId: string,
): Promise<{ coinTypeA: string; coinTypeB: string }> {
  const obj = await suiClient.core.getObject({ objectId: poolId });
  const match = /Pool<(.+),\s*(.+)>$/.exec(obj.object.type ?? "");
  if (!match) throw new Error(`Could not parse pool coin types from ${poolId}`);
  return {
    coinTypeA: normalizeCoinType(match[1].trim()),
    coinTypeB: normalizeCoinType(match[2].trim()),
  };
}
