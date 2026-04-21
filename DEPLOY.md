# OpenRelay — Guía de Deploy (Base Sepolia)

> **Nota**: Este guide fue el usado para el primer deploy a Base Sepolia
> (completado 2026-04-18). Los addresses resultantes están en
> [`packages/contracts/deployments/sepolia.json`](packages/contracts/deployments/sepolia.json).
> Si vas a redeployar por alguna razón, este documento te sirve; si solo
> quieres usar los contratos ya deployados, lee ese JSON directamente.

Esta guía cubre el proceso completo para desplegar los contratos de OpenRelay
(`NodeRegistry`, `StakeManager`, `DisputeResolver`) en **Base Sepolia testnet**.

> Phase 1 — Testnet. **No desplegar a mainnet** hasta completar la auditoría externa.

---

## 1. Prerequisitos

### Herramientas

- **Foundry** instalado y funcionando:
  ```bash
  forge --version
  # forge 0.2.0 (o superior)
  ```
  Si no lo tienes: `curl -L https://foundry.paradigm.xyz | bash && foundryup`

- **Submódulo `forge-std`** inicializado:
  ```bash
  cd packages/contracts
  git submodule update --init --recursive
  ```

- **Contratos compilando y tests pasando**:
  ```bash
  cd packages/contracts
  forge build
  forge test
  ```
  Deberías ver los 87 tests verdes antes de continuar.

### Fondos

- Cuenta con **Sepolia ETH** para gas. ~0.05 ETH es suficiente para el deploy
  completo de los 3 contratos. Faucets recomendados (verificados):
  - **Alchemy** — https://www.alchemy.com/faucets/base-sepolia (0.1 ETH/día, requiere cuenta gratis)
  - **QuickNode** — https://faucet.quicknode.com/base/sepolia (0.025 ETH/día)
  - **Chainstack** — https://faucet.chainstack.com/base-sepolia-faucet
  - **Superchain (Optimism)** — https://app.optimism.io/faucet (soporta Base Sepolia, requiere conectar wallet)
  - Listado oficial siempre actualizado: https://docs.base.org/chain/network-faucets

- **USDC de Base Sepolia** (solo si después quieres probar el flow completo de
  pagos). Faucet oficial de Circle:
  - https://faucet.circle.com/ → selecciona "Base Sepolia"

### API key de Basescan (opcional pero recomendado)

Para verificación automática del source code en el explorer:

- Crea una cuenta en https://basescan.org/ y genera una API key gratuita en
  https://basescan.org/myapikey
- Copia la key — la usarás como `BASESCAN_API_KEY` en el `.env`

---

## 2. Preparar el `.env`

Copia `.env.example` a `.env` y completa las variables para deploy. El bloque
mínimo requerido queda así:

```bash
# === REQUERIDO para deploy ===
DEPLOYER_PRIVATE_KEY=0x...                                      # Wallet fondeada con Sepolia ETH — NUNCA uses tu wallet principal
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org                   # RPC público (o usa tu propio RPC dedicado)
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e         # USDC oficial en Base Sepolia (no cambiar)
TREASURY_ADDRESS=0x...                                          # Dirección que recibirá fees del treasury (20% del protocol fee)

# === Árbitros del multisig 3-de-5 ===
ARBITER_1=0x...                                                 # Tu wallet de firma 1
ARBITER_2=0x...                                                 # Tu wallet de firma 2
ARBITER_3=0x...                                                 # Tu wallet de firma 3
# ARBITER_4 y ARBITER_5 son opcionales — omítelos o déjalos como 0x0000000000000000000000000000000000000000

# === Verificación en Basescan ===
BASESCAN_API_KEY=XXXX...                                        # De https://basescan.org/myapikey
```

### Notas importantes sobre el `.env`

- **Genera una wallet nueva solo para deploy.** Si tienes `cast` disponible:
  ```bash
  cast wallet new
  ```
  Esto te imprime una private key y su address. Usa **solo** esa wallet para
  deployar — nunca tu wallet personal con fondos reales en mainnet.

