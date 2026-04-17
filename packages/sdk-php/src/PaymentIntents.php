<?php

declare(strict_types=1);

namespace OpenRelay;

use GuzzleHttp\Client;

/**
 * Operations on payment intents.
 *
 * @example
 * $intent = $relay->paymentIntents->create(10_000_000, 'usdc', 'base', ['order_id' => '123']);
 */
class PaymentIntents
{
    public function __construct(private Client $http) {}

    public function create(int $amount, string $currency, string $chain, array $metadata = []): array
    {
        $response = $this->http->post('/v1/payment_intents', [
            'json' => compact('amount', 'currency', 'chain', 'metadata'),
        ]);
        return json_decode((string) $response->getBody(), true);
    }

    public function retrieve(string $intentId): array
    {
        $response = $this->http->get("/v1/payment_intents/{$intentId}");
        return json_decode((string) $response->getBody(), true);
    }

    public function cancel(string $intentId): array
    {
        $response = $this->http->post("/v1/payment_intents/{$intentId}/cancel");
        return json_decode((string) $response->getBody(), true);
    }

    public function list(int $limit = 10, ?string $startingAfter = null): array
    {
        $query = ['limit' => $limit];
        if ($startingAfter) $query['starting_after'] = $startingAfter;
        $response = $this->http->get('/v1/payment_intents', ['query' => $query]);
        return json_decode((string) $response->getBody(), true);
    }
}
