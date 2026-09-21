import { runTransferScenario } from "./scenarios/transfer";

const scenarios: Record<string, () => Promise<void>> = {
  transfer: runTransferScenario,
};

const name = process.argv[2];
const scenario = name && scenarios[name];
if (!scenario) {
  console.log(
    `Usage: pnpm run --filter reference-backend run <scenario>\nAvailable: ${Object.keys(scenario).join(", ")}`,
  );
  process.exit(1);
}

scenario().catch((err) => {
  console.error(err);
  process.exit(1);
});
