import { Transaction, TransactionArgument } from "@mysten/sui/transactions";
import {
  ACTION_TYPE_CODE,
  AgentCapPolicyInput,
  CoinLimitsInput,
  SuiAddress,
  VaultInput,
} from "@koshirae/core";
import { Router } from "express";
import { z } from "zod";
import { KOSHIRAE_PACKAGE_ID, suiClient } from "../chain/client";
import { fetchAgentCap, fetchVault } from "../chain/reads";

export const agentCapsRouter = Router();

const AgentCapInputWithoutVault = AgentCapPolicyInput.omit({ vaultId: true });
const CreateAgentCapWithVaultRequest = z.object({
  owner: SuiAddress,
  vault: VaultInput,
  agentCap: AgentCapInputWithoutVault,
});
const MintOperatorRequest = z.object({ operator: SuiAddress });

function addCreateAgentCapCall(
  tx: Transaction,
  vaultArg: TransactionArgument,
  input: z.infer<typeof AgentCapInputWithoutVault>,
) {
  tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::capability::create_agent_cap_for_vault`,
    arguments: [
      vaultArg,
      tx.pure.u64(input.periodLengthMs),
      tx.pure.vector(
        "u8",
        input.allowedActions.map((a) => ACTION_TYPE_CODE[a]),
      ),
      tx.pure.vector("address", input.allowedTargets),
      tx.pure.vector("address", input.protocolTargets),
      tx.pure.u8(input.riskThreshold),
      tx.pure.u64(input.expiryMs),
      tx.pure.u64(input.maxPendingWindowMs),
    ],
  });
}

agentCapsRouter.post("/agent-caps", async (req, res) => {
  const parsed = CreateAgentCapWithVaultRequest.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "invalid_request",
      details: z.treeifyError(parsed.error),
    });
  const { owner, vault, agentCap } = parsed.data;

  const tx = new Transaction();
  tx.setSender(owner);
  const [vaultArg] = tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::capability::new_vault`,
    arguments: [tx.pure.u64(vault.periodLengthMs)],
  });
  addCreateAgentCapCall(tx, vaultArg, agentCap);
  tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::capability::share_vault`,
    arguments: [vaultArg],
  });

  const txBytes = await tx.build({ client: suiClient });
  return res
    .status(200)
    .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
});

// attach a new agent against an already-shared vault
agentCapsRouter.post("/vaults/:vaultId/agent-caps", async (req, res) => {
  const parsed = AgentCapInputWithoutVault.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "invalid_request",
      details: z.treeifyError(parsed.error),
    });

  const owner = (await fetchVault(req.params.vaultId)).owner;
  const tx = new Transaction();
  tx.setSender(owner);
  addCreateAgentCapCall(tx, tx.object(req.params.vaultId), parsed.data);
  const txBytes = await tx.build({ client: suiClient });
  return res
    .status(200)
    .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
});

agentCapsRouter.post("/agent-caps/:agentCapId/operators", async (req, res) => {
  const parsed = MintOperatorRequest.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "invalid_request",
      details: z.treeifyError(parsed.error),
    });

  const owner = (await fetchAgentCap(req.params.agentCapId)).owner;
  const tx = new Transaction();
  tx.setSender(owner);
  tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::capability::mint_operator_cap`,
    arguments: [
      tx.object(req.params.agentCapId),
      tx.pure.address(parsed.data.operator),
    ],
  });
  const txBytes = await tx.build({ client: suiClient });
  return res
    .status(200)
    .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
});

agentCapsRouter.post(
  "/agent-caps/:agentCapId/operators/revoke",
  async (req, res) => {
    const owner = (await fetchAgentCap(req.params.agentCapId)).owner;
    const tx = new Transaction();
    tx.setSender(owner);
    tx.moveCall({
      target: `${KOSHIRAE_PACKAGE_ID}::capability::revoke_operator`,
      arguments: [tx.object(req.params.agentCapId)],
    });
    const txBytes = await tx.build({ client: suiClient });
    return res
      .status(200)
      .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
  },
);

agentCapsRouter.post(
  "/agent-caps/:agentCapId/coin-limits/:coinType",
  async (req, res) => {
    const parsed = CoinLimitsInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_request",
        details: z.treeifyError(parsed.error),
      });
    }
    const owner = (await fetchAgentCap(req.params.agentCapId)).owner;
    const tx = new Transaction();
    tx.setSender(owner);
    tx.moveCall({
      target: `${KOSHIRAE_PACKAGE_ID}::capability::add_coin_limits`,
      typeArguments: [req.params.coinType],
      arguments: [
        tx.object(req.params.agentCapId),
        tx.pure.u64(parsed.data.spendingLimitPerTx),
        tx.pure.u64(parsed.data.spendingLimitPeriod),
        tx.object.clock(),
      ],
    });
    const txBytes = await tx.build({ client: suiClient });
    return res
      .status(200)
      .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
  },
);

