import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import CetusClmmSDK from "@cetusprotocol/sui-clmm-sdk";
import { Percentage, adjustForSlippage, d } from "@cetusprotocol/common-sdk";
import BN from "bn.js";

const PACKAGE_ID = process.env.ORONYX_PACKAGE_ID!;
const OPERATOR_PRIVATE_KEY = process.env.ORONYX_OPERATOR_KEY!; // suiprivkey1...
const FULLNODE_BASE_URL =
  process.env.ORONYX_FULLNODE_URL ?? "https://fullnode.testnet.sui.io:443";
const NETWORK = "testnet" as const;

const CLOCK_ID = "0x6";
const SUI_SYSTEM_STATE_ID = "0x5";

// Descriminated union, each action type carries only the extra data
// its own Move entry function actually needs.

interface BaseDecision {
  capId: string;
  vaultId: string;
  amountMist: string;
  riskScore: number;
}

interface TransferDecision extends BaseDecision {
  type: "transfer";
  recipient: string;
}

interface StakeDecision extends BaseDecision {
  type: "stake";
  validator: string;
}

interface MockSwapDecision extends BaseDecision {
  type: "mock_swap";
  mockPoolId: string;
}

interface CetusSwapDecision extends BaseDecision {
  type: "cetus_swap";
  poolId: string;
  decimalsA: number;
  decimalsB: number;
  slippagePercent: number;
}

export type AgentActionDecision =
  | StakeDecision
  | MockSwapDecision
  | CetusSwapDecision
  | TransferDecision;

// signAndExecuteTransaction returns a discriminated union keyed on $kind
// ('Transaction' | 'FailedTransaction') — the digest lives on whichever
// branch matched, not at the top level.
function digestOf(result: Awaited<ReturnType<SuiGrpcClient["signAndExecuteTransaction"]>>) {
  return result.$kind === "Transaction"
    ? result.Transaction.digest
    : result.FailedTransaction.digest;
}

function getClient() {
  return new SuiGrpcClient({ baseUrl: FULLNODE_BASE_URL, network: NETWORK });
}

function getOperatorKeypair() {
  return Ed25519Keypair.fromSecretKey(
    decodeSuiPrivateKey(OPERATOR_PRIVATE_KEY).secretKey,
  );
}

// Atomic paths

async function runTransfer(
  client: SuiGrpcClient,
  operatorKeypair: Ed25519Keypair,
  decision: TransferDecision,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::capability::execute_transfer`,
    arguments: [
      tx.object(decision.capId),
      tx.object(decision.vaultId),
      tx.pure.address(decision.recipient),
      tx.pure.u64(decision.amountMist),
      tx.pure.u8(decision.riskScore),
      tx.object(CLOCK_ID),
    ],
  });
  return client.signAndExecuteTransaction({
    signer: operatorKeypair,
    transaction: tx,
  });
}

async function runStake(
  client: SuiGrpcClient,
  operatorKeypair: Ed25519Keypair,
  decision: StakeDecision,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::capability::execute_stake`,
    arguments: [
      tx.object(decision.capId),
      tx.object(decision.vaultId),
      tx.object(SUI_SYSTEM_STATE_ID),
      tx.pure.address(decision.validator),
      tx.pure.u64(decision.amountMist),
      tx.pure.u8(decision.riskScore),
      tx.object(CLOCK_ID),
    ],
  });
  return client.signAndExecuteTransaction({
    signer: operatorKeypair,
    transaction: tx,
  });
}

