import { runCetusSwapScenario } from "./scenarios/cetus-swap";
import { runCetusSwapFlaggedApproveScenario } from "./scenarios/cetus-swap-flagged-approve";
import { runConcurrentIdempotencyScenario } from "./scenarios/concurrent-idempotency";
import { runFlaggedAndApproveScenario } from "./scenarios/flagged-and-approve";
import { runFlaggedAndExpiredScenario } from "./scenarios/flagged-and-expired";
import { runFlaggedAndRejectScenario } from "./scenarios/flagged-and-reject";
import { runIdempotencyScenario } from "./scenarios/idempotency";
import { runMockSwapScenario } from "./scenarios/mock-swap";
import { runSharedVaultScenario } from "./scenarios/shared-vault";
import { runStakeScenario } from "./scenarios/stake";
import { runFailedOnChainScenario } from "./scenarios/failed-onchain";
import { runTransferScenario } from "./scenarios/transfer";
import { runLostReportScenario } from "./scenarios/lost-report";
import { runForeignDigestScenario } from "./scenarios/foreign-digest";
import { teardownAll } from "./scenarios/teardown";

type Network = "localnet" | "testnet";

interface Scenario {
  run: () => Promise<void>;
  networks: readonly Network[];
}

const ANY: readonly Network[] = ["localnet", "testnet"];

const scenarios: Record<string, Scenario> = {
  transfer: { run: runTransferScenario, networks: ANY },
  "cetus-swap": { run: runCetusSwapScenario, networks: ANY },
  "cetus-swap-flagged-approve": { run: runCetusSwapFlaggedApproveScenario, networks: ANY },
  "concurrent-idempotency": { run: runConcurrentIdempotencyScenario, networks: ANY },
  "flagged-and-approve": { run: runFlaggedAndApproveScenario, networks: ANY },
  "flagged-and-expired": { run: runFlaggedAndExpiredScenario, networks: ANY },
  "flagged-and-reject": { run: runFlaggedAndRejectScenario, networks: ANY },
  "mock-swap": { run: runMockSwapScenario, networks: ANY },
  idempotency: { run: runIdempotencyScenario, networks: ANY },
  "shared-vault": { run: runSharedVaultScenario, networks: ANY },
  stake: { run: runStakeScenario, networks: ANY },
  "failed-onchain": { run: runFailedOnChainScenario, networks: ANY },
  "lost-report": { run: runLostReportScenario, networks: ANY },
  "foreign-digest": { run: runForeignDigestScenario, networks: ANY },
};

const network = (process.env.SUI_NETWORK ?? "testnet") as Network;

async function runOne(name: string, scenario: Scenario): Promise<void> {
  try {
    await scenario.run();
  } finally {
    await teardownAll();
  }
}

async function runAll(): Promise<void> {
  const results: { name: string; status: "pass" | "fail" | "skip"; ms: number; error?: string }[] =
    [];
  for (const [name, scenario] of Object.entries(scenarios)) {
    if (!scenario.networks.includes(network)) {
      results.push({ name, status: "skip", ms: 0 });
      continue;
    }
    console.log(`\n=== ${name} (${network}) ===`);
    const started = Date.now();
    try {
      await runOne(name, scenario);
      results.push({ name, status: "pass", ms: Date.now() - started });
    } catch (err) {
      console.error(err);
      results.push({
        name,
        status: "fail",
        ms: Date.now() - started,
        error: (err as Error).message.split("\n")[0],
      });
    }
  }

  console.log(`\n=== Summary (${network}) ===`);
  for (const r of results) {
    const secs = r.status === "skip" ? "" : ` ${(r.ms / 1000).toFixed(1)}s`;
    console.log(
      `${r.status.toUpperCase().padEnd(5)} ${r.name}${secs}${r.error ? ` - ${r.error}` : ""}`,
    );
  }
  if (results.some((r) => r.status === "fail")) process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const name = args.find((a) => !a.startsWith("--"));

  if (name === "all") return runAll();

  const scenario = name ? scenarios[name] : undefined;
  if (!scenario) {
    console.log(
      `Usage: pnpm --filter reference-backend run <scenario|all> [--force]\n` +
        `Network: ${network}\nAvailable: ${Object.keys(scenarios).join(", ")}`,
    );
    process.exit(1);
  }
  await runOne(name!, scenario);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
