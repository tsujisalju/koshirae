/// One-time-witness coin definition for the mock USDC side of
/// `koshirae::mock_dex`'s pool. Split into its own module because a
/// one-time-witness struct's name must match its declaring module's
/// name uppercased — `mock_dex`'s OTW would have to be `MOCK_DEX`, not
/// `MOCK_USDC`.
module koshirae::mock_usdc;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::coin_registry;

/// One-time-witness coin type for the mock USDC side of the pool.
public struct MOCK_USDC has drop {}

fun init(otw: MOCK_USDC, ctx: &mut TxContext) {
    let (currency_init, treasury_cap) = coin_registry::new_currency_with_otw(
        otw,
        6,
        b"mUSDC".to_string(),
        b"Mock USDC".to_string(),
        b"Fixed-rate demo token for Koshirae's mock DEX fallback. Not real value.".to_string(),
        b"".to_string(),
        ctx,
    );
    // Supply is left open (not fixed/burn-only) since the team needs to
    // keep minting via the retained TreasuryCap for `create_pool`/demo
    // top-ups. The MetadataCap is discarded — nobody needs to edit this
    // currency's metadata after publish.
    currency_init.finalize_and_delete_metadata_cap(ctx);

    // Treasury cap goes to whoever publishes the package (the team), so
    // they can mint initial supply for `create_pool`. Not intended to be
    // held or used by end users or agents.
    transfer::public_transfer(treasury_cap, ctx.sender());
}

public fun mint_mock_usdc(
    treasury_cap: &mut TreasuryCap<MOCK_USDC>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<MOCK_USDC> {
    coin::mint(treasury_cap, amount, ctx)
}