- **Nunca commitees el `.env`** al repositorio. El archivo ya está en
  `.gitignore`, pero verifica dos veces antes de `git add`.

- **Los 3 árbitros deben ser direcciones distintas**, aunque en Phase 1 pueden
  estar todas controladas por ti (genera 3 wallets con `cast wallet new`). Son
  placeholders hasta que la gobernanza se descentralice.

- **`DEPLOYER_PRIVATE_KEY`** debe empezar con `0x`.

- **Cargar el `.env` en la shell** antes de correr comandos:
  ```bash
  set -a && source .env && set +a
  ```
  (o usa una herramienta como `direnv` si prefieres.)

---

## 3. Checklist pre-deploy

Antes de ejecutar el deploy, verifica:

- [ ] `.env` configurado con todas las vars requeridas
- [ ] Deployer wallet fondeada con ≥0.05 Sepolia ETH (revisa en https://sepolia.basescan.org/address/<TU_ADDRESS>)
- [ ] `forge build` pasa sin errores
- [ ] `forge test -vvv` pasa (87/87)
- [ ] Tienes la API key de Basescan (opcional pero recomendado)
- [ ] El `.env` NO está commiteado al repo (`git status` lo confirma)

---

## 4. Ejecutar el deploy

Hay dos formas de correr el deploy. Ambas ejecutan el mismo script
(`packages/contracts/script/Deploy.s.sol`).

### Opción A — Con Makefile (recomendado)

Desde la raíz del repo:

```bash
make deploy-sepolia
```

El target valida que las env vars requeridas estén definidas antes de invocar
`forge script`. Si falta alguna, aborta con un mensaje claro.

### Opción B — Manualmente

Si prefieres controlar cada flag directamente:

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY
```

### Qué hace cada flag

- `--rpc-url` — endpoint de Base Sepolia (chain ID 84532).
- `--private-key` — firma las txs de deploy con la wallet deployer.
- `--broadcast` — sin este flag, Foundry solo simula el deploy (dry-run). Con él, envía las txs a la red.
- `--verify` — después de deployar, envía el source code a Basescan para verificación.
- `--etherscan-api-key` — la API key de Basescan (Foundry usa esa flag aunque la red sea Base).

Si **no tienes API key de Basescan**, omite `--verify` y `--etherscan-api-key`.
Puedes verificar manualmente después (ver sección 6).

### Qué esperar en la salida

El script deploya los 3 contratos en orden:

1. `StakeManager` — con `usdc` y `guardian` (deployer)
2. `DisputeResolver` — apuntando a `StakeManager`, con el `treasury` y el array de árbitros
3. `NodeRegistry` — apuntando a `StakeManager`
4. Llama a `stakeManager.initialize(disputeResolver, nodeRegistry)` para cerrar la dependencia circular

Al final imprime las 3 direcciones y corre verificaciones sanity-check.

---

## 5. Guardar las direcciones

El script termina imprimiendo un bloque listo para copiar al `.env`:

```
--- Copy to your .env ---
NODE_REGISTRY_ADDRESS=0x...
STAKE_MANAGER_ADDRESS=0x...
DISPUTE_RESOLVER_ADDRESS=0x...
-------------------------
```

Copia esas 3 líneas a tu `.env` (reemplazando los ceros por defecto). El API y
el Node las leen al arrancar para conectarse a los contratos.

### Artefactos de Foundry

Foundry guarda el deploy completo (txs, receipts, addresses) en:

```
packages/contracts/broadcast/Deploy.s.sol/84532/run-latest.json
```

Donde `84532` es el chain ID de Base Sepolia. Guarda este archivo —
es la evidencia reproducible del deploy y sirve para debugging futuro.

---

## 6. Verificar en Basescan

Una vez deployado, cada contrato es visible en:

```
https://sepolia.basescan.org/address/<CONTRACT_ADDRESS>
```

Si usaste `--verify` y todo salió bien, verás el source code y el tab "Read
Contract" / "Write Contract" disponibles.

### Verificar manualmente (si `--verify` falló)

```bash
cd packages/contracts

forge verify-contract <ADDRESS> src/NodeRegistry.sol:NodeRegistry \
  --chain base-sepolia \
  --etherscan-api-key $BASESCAN_API_KEY

forge verify-contract <ADDRESS> src/StakeManager.sol:StakeManager \
  --chain base-sepolia \
  --etherscan-api-key $BASESCAN_API_KEY

forge verify-contract <ADDRESS> src/DisputeResolver.sol:DisputeResolver \
  --chain base-sepolia \
  --etherscan-api-key $BASESCAN_API_KEY
```

Si los contratos tienen args del constructor, puede que necesites pasarlos
con `--constructor-args $(cast abi-encode "constructor(address,address)" <usdc> <guardian>)`.
Los args están visibles en `broadcast/Deploy.s.sol/84532/run-latest.json`.

---

## 7. Verificar que la red funciona (smoke test)

Una vez deployados y con las direcciones en `.env`, haz un smoke test del
stack completo.

1. **Actualiza `.env`** con las direcciones reales:
   ```bash
   NODE_REGISTRY_ADDRESS=0x...   # de la salida del script
   STAKE_MANAGER_ADDRESS=0x...
   DISPUTE_RESOLVER_ADDRESS=0x...
   ```

2. **Levanta el stack**:
   ```bash
   make up
   ```

3. **Seed inicial** (crea merchant + API keys):
   ```bash
   make seed
   ```
   Guarda las API keys que imprime — no se vuelven a mostrar.

4. **Crea un payment intent de prueba**:
   ```bash
   curl -X POST http://localhost:3000/v1/intents \
     -H "Authorization: Bearer sk_test_XXXX" \
     -H "Content-Type: application/json" \
     -d '{"amount": "10.00", "currency": "USDC"}'
   ```
   Deberías recibir un JSON con `id`, `status: "created"`, y la dirección
   de pago derivada.

5. **Revisa los logs**:
   ```bash
   make logs-api
   make logs-node
   ```
   Busca errores en el arranque (conexión a RPC, lectura de contratos, etc.)

---

## 8. Troubleshooting

Errores comunes y sus soluciones:

### `Insufficient funds`
Falta Sepolia ETH en la deployer wallet. Usa los faucets listados en la
sección 1 y espera a que la tx del faucet confirme antes de reintentar.

### `nonce too low`
Nonce desincronizado (ocurre si hiciste txs desde la misma wallet en paralelo).
Espera unos segundos y reintenta — Foundry vuelve a leer el nonce.

### `execution reverted: NotGuardian`
El `initialize()` de `StakeManager` fue llamado por una wallet distinta a la
deployer. Esto no debería pasar con el script estándar porque el script usa
la misma `DEPLOYER_PRIVATE_KEY` en todos los pasos. Si te ocurre, asegúrate
de no tener un deploy parcial de una corrida anterior — re-deploya desde cero.

### `forge: command not found`
Foundry no está en el PATH. Corre `foundryup` o reinstala:
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Verify falla en Basescan
- Revisa que `BASESCAN_API_KEY` sea válida (cópiala de nuevo de https://basescan.org/myapikey).
- Asegúrate de que la key sea de **Basescan** (no de Etherscan mainnet).
- Si el contrato ya tenía otra verificación parcial, puede rechazar. Espera 1-2 minutos y reintenta.

### `No source files found`
Estás corriendo `forge script` desde el directorio equivocado. Debe ser desde
`packages/contracts/`:
```bash
cd packages/contracts
```

### `ARBITER_1: environment variable not found`
La env var no está cargada en la shell. Recuerda:
```bash
set -a && source .env && set +a
```

---

## 9. Siguientes pasos

Después de un deploy exitoso:

### Registrar tu primer nodo

Para operar un relay node, primero aprueba USDC al `StakeManager` y luego llama
a `NodeRegistry.register()` con un stake `>= minStake`. En Sepolia testnet
`minStake` arranca en 40 USDC (`40000000` con 6 decimales). En mainnet
arrancará en 100 USDC. El `minStake` actual se puede leer on-chain:

```bash
cast call $NODE_REGISTRY_ADDRESS "minStake()(uint256)" --rpc-url $BASE_SEPOLIA_RPC_URL
```

**⚠️ El `endpoint` queda publicado on-chain** (visible a cualquiera que consulte
el registry) y solo puede actualizarse después vía `updateEndpoint()`. Nunca
registres `http://localhost:*` — usa tu URL pública real (ej.
`https://node-01.tu-dominio.com`).

