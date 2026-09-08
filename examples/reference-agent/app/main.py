from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import agents
from app.services.agent_index import sync_agent_index
from app.services.triggers.stake_trigger import check_stake_trigger
from app.services.triggers.swap_trigger import check_swap_trigger

# How stale the candidate index (allowed_actions/risk_threshold/active) can
# get before picking up a policy edit — capability.move's update_* functions
# emit no events, so this periodic re-sync is the only way those fields are
# refreshed short of a live per-agent read.
AGENT_INDEX_SYNC_INTERVAL_MINUTES = 5
SWAP_TRIGGER_INTERVAL_HOURS = 1
STAKE_TRIGGER_INTERVAL_HOURS = 4

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    scheduler.add_job(
        sync_agent_index,
        "interval",
        minutes=AGENT_INDEX_SYNC_INTERVAL_MINUTES,
        id="sync_agent_index",
    )
    scheduler.add_job(
        check_swap_trigger,
        "interval",
        hours=SWAP_TRIGGER_INTERVAL_HOURS,
        id="check_swap_trigger",
    )
    scheduler.add_job(
        check_stake_trigger,
        "interval",
        hours=STAKE_TRIGGER_INTERVAL_HOURS,
        id="check_stake_trigger",
    )
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Oronyx Agent Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(agents.router, prefix="/agents", tags=["agents"])


@app.get("/health")
def health():
    return {"status": "ok"}
