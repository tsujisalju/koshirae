import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";

import { signAndExecuteSponsoredTransaction } from "@/lib/sponsored-transaction";
import { AgentDetail } from "@/lib/agent-service";

const PACKAGE_ID = process.env.NEXT_PUBLIC_ORONYX_PACKAGE_ID!;
const OPERATOR_ADDR = process.env.NEXT_PUBLIC_ORONYX_OPERATOR_ADDR!;

export async function createAgentCap({
  sender,
  spendingLimitPerTxMist,
  spendingLimitPeriodMist,
  periodLengthMs,
  actionCodes,
  targets,
  protocolTargets,
  riskThreshold,
  expiryAbsoluteMs,
}: {
  sender: string;
  spendingLimitPerTxMist: number;
  spendingLimitPeriodMist: number;
  periodLengthMs: number;
  actionCodes: number[];
  targets: string[];
  protocolTargets: string[];
  riskThreshold: number;
  expiryAbsoluteMs: number;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::capability::create_agent_cap`,
    arguments: [
      tx.pure.address(OPERATOR_ADDR),
      tx.pure.u64(spendingLimitPerTxMist),
      tx.pure.u64(spendingLimitPeriodMist),
      tx.pure.u64(periodLengthMs),
      tx.pure.vector("u8", actionCodes),
      tx.pure.vector("address", targets),
      tx.pure.vector("address", protocolTargets),
      tx.pure.u8(riskThreshold),
      tx.pure.u64(expiryAbsoluteMs),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return signAndExecuteSponsoredTransaction({
    transaction: tx,
    sender,
    allowedMoveCallTargets: [`${PACKAGE_ID}::capability::create_agent_cap`],
    allowedAddresses: [sender],
  });
}

export async function depositToVault({
  sender,
  vaultId,
  amountMist,
}: {
  sender: string;
  vaultId: string;
  amountMist: number;
}) {
  const tx = new Transaction();
  tx.setSender(sender);
  const coin = tx.add(coinWithBalance({ balance: amountMist, useGasCoin: false }));
  tx.moveCall({
    target: `${PACKAGE_ID}::capability::deposit`,
    arguments: [tx.object(vaultId), coin],
  });

  return signAndExecuteSponsoredTransaction({
    transaction: tx,
    sender,
    allowedMoveCallTargets: [`${PACKAGE_ID}::capability::deposit`],
    allowedAddresses: [sender],
  });
}

export async function withdrawFromVault({
  sender,
  vaultId,
  amountMist,
}: {
  sender: string;
  vaultId: string;
  amountMist: number;
}) {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${PACKAGE_ID}::capability::withdraw`,
    arguments: [tx.object(vaultId), tx.pure.u64(amountMist)],
  });
  tx.transferObjects([coin], tx.pure.address(sender));

  return signAndExecuteSponsoredTransaction({
    transaction: tx,
    sender,
    allowedMoveCallTargets: [`${PACKAGE_ID}::capability::withdraw`],
    allowedAddresses: [sender],
  });
}