agentCapsRouter.patch(
  "/agent-caps/:agentCapId/coin-limits/:coinType",
  async (req, res) => {
    const parsed = CoinLimitsInput.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_request",
        details: z.treeifyError(parsed.error),
      });
    }
    const owner = (await fetchAgentCap(req.params.agentCapId)).owner;
    const tx = new Transaction();
    tx.setSender(owner);
    if (parsed.data.spendingLimitPerTx !== undefined) {
      tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::update_spending_limit_per_tx`,
        typeArguments: [req.params.coinType],
        arguments: [
          tx.object(req.params.agentCapId),
          tx.pure.u64(parsed.data.spendingLimitPerTx),
        ],
      });
    }
    if (parsed.data.spendingLimitPeriod !== undefined) {
      tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::update_spending_limit_period`,
        typeArguments: [req.params.coinType],
        arguments: [
          tx.object(req.params.agentCapId),
          tx.pure.u64(parsed.data.spendingLimitPeriod),
        ],
      });
    }
    const txBytes = await tx.build({ client: suiClient });
    return res
      .status(200)
      .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
  },
);

agentCapsRouter.delete(
  "/agent-caps/:agentCapId/coin-limits/:coinType",
  async (req, res) => {
    const owner = (await fetchAgentCap(req.params.agentCapId)).owner;
    const tx = new Transaction();
    tx.setSender(owner);
    tx.moveCall({
      target: `${KOSHIRAE_PACKAGE_ID}::capability::remove_coin_limits`,
      typeArguments: [req.params.coinType],
      arguments: [tx.object(req.params.agentCapId)],
    });
    const txBytes = await tx.build({ client: suiClient });
    return res
      .status(200)
      .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
  },
);

agentCapsRouter.get("/agent-caps/:agentCapId", async (req, res) => {
  try {
    return res.status(200).json(await fetchAgentCap(req.params.agentCapId));
  } catch {
    return res.status(404).json({ error: "agent_cap_not_found" });
  }
});

const VaultCoinLimitsUpdate = CoinLimitsInput.partial();

agentCapsRouter.post(
  "/vaults/:vaultId/coin-limits/:coinType",
  async (req, res) => {
    const parsed = CoinLimitsInput.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: "invalid_request",
        details: z.treeifyError(parsed.error),
      });

    const owner = (await fetchVault(req.params.vaultId)).owner;
    const tx = new Transaction();
    tx.setSender(owner);
    tx.moveCall({
      target: `${KOSHIRAE_PACKAGE_ID}::capability::add_vault_coin_limits`,
      typeArguments: [req.params.coinType],
      arguments: [
        tx.object(req.params.vaultId),
        tx.pure.u64(parsed.data.spendingLimitPerTx),
        tx.pure.u64(parsed.data.spendingLimitPeriod),
        tx.object.clock(),
      ],
    });
    const txBytes = await tx.build({ client: suiClient });
    return res
      .status(200)
      .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
  },
);

agentCapsRouter.patch(
  "/vaults/:vaultId/coin-limits/:coinType",
  async (req, res) => {
    const parsed = VaultCoinLimitsUpdate.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: "invalid_request",
        details: z.treeifyError(parsed.error),
      });
    const owner = (await fetchVault(req.params.vaultId)).owner;
    const tx = new Transaction();
    tx.setSender(owner);
    if (parsed.data.spendingLimitPerTx !== undefined) {
      tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::update_vault_spending_limit_per_tx`,
        typeArguments: [req.params.coinType],
        arguments: [
          tx.object(req.params.vaultId),
          tx.pure.u64(parsed.data.spendingLimitPerTx),
        ],
      });
    }
    if (parsed.data.spendingLimitPeriod !== undefined) {
      tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::update_vault_spending_limit_period`,
        typeArguments: [req.params.coinType],
        arguments: [
          tx.object(req.params.vaultId),
          tx.pure.u64(parsed.data.spendingLimitPeriod),
        ],
      });
    }
    const txBytes = await tx.build({ client: suiClient });
    return res
      .status(200)
      .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
  },
);

agentCapsRouter.delete(
  "/vaults/:vaultId/coin-limits/:coinType",
  async (req, res) => {
    const owner = (await fetchVault(req.params.vaultId)).owner;
    const tx = new Transaction();
    tx.setSender(owner);
    tx.moveCall({
      target: `${KOSHIRAE_PACKAGE_ID}::capability::remove_vault_coin_limits`,
      typeArguments: [req.params.coinType],
      arguments: [tx.object(req.params.vaultId)],
    });
    const txBytes = await tx.build({ client: suiClient });
    return res
      .status(200)
      .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
  },
);

agentCapsRouter.patch("/vaults/:vaultId", async (req, res) => {
  const parsed = z
    .object({ periodLengthMs: z.number().int().positive() })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "invalid_request",
      details: z.treeifyError(parsed.error),
    });
  const owner = (await fetchVault(req.params.vaultId)).owner;
  const tx = new Transaction();
  tx.setSender(owner);
  tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::capability::update_vault_period_length_ms`,
    arguments: [
      tx.object(req.params.vaultId),
      tx.pure.u64(parsed.data.periodLengthMs),
    ],
  });
  const txBytes = await tx.build({ client: suiClient });
  return res
    .status(200)
    .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
});
