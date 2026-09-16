import "dotenv/config";
import express from "express";
import cors from "cors";
import { agentCapsRouter } from "./routes/agent-caps";
import { intentsRouter } from "./routes/intents";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
app.use(agentCapsRouter);
app.use(intentsRouter);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Koshirae API listening on port ${port}`);
});
