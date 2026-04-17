"""
OpenRelay Python SDK
The open payment network. No fees. No gatekeepers.
"""
from .client import OpenRelay
from .errors import OpenRelayError

__all__ = ["OpenRelay", "OpenRelayError"]
__version__ = "0.0.1"
