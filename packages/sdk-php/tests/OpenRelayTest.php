<?php

namespace OpenRelay\Tests;

use PHPUnit\Framework\TestCase;
use OpenRelay\OpenRelay;

class OpenRelayTest extends TestCase
{
    // ── Client initialization ─────────────────────────────────────

    public function testClientInitialization(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertInstanceOf(OpenRelay::class, $client);
    }

    public function testClientHasPaymentIntents(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertInstanceOf(\OpenRelay\PaymentIntents::class, $client->paymentIntents);
    }

    public function testClientHasWebhooks(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertInstanceOf(\OpenRelay\Webhooks::class, $client->webhooks);
    }

    // ── PaymentIntents methods exist ──────────────────────────────

    public function testPaymentIntentsHasCreateMethod(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertTrue(method_exists($client->paymentIntents, 'create'));
    }

    public function testPaymentIntentsHasRetrieveMethod(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertTrue(method_exists($client->paymentIntents, 'retrieve'));
    }

    public function testPaymentIntentsHasCancelMethod(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertTrue(method_exists($client->paymentIntents, 'cancel'));
    }

    public function testPaymentIntentsHasListMethod(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertTrue(method_exists($client->paymentIntents, 'list'));
    }

    // ── Custom base URL ───────────────────────────────────────────

    public function testCustomBaseUrl(): void
    {
        // Should not throw
        $client = new OpenRelay('sk_live_test123', 'https://custom.api.dev');

        $this->assertInstanceOf(OpenRelay::class, $client);
    }

    // ── Webhooks methods exist ────────────────────────────────────

    public function testWebhooksHasVerifyMethod(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertTrue(method_exists($client->webhooks, 'verify'));
    }

    public function testWebhooksHasRegisterMethod(): void
    {
        $client = new OpenRelay('sk_live_test123');

        $this->assertTrue(method_exists($client->webhooks, 'register'));
    }
}
