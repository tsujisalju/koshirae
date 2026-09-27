import "dotenv/config";
import express from "express";
import cors from "cors";
import { agentCapsRouter } from "./routes/agent-caps";
import { intentsRouter } from "./routes/intents";
import { ApiError } from "./errors";
import { capabilityAbortCode } from "./chain/move-error";
import { ERROR_STATUS } from "@koshirae/core";

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
        _req: express.Request,
        res: express.Response,
        next: express.NextFunction,
    ) => {
        if (res.headersSent) return next(err);
        if (err instanceof ApiError) {
            return res
                .status(err.status)
                .json({
                    error: {
                        code: err.code,
                        message: err.message,
                        details: err.details,
                    },
                });
        }

        const moveCode = capabilityAbortCode(err);
        if (moveCode) {
            return res
                .status(ERROR_STATUS[moveCode])
                .json({
                    error: {
                        code: moveCode,
                        message: "Transaction would abort on-chain",
                    },
                });
        }
        console.error(err);
        return res
            .status(500)
            .json({
                error: { code: "internal_error", message: "Internal error" },
            });
    },
);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
    console.log(`Koshirae API listening on port ${port}`);
});
