import { runCetusSwapScenario } from "./scenarios/cetus-swap";
import { runFlaggedAndApproveScenario } from "./scenarios/flagged-and-approve";
import { runFlaggedAndExpiredScenario } from "./scenarios/flagged-and-expired";
import { runFlaggedAndRejectScenario } from "./scenarios/flagged-and-reject";
import { runTransferScenario } from "./scenarios/transfer";

const scenarios: Record<string, () => Promise<void>> = {
    transfer: runTransferScenario,
    "cetus-swap": runCetusSwapScenario,
    "flagged-and-approve": runFlaggedAndApproveScenario,
    "flagged-and-expired": runFlaggedAndExpiredScenario,
    "flagged-and-reject": runFlaggedAndRejectScenario,
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
