from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    sui_rpc_url: str = Field(
        default="https://fullnode.testnet.sui.io:443", alias="SUI_RPC_URL"
    )
    # pysui's gRPC profiles use a bare host:port, not a URL with scheme —
    # kept as a separate setting rather than derived from sui_rpc_url.
    sui_grpc_url: str = Field(
        default="fullnode.testnet.sui.io:443", alias="SUI_GRPC_URL"
    )
    oronyx_package_id: str = Field(default="", alias="ORONYX_PACKAGE_ID")
    executor_url: str = Field(
        default="http://executor:4000", alias="ORONYX_EXECUTOR_URL"
    )
    # DeepBook pool used purely as a price signal for the swap trigger —
    # unrelated to the on-chain mock-pool target an agent actually swaps
    # against (that comes from the agent's own allowed_targets). Defaults
    # to testnet's SUI/DBUSDC pool and the testnet DeepBook package, per
    # @mysten/deepbook-v3's testnetPackageIds/testnetPools (v2.1.4).
    deepbook_package_id: str = Field(
        default="0xd874d2417a55bfa6479bffa06ad950fea144ef93a94cc6c49f32b03e386bbb24",
        alias="DEEPBOOK_PACKAGE_ID",
    )
    deepbook_price_pool_id: str = Field(
        default="0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5",
        alias="DEEPBOOK_PRICE_POOL_ID",
    )
    deepbook_base_coin_type: str = Field(
        default="0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
        alias="DEEPBOOK_BASE_COIN_TYPE",
    )
    deepbook_base_coin_scalar: int = Field(default=1_000_000_000, alias="DEEPBOOK_BASE_COIN_SCALAR")
    deepbook_quote_coin_type: str = Field(
        default="0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
        alias="DEEPBOOK_QUOTE_COIN_TYPE",
    )
    deepbook_quote_coin_scalar: int = Field(default=1_000_000, alias="DEEPBOOK_QUOTE_COIN_SCALAR")

    class Config:
        env_file = ".env"
        populate_by_name = True
        extra = "ignore"


settings = Settings()
