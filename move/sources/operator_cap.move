module oronyx::operator_cap;

/// Delegation object. Whoever holds a live OperatorCap may act as the
/// operator on the AgentCap it references. Minted and revoked from
/// `capability.move`
public struct OperatorCap has key {
    id: UID,
    agent_cap_id: ID,
    generation: u64,
}

public fun agent_cap_id(cap: &OperatorCap): ID { cap.agent_cap_id }
public fun generation(cap: &OperatorCap): u64 { cap.generation }

/// Package-visible, only capability.move (same package) can construct
/// one. Nothing outside Koshirae can forge an OperatorCap directly.
public(package) fun new(agent_cap_id: ID, generation: u64, ctx: &mut TxContext): OperatorCap {
    OperatorCap {
        id: object::new(ctx),
        agent_cap_id,
        generation,
    }
}

/// Package-visible transfer. OperatorCap deliberately has no `store`
/// ability so it can't be wrapped or moved by code outside this module;
/// this is the only way another module in the package can hand one off.
public(package) fun transfer_to(cap: OperatorCap, recipient: address) {
    transfer::transfer(cap, recipient);
}
