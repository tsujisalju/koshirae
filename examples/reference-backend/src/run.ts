import { runCetusSwapScenario } from "./scenarios/cetus-swap";
import { runFlaggedAndApproveScenario } from "./scenarios/flagged-and-approve";
import { runFlaggedAndExpiredScenario } from "./scenarios/flagged-and-expired";
import { runFlaggedAndRejectScenario } from "./scenarios/flagged-and-reject";
import { runIdempotencyScenario } from "./scenarios/idempotency";
import { runMockSwapScenario } from "./scenarios/mock-swap";
import { runSharedVaultScenario } from "./scenarios/shared-vault";
import { runStakeScenario } from "./scenarios/stake";
import { runFailedOnChainScenario } from "./scenarios/failed-onchain";
import { runTransferScenario } from "./scenarios/transfer";

const scenarios: Record<string, () => Promise<void>> = {
    transfer: runTransferScenario,
    "cetus-swap": runCetusSwapScenario,
    "flagged-and-approve": runFlaggedAndApproveScenario,
    "flagged-and-expired": runFlaggedAndExpiredScenario,
    "flagged-and-reject": runFlaggedAndRejectScenario,
    "mock-swap": runMockSwapScenario,
    idempotency: runIdempotencyScenario,
    "shared-vault": runSharedVaultScenario,
    stake: runStakeScenario,
    "failed-onchain": runFailedOnChainScenario,
};

const name = process.argv[2];
const scenario = name && scenarios[name];
if (!scenario) {
    console.log(
        `Usage: pnpm run --filter reference-backend run <scenario>\nAvailable: ${Object.keys(scenarios).join(", ")}`,
    );
    process.exit(1);
}

scenario().catch((err) => {
    console.error(err);
    process.exit(1);
});
