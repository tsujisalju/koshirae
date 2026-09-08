"""Shared gRPC client bootstrap for talking to Sui via pysui.

pysui's GrpcProtocolClient requires a PysuiConfiguration backed by an
on-disk PysuiConfig.json (like the `sui` CLI's client.yaml) rather than a
simple in-code constructor. pysui's own `PysuiConfiguration.initialize_config`
convenience path (`grpc_from_sui=True`) derives that file from an existing
`~/.sui/sui_config`, which this container doesn't have — so we build a
minimal config file directly from pysui's own model dataclasses instead,
pointed at our own configured endpoint.
"""

from pathlib import Path
from typing import Any

from app.config import settings
from pysui.sui.sui_common.config.confgroup import GroupProtocol, Profile, ProfileGroup
from pysui.sui.sui_common.config.confmodel import (
    _CURRENT_CONFIG_VERSION,  # pyright: ignore[reportPrivateUsage] -- no public alternative; pysui's own initialize_config() reads this same constant internally
    PysuiConfigModel,
)
from pysui.sui.sui_common.config.pysui_config import PysuiConfiguration
from pysui.sui.sui_grpc.pgrpc_clients import GrpcProtocolClient
from pysui.sui.sui_grpc.suimsgs.google.protobuf import Value

_CONFIG_ROOT = Path(".pysui")
_CONFIG_FILE = _CONFIG_ROOT / "PysuiConfig.json"
_GROUP_NAME = "oronyx_grpc"
_PROFILE_NAME = "oronyx"


def _bootstrap_config() -> PysuiConfiguration:
    # No secrets/keys involved (read-only queries) — safe to regenerate on
    # every container start rather than persisting via a volume.
    if not _CONFIG_FILE.exists():
        _CONFIG_ROOT.mkdir(parents=True, exist_ok=True)
        model = PysuiConfigModel(
            version=_CURRENT_CONFIG_VERSION,
            sui_binary="",
            group_active=_GROUP_NAME,
            groups=[
                ProfileGroup(
                    group_name=_GROUP_NAME,
                    using_profile=_PROFILE_NAME,
                    using_address="",
                    alias_list=[],
                    key_list=[],
                    address_list=[],
                    profiles=[
                        Profile(profile_name=_PROFILE_NAME, url=settings.sui_grpc_url)
                    ],
                    protocol=GroupProtocol.GRPC,
                )
            ],
        )
        _ = _CONFIG_FILE.write_text(model.to_json(indent=2))

    return PysuiConfiguration(
        from_cfg_path=str(_CONFIG_ROOT),
        group_name=_GROUP_NAME,
        profile_name=_PROFILE_NAME,
    )


_client: GrpcProtocolClient | None = None


def get_client() -> GrpcProtocolClient:
    global _client
    if _client is None:
        _client = GrpcProtocolClient(pysui_config=_bootstrap_config())
    return _client


def pb_value_to_dict(value: Value | None) -> dict[str, Any]:
    """Normalize a google.protobuf.Value (used for both Event.json and
    Object.json) to a plain dict.

    Verified directly against the installed betterproto2 stubs: a struct
    Value.to_dict() returns the native Python dict recursively (confirmed
    by reading Value.to_dict()'s source in the installed package).
    """
    if value is None:
        return {}
    decoded = value.to_dict()
    if not isinstance(decoded, dict):
        raise TypeError(f"Expected .json to decode to a dict, got {type(decoded)!r}")
    return decoded