export async function deactivateAgent({
  sender,
  capId,
}: {
  sender: string;
  capId: string;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::capability::deactivate`,
    arguments: [tx.object(capId)],
  });

  return signAndExecuteSponsoredTransaction({
    transaction: tx,
    sender,
    allowedMoveCallTargets: [`${PACKAGE_ID}::capability::deactivate`],
    allowedAddresses: [sender],
  });
}

// The diffing here is itself transaction-building — it decides which
// moveCalls belong in the PTB — so it lives here rather than in the edit
// page, matching every other function in this file. Returns null when
// nothing changed (mirrors the prior allowedMoveCallTargets.size === 0
// early-return) so the caller can show its own "No changes to save" toast.
export async function saveAgentPolicy({
  sender,
  capId,
  current,
  next,
}: {
  sender: string;
  capId: string;
  current: AgentDetail;
  next: {
    spendingLimitPerTxMist: number;
    spendingLimitPeriodMist: number;
    periodLengthMs: number;
    riskThreshold: number;
    expiryAbsoluteMs: number;
    targets: string[];
  };
}) {
  const tx = new Transaction();
  const allowedMoveCallTargets = new Set<string>();

  if (next.spendingLimitPerTxMist !== current.spending_limit_per_tx) {
    const target = `${PACKAGE_ID}::capability::update_spending_limit_per_tx`;
    tx.moveCall({
      target,
      arguments: [tx.object(capId), tx.pure.u64(next.spendingLimitPerTxMist)],
    });
    allowedMoveCallTargets.add(target);
  }

  if (next.spendingLimitPeriodMist !== current.spending_limit_period) {
    const target = `${PACKAGE_ID}::capability::update_spending_limit_period`;
    tx.moveCall({
      target,
      arguments: [tx.object(capId), tx.pure.u64(next.spendingLimitPeriodMist)],
    });
    allowedMoveCallTargets.add(target);
  }

  if (next.periodLengthMs !== current.period_length_ms) {
    const target = `${PACKAGE_ID}::capability::update_period_length_ms`;
    tx.moveCall({
      target,
      arguments: [tx.object(capId), tx.pure.u64(next.periodLengthMs)],
    });
    allowedMoveCallTargets.add(target);
  }

  if (next.riskThreshold !== current.risk_threshold) {
    const target = `${PACKAGE_ID}::capability::update_risk_threshold`;
    tx.moveCall({
      target,
      arguments: [tx.object(capId), tx.pure.u8(next.riskThreshold)],
    });
    allowedMoveCallTargets.add(target);
  }

  if (next.expiryAbsoluteMs !== current.expiry_ms) {
    const target = `${PACKAGE_ID}::capability::update_expiry_ms`;
    tx.moveCall({
      target,
      arguments: [tx.object(capId), tx.pure.u64(next.expiryAbsoluteMs)],
    });
    allowedMoveCallTargets.add(target);
  }

  const originalTargets = new Set(
    current.allowed_targets.map((address) => address.toLowerCase()),
  );
  const currentTargets = new Set(
    next.targets.map((address) => address.toLowerCase()),
  );

  for (const address of currentTargets) {
    if (!originalTargets.has(address)) {
      const target = `${PACKAGE_ID}::capability::add_allowed_target`;
      tx.moveCall({
        target,
        arguments: [tx.object(capId), tx.pure.address(address)],
      });
      allowedMoveCallTargets.add(target);
    }
  }

  for (const address of originalTargets) {
    if (!currentTargets.has(address)) {
      const target = `${PACKAGE_ID}::capability::remove_allowed_target`;
      tx.moveCall({
        target,
        arguments: [tx.object(capId), tx.pure.address(address)],
      });
      allowedMoveCallTargets.add(target);
    }
  }

  if (allowedMoveCallTargets.size === 0) {
    return null;
  }

  return signAndExecuteSponsoredTransaction({
    transaction: tx,
    sender,
    allowedMoveCallTargets: [...allowedMoveCallTargets],
    allowedAddresses: [sender],
  });
}

export async function approvePendingAction({
  pendingObjectId,
  capId,
  vaultId,
  sender,
}: {
  pendingObjectId: string;
  capId: string;
  vaultId: string;
  sender: string;
}) {
  const tx = new Transaction();

  // approve_pending returns Coin<SUI> by value — capability.move has no
  // dedicated transfer-wrapper for it, so the PTB must handle the coin
  // itself in the same transaction.
  const coin = tx.moveCall({
    target: `${PACKAGE_ID}::capability::approve_pending`,
    arguments: [tx.object(pendingObjectId), tx.object(capId), tx.object(vaultId)],
  });
  tx.transferObjects([coin], sender);

  return signAndExecuteSponsoredTransaction({
    transaction: tx,
    sender,
    allowedMoveCallTargets: [`${PACKAGE_ID}::capability::approve_pending`],
    allowedAddresses: [sender],
  });
}

export async function rejectPendingAction({
  pendingObjectId,
  capId,
  sender,
}: {
  pendingObjectId: string;
  capId: string;
  sender: string;
}) {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::capability::reject_pending`,
    arguments: [tx.object(pendingObjectId), tx.object(capId)],
  });

  return signAndExecuteSponsoredTransaction({
    transaction: tx,
    sender,
    allowedMoveCallTargets: [`${PACKAGE_ID}::capability::reject_pending`],
    allowedAddresses: [sender],
  });
}