**Opción A — script de conveniencia (recomendada para Sepolia):**

```bash
# Requiere NODE_ENDPOINT en .env con la URL pública de tu nodo.
bash scripts/register-node-sepolia.sh
```

El script lee `minStake` on-chain, valida tu balance de USDC, aborta si el
endpoint es localhost, y corre los dos `cast send` con verificación final.

**Opción B — manual con `cast`:**

```bash
# 1. Aprobar USDC al StakeManager (40 USDC en Sepolia)
cast send $USDC_ADDRESS "approve(address,uint256)" \
  $STAKE_MANAGER_ADDRESS 40000000 \
  --private-key $NODE_OPERATOR_PRIVATE_KEY \
  --rpc-url $BASE_SEPOLIA_RPC_URL

# 2. Registrar el nodo (reemplaza el endpoint por tu URL pública)
cast send $NODE_REGISTRY_ADDRESS "register(string,uint256)" \
  "https://tu-nodo.example.com" 40000000 \
  --private-key $NODE_OPERATOR_PRIVATE_KEY \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

### Publicar las direcciones a la comunidad

Abre un Issue en GitHub con el tag `deployment` incluyendo:

- Chain: `Base Sepolia (84532)`
- Block de deploy (de `run-latest.json`)
- Direcciones de los 3 contratos (con links a Basescan)
- Hash del commit usado para deployar

Así otros pueden apuntar sus nodos o dashboards a tu deploy.

### Correr el daemon node apuntando a los contratos deployados

Actualiza `.env` con `NODE_OPERATOR_ADDRESS` y `NODE_OPERATOR_PRIVATE_KEY`,
y relanza el stack:

```bash
make restart-node
make logs-node
```

---

## 10. Seguridad — Notas importantes

- **NO deployar a mainnet aún.** Los contratos están pendientes de auditoría
  externa. Phase 1 es testnet-only.

- **El guardian puede pausar los contratos** (patrón `Pausable` de OpenZeppelin).
  El guardian es la deployer wallet por defecto — rota esa key si sospechas compromiso.

- **Gobernanza de árbitros 3-de-5.** Agregar un nuevo árbitro requiere
  `proposeArbiter()` seguido de 3 aprobaciones (sobre los árbitros existentes).
  No hay forma de bypass — planea la composición del multisig antes de deployar.

- **`initialize()` solo se puede llamar UNA vez.** Si algo falla entre los
  pasos 1-3 del deploy, los contratos quedan en un estado inservible (el
  `StakeManager` no sabe quién es el `DisputeResolver` ni el `NodeRegistry`).
  En ese caso, re-deploya desde cero — no intentes recuperar el deploy parcial.

- **No reutilices la deployer wallet para operaciones normales.** Después del
  deploy, transfiere el guardian role a un multisig (cuando exista) y mueve
  los fondos restantes a una wallet separada.

---

## Referencias

- Script de deploy: `packages/contracts/script/Deploy.s.sol`
- Config Foundry: `packages/contracts/foundry.toml`
- Variables de entorno: `.env.example`
- Target del Makefile: `deploy-sepolia`
- Chain ID Base Sepolia: `84532`
- Explorer: https://sepolia.basescan.org/
