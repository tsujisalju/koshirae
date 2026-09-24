import "dotenv/config";
import express from "express";
import cors from "cors";
import { agentCapsRouter } from "./routes/agent-caps";
import { intentsRouter } from "./routes/intents";
import { moveAbortResponse } from "./chain/move-error";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
app.use(agentCapsRouter);
app.use(intentsRouter);

app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) return next(err);
    const mapped = moveAbortResponse(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    console.error(err);
    return res.status(500).json({ error: "internal_error" });
  },
);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Koshirae API listening on port ${port}`);
});
