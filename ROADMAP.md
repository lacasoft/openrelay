# Hoja de Ruta de OpenRelay

*De testnet a red comunitaria con tracción real. Construido por la comunidad, al ritmo de la comunidad.*

> **Actualización (2026-04-18):** Phase 1 hito completado — deploy en Base Sepolia live con contratos verificados. Ver `packages/contracts/deployments/sepolia.json`.

---

## Por qué existe esta hoja de ruta

América Latina está viviendo una transición acelerada hacia los pagos digitales. México, Colombia, Chile, Argentina y Brasil tienen políticas activas para reducir el uso de efectivo. Esto abre una ventana única para construir infraestructura abierta antes de que los estándares se consoliden alrededor de opciones cerradas.

Las plataformas existentes —Stripe, Mercado Pago, Clip, Conekta— funcionan, pero cobran comisiones que hacen inviable a los comercios de margen pequeño y dejan fuera a quienes no tienen acceso bancario. No existe una opción que sea código abierto, con comisiones casi cero, fácil de integrar y con una red comunitaria de nodos que hable español como ciudadano de primera clase.

Esa es la oportunidad que persigue OpenRelay. La ventana para construir infraestructura de propiedad comunitaria antes de que los estándares de mercado se vuelvan el default no se mide en años, se mide en meses.

---

## Principios rectores

**LATAM primero.** México es el mercado de lanzamiento. España es el segundo mercado. El resto de LATAM sigue. El problema se siente con más fuerza donde Stripe cobra más caro, llega peor, y donde la transición de efectivo a digital ocurre con más velocidad.

**Complementarios, no sustitutos.** Cuando un banco mexicano quiera ofrecer pagos en USDC a sus clientes, va a necesitar una capa de enrutamiento. OpenRelay puede ser esa capa. No estamos compitiendo contra la adopción institucional de cripto —queremos que se integre sobre infraestructura abierta, no sobre infraestructura cerrada.

**Velocidad sobre perfección.** El mercado se está definiendo ahora. Un v1 funcionando en manos de comercios reales en Ciudad de México vale más que un v2 perfecto en un repositorio de GitHub.

**La comunidad es el diferenciador.** La única ventaja competitiva durable frente a alternativas cerradas es una comunidad de operadores de nodo, contribuidores y comercios que ninguna entidad controla. Cada decisión en esta hoja de ruta debe priorizar el crecimiento de esa comunidad.

---

## Fase 1 — Fundación (Meses 1–4)

**Objetivo:** Protocolo funcionando en Base Sepolia testnet. Primera integración con SDK. Primer comercio. Primer nodo comunitario.

### Hitos Técnicos

- [x] Contratos inteligentes: `NodeRegistry.sol`, `StakeManager.sol`, `DisputeResolver.sol`
- [x] Suite de tests Foundry: 58 tests + fuzz en los tres contratos
- [x] Script de deploy: `Deploy.s.sol` listo para Base Sepolia
- [x] Daemon del nodo: API HTTP con Fastify, rutas estructuradas
- [x] API REST: payment intents, webhooks, rutas x402 estructuradas
- [x] SDK JS: `@openrelay/sdk` con payment intents, webhooks, middleware x402
- [x] Docker Compose: stack autoalojado completo en un solo comando
- [x] CI con GitHub Actions: typecheck + test + build + Foundry
- [x] **Deploy de contratos a Base Sepolia** — completado 2026-04-18 (ver `packages/contracts/deployments/sepolia.json`)
- [ ] Conectar el motor de routing a `NodeRegistry.sol` via viem
- [ ] Implementar persistencia en PostgreSQL en la API
- [ ] Conectar firma HMAC en el daemon del nodo
- [ ] Dirección de pago única por intent (derivación HD wallet)
- [ ] Verificación on-chain de pagos x402 + protección contra replay
- [ ] Entrega de webhooks con cola de reintentos

### Hitos de Mercado

- [ ] Primer bootstrap node operando (operado por el equipo)
- [ ] Primera integración con un comercio (autoalojado, México)
- [ ] Anuncio público de testnet en comunidades de desarrolladores hispanohablantes
- [ ] Repositorio público en GitHub bajo `lacasoft`

### Hitos de Comunidad

- [ ] Servidor de Discord abierto
- [ ] Primer PR externo mergeado
- [ ] Documentación para operadores de nodo completa en español e inglés

---

## Fase 2 — Red (Meses 4–10)

**Objetivo:** Registro de nodos permissionless abierto a cualquiera. Primeros nodos comunitarios en México y España. Soporte para Lightning Network. On-ramp para usuarios que pagan en efectivo.

### Hitos Técnicos

- [ ] Registro permissionless de nodos via `NodeRegistry.sol` en Base mainnet
- [ ] Motor de routing completo: descubrimiento de nodos on-chain, cache de score, racing paralelo
- [ ] Sistema de reputación de nodos: score on-chain visible via `/v1/nodes`
- [ ] Soporte para Lightning Network (micropagos en BTC)
- [ ] SDK Python: `openrelay-python` en PyPI
- [ ] SDK PHP: `openrelay/openrelay` en Packagist
- [ ] Dashboard de comercio: Next.js + shadcn/ui
- [ ] Plugin de WooCommerce (crítico para la adopción de comercios mexicanos)
- [ ] **Integración de on-ramp SPEI / Oxxo Pay** — convierte efectivo a USDC en el punto de venta
  - Socios: Kueski, OpenPay u otros proveedores fintech mexicanos similares
  - Esto desbloquea el 80% de transacciones mexicanas que siguen en efectivo
  - Sin esto, OpenRelay solo sirve a la minoría bancarizada
