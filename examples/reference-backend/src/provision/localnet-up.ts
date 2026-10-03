import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const ENV_FILE = ".env.localnet";
const API_ENV_FILE = "../../packages/api/.env.localnet";
const MOVE_DIR = "../../move";
const PUBFILE = "Pub.localnet.toml";

const API_KEYS = [
  "KOSHIRAE_PACKAGE_ID",
  "KOSHIRAE_ORIGINAL_PACKAGE_ID",
  "CETUS_PACKAGE_ID",
  "CETUS_ORIGINAL_PACKAGE_ID",
  "CETUS_GLOBAL_CONFIG_ID",
];

function upsertEnv(path: string, values: Record<string, string>): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const written = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
    if (key === undefined || !(key in values)) {
      out.push(line);
      continue;
    }
    if (written.has(key)) continue;
    out.push(`${key}=${values[key]}`);
    written.add(key);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  for (const [key, value] of Object.entries(values)) {
    if (!written.has(key)) out.push(`${key}=${value}`);
  }
  writeFileSync(path, out.join("\n") + "\n");
}

function parseKeyValues(stdout: string): Record<string, string> {
  return Object.fromEntries([...stdout.matchAll(/^([A-Z0-9_]+)=(\S+)$/gm)].map((m) => [m[1], m[2]]));
}

function sui(args: string[], cwd?: string): string {
  return execFileSync("sui", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function runStep(script: string, expectedKeys: string[]): Record<string, string> {
  const stdout = execFileSync(
    "pnpm",
    ["exec", "tsx", `--env-file=${ENV_FILE}`, `src/provision/${script}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const values = parseKeyValues(stdout);
  const missing = expectedKeys.filter((k) => !values[k]);
  if (missing.length > 0) throw new Error(`${script} did not print: ${missing.join(", ")}`);
  return values;
}

function main() {
  const skipPublish = process.argv.includes("--skip-publish");
  const skipDb = process.argv.includes("--skip-db");

  if (!existsSync(ENV_FILE)) {
    throw new Error(
      `${ENV_FILE} not found. Copy .env.localnet.example and fill in the two private keys`,
    );
  }
  const env = parseEnv(readFileSync(ENV_FILE, "utf8"));
  if (!env.OWNER_PRIVATE_KEY || !env.OPERATOR_PRIVATE_KEY) {
    throw new Error(`Set OWNER_PRIVATE_KEY and OPERATOR_PRIVATE_KEY in ${ENV_FILE} first.`);
  }
  const owner = Ed25519Keypair.fromSecretKey(env.OWNER_PRIVATE_KEY).toSuiAddress();

  if (!skipPublish) {
    // Cetus' admin roles and our TreasuryCap go to whoever publishes, and
    // boostrap looks for them on the owner, so the CLI must publish as owner
    const activeEnv = sui(["client", "active-env"]).trim();
    if (activeEnv !== "localnet") {
      throw new Error(`sui CLI is on ${activeEnv}. Run: sui client switch --env localnet`);
    }

    const activeAddress = sui(["client", "active-address"]).trim();
    if (activeAddress !== owner) {
      throw new Error(
        `sui CLI address ${activeAddress} is not the owner ${owner}. Run: sui client switch --address ${owner}`,
      );
    }

    console.error("[1/5] Publishing packages...");
    sui(["client", "faucet"]);
    rmSync(`${MOVE_DIR}/${PUBFILE}`, { force: true });
    execFileSync(
      "sui",
      [
        "client",
        "test-publish",
        "--build-env",
        "testnet",
        "--publish-unpublished-deps",
        "--pubfile-path",
        PUBFILE,
      ],
      { cwd: MOVE_DIR, stdio: ["ignore", "inherit", "inherit"] },
    );
  }

  console.error("[2/5] Bootstrapping (funding, Cetus factory, validator)...");
  const bootstrap = runStep("bootstrap-localnet.ts", [
    ...API_KEYS,
    "CETUS_POOLS_ID",
    "MOCK_USDC_TREASURY_CAP_ID",
    "VALIDATOR_ADDRESS",
  ]);
  upsertEnv(ENV_FILE, bootstrap);

  console.error("[3/5] Creating mock pool...");
  upsertEnv(ENV_FILE, runStep("create-mock-pool.ts", ["MOCK_POOL_ID"]));

  console.error("[4/5] Creating Cetus pool...");
  upsertEnv(ENV_FILE, runStep("create-cetus-pool.ts", ["CETUS_POOL_ID"]));

  upsertEnv(API_ENV_FILE, Object.fromEntries(API_KEYS.map((k) => [k, bootstrap[k]])));

  if (!skipDb) {
    console.error("[5/5] Pushing the API database schema...");
    execFileSync("pnpm", ["--filter", "@koshirae/api", "db:push:localnet"], {
      stdio: "inherit",
    });
  }

  console.error(`\nDone. ${ENV_FILE} and ${API_ENV_FILE} are updated.`);
  console.error(
    "Restart the API (pnpm --filter @koshirae/api dev:localnet), then: pnpm run:localnet all",
  );
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
