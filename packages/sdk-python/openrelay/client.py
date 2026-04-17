"""OpenRelay main client."""
from __future__ import annotations
import httpx
from .resources import PaymentIntents, Webhooks


class OpenRelay:
    """
    OpenRelay API client.

    Example:
        relay = OpenRelay(api_key="sk_live_xxx")
        intent = await relay.payment_intents.create(
            amount=10_000_000, currency="usdc", chain="base"
        )
    """

    BASE_URL = "https://api.openrelay.dev"

    def __init__(self, api_key: str, base_url: str | None = None, timeout: float = 30.0):
        if not api_key:
            raise ValueError("OpenRelay: api_key is required")
        self._client = httpx.AsyncClient(
            base_url=base_url or self.BASE_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "OpenRelay-Version": "0.1",
            },
            timeout=timeout,
        )
        self.payment_intents = PaymentIntents(self._client)
        self.webhooks = Webhooks(self._client)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "OpenRelay":
        return self

    async def __aexit__(self, *args) -> None:
        await self.close()
