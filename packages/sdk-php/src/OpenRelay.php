<?php

declare(strict_types=1);

namespace OpenRelay;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\ClientException;

/**
 * OpenRelay PHP SDK client.
 *
 * @example
 * $relay = new OpenRelay('sk_live_xxx');
 * $intent = $relay->paymentIntents->create(10_000_000, 'usdc', 'base');
 */
class OpenRelay
{
    private Client $http;
    public PaymentIntents $paymentIntents;
    public Webhooks $webhooks;

    public function __construct(
        string $apiKey,
        string $baseUrl = 'https://api.openrelay.dev',
        float $timeout = 30.0
    ) {
        $this->http = new Client([
            'base_uri' => rtrim($baseUrl, '/'),
            'timeout'  => $timeout,
            'headers'  => [
                'Authorization'    => "Bearer {$apiKey}",
                'Content-Type'     => 'application/json',
                'OpenRelay-Version' => '0.1',
            ],
        ]);
        $this->paymentIntents = new PaymentIntents($this->http);
        $this->webhooks       = new Webhooks($this->http);
    }
}