async function runMockSwap(
  client: SuiGrpcClient,
  operatorKeypair: Ed25519Keypair,
  decision: MockSwapDecision,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::capability::execute_mock_swap`,
    arguments: [
      tx.object(decision.capId),
      tx.object(decision.vaultId),
      tx.object(decision.mockPoolId),
      tx.pure.address(decision.mockPoolId), // pool_address doubles as the policy target — must match an allowed_targets entry
      tx.pure.u64(decision.amountMist),
      tx.pure.u8(decision.riskScore),
      tx.object(CLOCK_ID),
    ],
  });
  return client.signAndExecuteTransaction({
    signer: operatorKeypair,
    transaction: tx,
  });
}

// Real Cetus testnet pools were verified (via testCetusSwap.ts) to reject
// swaps with a zero-output error (Cetus abort code 18) across every pool
// with SUI on one side — price ratios too skewed for our test amounts to
// produce a nonzero output. No usable pool exists on testnet as of this
// writing. Default to the mock DEX for demo reliability; set
// ORONYX_USE_MOCK_SWAP=false to exercise the real Cetus path instead (for
// showing the integration works, separate from the demo itself).

// === Two-step path — Cetus only, see capability.move's docstring on
// execute_cetus_swap_and_transfer_to_operator for why this can't be atomic.

async function runCetusPolicyCheck(
  client: SuiGrpcClient,
  operatorKeypair: Ed25519Keypair,
  decision: CetusSwapDecision,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::capability::execute_cetus_swap_and_transfer_to_operator`,
    arguments: [
      tx.object(decision.capId),
      tx.object(decision.vaultId),
      tx.pure.address(decision.poolId),
      tx.pure.u64(decision.amountMist),
      tx.pure.u8(decision.riskScore),
      tx.object(CLOCK_ID),
    ],
  });
  return client.signAndExecuteTransaction({
    signer: operatorKeypair,
    transaction: tx,
  });
}

async function runCetusSwap(
  client: SuiGrpcClient,
  operatorKeypair: Ed25519Keypair,
  decision: CetusSwapDecision,
) {
  const sdk = CetusClmmSDK.createSDK({ env: NETWORK });

  const pool = await sdk.Pool.getPool(decision.poolId);
  const a2b = true;
  const byAmountIn = true;

  const preSwapRes: any = await sdk.Swap.preSwap({
    pool,
    current_sqrt_price: pool.current_sqrt_price,
    coin_type_a: pool.coin_type_a,
    coin_type_b: pool.coin_type_b,
    decimals_a: decision.decimalsA,
    decimals_b: decision.decimalsB,
    a2b,
    by_amount_in: byAmountIn,
    amount: decision.amountMist,
  });

  const slippage = Percentage.fromDecimal(d(decision.slippagePercent));
  const toAmount = byAmountIn
    ? preSwapRes.estimated_amount_out
    : preSwapRes.estimated_amount_in;
  const amountLimit = adjustForSlippage(
    new BN(toAmount),
    slippage,
    !byAmountIn,
  );

  const swapTx = await sdk.Swap.createSwapPayload({
    pool_id: pool.id,
    coin_type_a: pool.coin_type_a,
    coin_type_b: pool.coin_type_b,
    a2b,
    by_amount_in: byAmountIn,
    amount: preSwapRes.amount.toString(),
    amount_limit: amountLimit.toString(),
  });

  return client.signAndExecuteTransaction({
    signer: operatorKeypair,
    transaction: swapTx,
  });
}

export async function executeAgentAction(decision: AgentActionDecision) {
  const client = getClient();
  const operatorKeypair = getOperatorKeypair();

  switch (decision.type) {
    case "transfer": {
      const result = await runTransfer(client, operatorKeypair, decision);
      return { result, txDigest: digestOf(result) };
    }
    case "stake": {
      const result = await runStake(client, operatorKeypair, decision);
      return { result, txDigest: digestOf(result) };
    }
    case "mock_swap": {
      const result = await runMockSwap(client, operatorKeypair, decision);
      return { result, txDigest: digestOf(result) };
    }
    case "cetus_swap": {
      const policyResult = await runCetusPolicyCheck(
        client,
        operatorKeypair,
        decision,
      );
      // TODO: check policyResult effects/events for ActionFlagged vs
      // ActionExecuted before proceeding, stop here if flagged.
      const swapResult = await runCetusSwap(client, operatorKeypair, decision);
      // swapResult is the economically meaningful transaction — surfaced
      // as the audit-trail digest, unlike the preceding policy-check tx.
      return { policyResult, swapResult, txDigest: digestOf(swapResult) };
    }

    default: {
      const _exhaustive: never = decision;
      throw new Error(
        `Unhandled decision type: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
