"""OpenRelay API resource classes."""
from __future__ import annotations
import httpx
from .errors import OpenRelayError


async def _request(client: httpx.AsyncClient, method: str, path: str, **kwargs):
    response = await client.request(method, f"/v1{path}", **kwargs)
    data = response.json()
    if not response.is_success:
        err = data.get("error", {})
        raise OpenRelayError(
            code=err.get("code", "unknown_error"),
            message=err.get("message", "Unknown error"),
            param=err.get("param"),
            doc_url=err.get("doc_url", "https://docs.openrelay.dev"),
        )
    return data


class PaymentIntents:
    """
    Operations on payment intents.

    Example:
        intent = await relay.payment_intents.create(
            amount=10_000_000, currency="usdc", chain="base",
            metadata={"order_id": "123"}
        )
    """

    def __init__(self, client: httpx.AsyncClient):
        self._client = client

    async def create(self, amount: int, currency: str, chain: str, **kwargs) -> dict:
        return await _request(
            self._client, "POST", "/payment_intents",
            json={"amount": amount, "currency": currency, "chain": chain, **kwargs},
        )

    async def retrieve(self, intent_id: str) -> dict:
        return await _request(self._client, "GET", f"/payment_intents/{intent_id}")

    async def cancel(self, intent_id: str) -> dict:
        return await _request(self._client, "POST", f"/payment_intents/{intent_id}/cancel")

    async def list(self, limit: int = 10, starting_after: str | None = None) -> dict:
        params = {"limit": limit}
        if starting_after:
            params["starting_after"] = starting_after
        return await _request(self._client, "GET", "/payment_intents", params=params)


class Webhooks:
    """
    Webhook endpoint management and signature verification.

    Example:
        relay.webhooks.verify(payload, signature, secret)
    """

    def __init__(self, client: httpx.AsyncClient):
        self._client = client

    def verify(self, payload: str, signature: str, secret: str) -> dict:
        import hmac, hashlib, json, time
        parts = {p.split("=")[0]: p.split("=")[1] for p in signature.split(",")}
        ts, sig = parts.get("t", ""), parts.get("v1", "")

        # Reject if timestamp is older than 5 minutes to prevent replay attacks
        try:
            ts_int = int(ts)
        except (ValueError, TypeError):
            raise ValueError("Invalid webhook timestamp")
        if abs(time.time() - ts_int) > 300:
            raise ValueError("Webhook timestamp too old")

        expected = hmac.new(
            secret.encode(), f"{ts}.{payload}".encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise ValueError("Webhook signature verification failed")
        return json.loads(payload)

    async def register(self, url: str, events: list[str]) -> dict:
        return await _request(
            self._client, "POST", "/webhooks", json={"url": url, "events": events}
        )
