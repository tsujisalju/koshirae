import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import {
  AgentActionDecision,
  executeAgentAction,
} from "./executeAgentAction.js";
import { enokiClient } from "./enoki.js";
import { EnokiClientError } from "@mysten/enoki";

function enokiErrorDetails(err: unknown) {
  if (err instanceof EnokiClientError) {
    return { status: err.status, code: err.code, errors: err.errors };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}

const PORT = Number(process.env.ORONYX_EXECUTOR_PORT ?? 4000);

const app = express();
app.use(cors());
app.use(express.json());

function isValidDecision(body: unknown): body is AgentActionDecision {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.capId !== "string" || typeof b.vaultId !== "string")
    return false;
  if (typeof b.amountMist !== "string" || typeof b.riskScore !== "number")
    return false;

  switch (b.type) {
    case "transfer":
      return typeof b.recipient === "string";
    case "stake":
      return typeof b.validator === "string";
    case "mock_swap":
      return typeof b.mockPoolId === "string";
    case "cetus_swap":
      return (
        typeof b.poolId === "string" &&
        typeof b.decimalsA === "number" &&
        typeof b.decimalsB === "number" &&
        typeof b.slippagePercent === "number"
      );
    default:
      return false;
  }
}

app.post("/execute", async (req: Request, res: Response) => {
  if (!isValidDecision(req.body)) {
    res
      .status(400)
      .json({
        error: "Malformed or unrecognized AgentActionDecision",
        received: req.body,
      });
    return;
  }

  try {
    const result = await executeAgentAction(req.body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Proxies for Enoki's gas-station endpoints — these require a private API
// key that must never reach the browser, so the frontend calls these
// instead of talking to Enoki directly. The frontend still builds the
// transaction-kind bytes and signs the sponsored bytes itself; only the
// two calls that need the private key are proxied through here.

function isValidSponsorRequest(
  body: unknown,
): body is {
  transactionKindBytes: string;
  sender: string;
  network?: "mainnet" | "testnet" | "devnet";
  allowedMoveCallTargets?: string[];
  allowedAddresses?: string[];
} {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.transactionKindBytes === "string" && typeof b.sender === "string"
  );
}

app.post("/sponsor", async (req: Request, res: Response) => {
  if (!isValidSponsorRequest(req.body)) {
    res.status(400).json({ error: "Malformed sponsor request", received: req.body });
    return;
  }

  try {
    const sponsored = await enokiClient.createSponsoredTransaction(req.body);
    res.json(sponsored);
  } catch (err) {
    console.error("createSponsoredTransaction failed:", err);
    res.status(500).json(enokiErrorDetails(err));
  }
});

function isValidExecuteSponsoredRequest(
  body: unknown,
): body is { digest: string; signature: string } {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.digest === "string" && typeof b.signature === "string";
}

app.post("/execute-sponsored", async (req: Request, res: Response) => {
  if (!isValidExecuteSponsoredRequest(req.body)) {
    res
      .status(400)
      .json({ error: "Malformed execute-sponsored request", received: req.body });
    return;
  }

  try {
    const result = await enokiClient.executeSponsoredTransaction(req.body);
    res.json(result);
  } catch (err) {
    console.error("executeSponsoredTransaction failed:", err);
    res.status(500).json(enokiErrorDetails(err));
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Oronyx executor listening on port ${PORT}`);
});