- [ ] UI de resolución de disputas para comercios

### Hitos de Mercado

- [ ] Primer nodo comunitario en México (operador ajeno al equipo)
- [ ] Primer nodo comunitario en España
- [ ] Primera tienda WooCommerce usando OpenRelay en producción
- [ ] Anuncio de alianza con al menos una fintech mexicana para on-ramp

### Hitos de Comunidad

- [ ] Primer bounty de contribuidor pagado desde el treasury
- [ ] 10+ contribuidores externos
- [ ] Cadencia de llamadas comunitarias establecida (mensuales, en español)
- [ ] Guía para operadores de nodo traducida: español, inglés, portugués

---

## Fase 3 — Ecosistema (Meses 10–18)

**Objetivo:** Multi-chain. SDK Go para agentes de IA. Capa de compatibilidad para integradores grandes. Gobernanza on-chain. Treasury autosustentable.

### Hitos Técnicos

- [ ] Soporte para USDC en Polygon
- [ ] Soporte para USDC en Solana
- [ ] SDK Go: `github.com/lacasoft/openrelay-go`
  - Crítico para infraestructura de agentes de IA (MCP, agentes autónomos)
  - Este es el consumidor principal de x402 en 2026+
- [ ] **Capa de compatibilidad para integradores grandes**
  - OpenRelay como capa de enrutamiento para productos institucionales
  - API documentada para que bancos y gestores de activos integren
  - OpenRelay no hace custodia ni KYC — la institución integradora se encarga de eso
- [ ] Gobernanza on-chain para cambios al protocolo
  - Reemplaza el arbitraje con multisig en `DisputeResolver.sol`
  - El proceso RFC migra on-chain con votación de contribuidores
- [ ] Dashboard público del treasury
  - Acumulación de fees visible en tiempo real para cualquiera
  - Asignación de bounties transparente y on-chain
- [ ] El equipo core sale de la operación de bootstrap nodes
  - Todo el routing es manejado por nodos comunitarios
  - Los bootstrap nodes se apagan de forma transparente

### Hitos de Mercado

- [ ] 10+ nodos comunitarios activos en Base mainnet
- [ ] 3+ países de LATAM con comercios en producción
- [ ] Primer socio integrador grande usando OpenRelay como capa de enrutamiento
- [ ] v1.0 declarado (ver criterios abajo)

### Hitos de Comunidad

- [ ] Primera votación de gobernanza sobre cambio al protocolo
- [ ] 50+ contribuidores en todos los paquetes
- [ ] Nodos comunitarios dedicados en MX, ES, AR, CO
- [ ] Primera charla sobre OpenRelay en una conferencia de desarrolladores en español

---

## Criterios para declarar v1.0

La versión 1.0 se declarará cuando las tres condiciones se cumplan simultáneamente:

1. Contratos inteligentes auditados por una firma independiente y desplegados en Base mainnet
2. Al menos 10 nodos comunitarios independientes activos en la red
3. SDK usado en al menos un deployment de comercio en producción

Estos criterios son públicos, verificables y no negociables. No hay inflación de versiones.

---

## Lo que no está en esta hoja de ruta

**Gateway de fiat.** Stripe procesa Visa y Mastercard porque tiene licencias bancarias en 50 países. OpenRelay nunca va a tener eso — y no lo necesita. Los comercios que necesiten fiat deberían usar Stripe para fiat y OpenRelay para cripto. Son complementarios, no competidores.

**Un token del protocolo.** Nunca va a existir un token RELAY. Los operadores de nodo ganan USDC. Los contribuidores ganan reputación y voz. Introducir un token especulativo corrompería la estructura de incentivos y atraería a la comunidad equivocada.

**Upgradeabilidad en los contratos core.** Los tres contratos son no-upgradeable por diseño. Cualquier cambio al protocolo que requiera modificar contratos pasa por un ciclo completo de auditoría y un deploy nuevo — no por un upgrade. Esto es una característica, no una limitación.

**Capa de cumplimiento KYC/AML.** OpenRelay no procesa identidad. Esa es responsabilidad del comercio según la jurisdicción donde opere. OpenRelay provee el enrutamiento de pagos; el cumplimiento regulatorio queda aguas arriba.

---

## El sentido de urgencia

La ventana para construir alternativas comunitarias es real y finita. Cada mes que OpenRelay no tenga una red de nodos funcionando y al menos un comercio en producción es un mes en el que las opciones cerradas consolidan su ventaja.

La comunidad tiene la ventaja técnica: código abierto, comisiones casi cero, sin gatekeepers. La única manera de convertir esa ventaja técnica en ventaja de adopción es moviéndonos rápido.

---

*Esta hoja de ruta es un documento vivo. Los cambios se proponen via issues de GitHub etiquetados como `roadmap`. Los cambios aprobados se mergean con un bump de versión y una entrada fechada en el changelog.*

*Última actualización: Abril 2026*
