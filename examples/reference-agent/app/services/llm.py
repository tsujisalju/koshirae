import os
from typing import Any

import anthropic
from anthropic.types import ToolParam
from dotenv import load_dotenv

_ = load_dotenv()


MODEL = os.getenv("ORONYX_LLM_MODEL", "claude-haiku-4-5-20251001")


POLICY_TOOL: ToolParam = {
    "name": "parse_agent_policy",
    "description": (
        "Extract a user's natural-language Oronyx agent policy into "
        "structured policy fields. Do not invent blockchain addresses "
        "or targets."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "spending_limit_per_tx_sui": {
                "type": "number",
                "description": ("Maximum SUI allowed in a single transaction."),
            },
            "spending_limit_period_sui": {
                "type": "number",
                "description": (
                    "Maximum total SUI spending allowed during the policy period."
                ),
            },
            "period_length_hours": {
                "type": "number",
                "description": ("Length of the spending period in hours."),
            },
            "allowed_actions": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": [
                        "transfer",
                        "mock_swap",
                        "stake",
                        "cetus_swap",
                    ],
                },
                "description": ("Actions explicitly allowed by the user."),
            },
            "allowed_targets": {
                "type": "array",
                "items": {
                    "type": "string",
                },
                "description": (
                    "Recipients, validators, pools, protocols, "
                    "or other targets explicitly mentioned."
                ),
            },
            "risk_stance": {
                "type": "string",
                "enum": [
                    "low",
                    "medium",
                    "high",
                ],
                "description": ("The user's qualitative risk preference."),
            },
            "expiry_hours": {
                "type": ["number", "null"],
                "description": (
                    "Number of hours until policy expiry. "
                    "Use null if no expiry was specified."
                ),
            },
        },
        "required": [
            "spending_limit_per_tx_sui",
            "spending_limit_period_sui",
            "period_length_hours",
            "allowed_actions",
            "allowed_targets",
            "risk_stance",
            "expiry_hours",
        ],
    },
}


SYSTEM_PROMPT = """
You are the policy parser for Oronyx.

Your job is to extract the user's natural-language policy
into the structured format provided by the parse_agent_policy tool.

Rules:

1. Extract only what the user actually says.
2. Never invent blockchain addresses.
3. Never invent recipients, validators, pools, or protocols.
4. Do not convert SUI into MIST.
5. Allowed actions must come from the user's instructions.
6. If the user explicitly permits transfers, use "transfer".
7. If the user explicitly permits swaps without naming Cetus,
   use "mock_swap".
8. Only use "cetus_swap" when the user explicitly requests Cetus.
9. Conservative, cautious, or low-risk means "low".
10. Moderate or balanced means "medium".
11. Aggressive or high-risk means "high".
12. If the user gives no expiry, return null for expiry_hours.
13. If no spending period is specified, use 24 hours.
"""


DECISION_TOOL: ToolParam = {
    "name": "make_agent_decision",
    "description": (
        "Decide whether an autonomous Oronyx agent should act on a "
        "triggering market/validator event, given its policy and recent "
        "activity. Never propose a target outside the agent's allowed "
        "targets, or an amount outside its spending limits."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "decision": {
                "type": "string",
                "enum": ["act", "no_action"],
                "description": "Whether the agent should act on this trigger.",
            },
            "reasoning": {
                "type": "string",
                "description": (
                    "Why this decision was made. Required even for "
                    "no_action — this is the only audit trail for skipped "
                    "opportunities."
                ),
            },
            "amount_mist": {
                "type": ["string", "null"],
                "description": (
                    "Amount to act with, in MIST, as a decimal string "
                    "(never a number, to avoid precision loss). Required "
                    "when decision is 'act', null otherwise. Must not "
                    "exceed the agent's actual vault_balance — vault_balance "
                    "is the real deposited funds, a separate and often "
                    "tighter constraint than spending_limit_per_tx/period "
                    "(which are only permission ceilings, not available "
                    "funds). The proposed amount must satisfy all three."
                ),
            },
            "target": {
                "type": ["string", "null"],
                "description": (
                    "The target address/pool/validator to act against — "
                    "must be one of the candidate's allowed targets. "
                    "Required when decision is 'act', null otherwise."
                ),
            },
            "risk_score": {
                "type": ["integer", "null"],
                "description": (
                    "Assessed risk of this action, 0-100. Required when "
                    "decision is 'act', null otherwise."
                ),
            },
        },
        "required": ["decision", "reasoning", "amount_mist", "target", "risk_score"],
    },
}


DECISION_SYSTEM_PROMPT = """
You are the decision engine for an autonomous Oronyx agent.

You are given: the triggering event (a price move or validator/APY
change), the agent's policy (spending limits, allowed targets, risk
threshold), its current vault balance and period spending, and its
recent activity history.

Rules:

1. Only propose a target that is already in the agent's allowed targets —
   never invent or suggest a target outside that list.
2. Never propose an amount that would exceed spending_limit_per_tx, or
   that would push period_spent over spending_limit_period. Independently
   of that, never propose an amount that exceeds vault_balance —
   vault_balance is the agent's actual deposited funds, not a permission
   ceiling like the spending limits, and it can be smaller than them. The
   proposed amount must be within all three simultaneously (effectively,
   at most the minimum of vault_balance, spending_limit_per_tx, and the
   remaining spending_limit_period - period_spent).
3. Always give a reasoning string, even for no_action — this is the only
   record of why an opportunity was skipped.
4. If recent activity shows the agent already acted on a very similar
   trigger recently, lean toward no_action to avoid churn, and say so in
   reasoning.
5. Estimate risk_score (0-100) for any proposed action; if it exceeds the
   agent's risk_threshold, the action will be queued for manual approval
   on-chain rather than executed immediately. risk_threshold only decides
   *how* an action is carried out (immediate vs. queued for the owner's
   review) — it is not a signal to avoid proposing an action in the first
   place. A low risk_threshold means the owner wants to personally review
   high-risk opportunities, not that they don't want to hear about them.
   If a genuine, policy-compliant opportunity exists, propose it
   (decision: act) regardless of how it compares to risk_threshold, and
   let that comparison route it appropriately — do not decide no_action
   merely because the estimated risk_score would exceed risk_threshold.
"""


def decide_agent_action(context: dict[str, Any]) -> dict[str, Any]:
    """Calls the Anthropic API with make_agent_decision forced, following
    parse_policy_with_llm's exact tool-use pattern.
    """
    client = _get_client()

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=DECISION_SYSTEM_PROMPT,
        tools=[DECISION_TOOL],
        tool_choice={"type": "tool", "name": "make_agent_decision"},
        messages=[{"role": "user", "content": str(context)}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "make_agent_decision":
            return block.input

    raise RuntimeError("LLM response did not include the expected tool_use block")


def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")

    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured. Add it to agent-service/.env."
        )

    return anthropic.Anthropic(api_key=api_key)


def parse_policy_with_llm(text: str) -> dict[str, Any]:
    """
    Calls the Anthropic API with the parse_agent_policy tool forced, so
    the response is always structured JSON matching POLICY_TOOL's schema
    rather than free text we'd have to parse ourselves.
    """
    client = _get_client()

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        tools=[POLICY_TOOL],
        tool_choice={"type": "tool", "name": "parse_agent_policy"},
        messages=[{"role": "user", "content": text}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "parse_agent_policy":
            return block.input

    # Forcing tool_choice should make this unreachable in practice, but
    # don't silently return something malformed if the API's behavior
    # ever changes.
    raise RuntimeError("LLM response did not include the expected tool_use block")
