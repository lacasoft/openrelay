# OpenRelay — Makefile
# ─────────────────────────────────────────────────────────────
# make up        → levanta todo el stack
# make down      → baja el stack
# make seed      → crea el primer merchant + API key
# make logs      → muestra logs de todos los servicios
# make logs-api  → logs solo del API
# make logs-node → logs solo del nodo
# make restart   → reinicia el stack
# make clean     → elimina volúmenes y empieza desde cero
# make test      → corre todos los tests
# make contracts → compila y testea contratos Solidity
# make check-deploy-env   → valida vars de deploy en .env
# make check-sepolia-balance → verifica balance del deployer
# make deploy-sepolia     → deploy en Base Sepolia (con verify opcional)
# make deploy-addresses   → muestra direcciones del último deploy
# make verify-sepolia     → verifica manualmente en Basescan
# make status    → muestra el estado de todos los servicios

.PHONY: up down seed logs logs-api logs-node restart clean test contracts check-deploy-env check-sepolia-balance deploy-sepolia deploy-addresses verify-sepolia status help

# Colores para output
GREEN  := \033[0;32m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
RESET  := \033[0m

help: ## Muestra esta ayuda
	@echo ""
	@echo "$(CYAN)OpenRelay — Comandos disponibles$(RESET)"
	@echo "─────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(RESET) %s\n", $$1, $$2}'
	@echo ""

up: ## Levanta el stack completo (API + Node + PostgreSQL + Redis)
	@echo "$(CYAN)Levantando OpenRelay...$(RESET)"
	@docker compose up -d
	@echo ""
	@echo "$(GREEN)Stack levantado.$(RESET)"
	@echo ""
	@echo "  API:      http://localhost:3000"
	@echo "  Node:     http://localhost:4000"
	@echo "  Postgres: localhost:5432"
	@echo ""
	@echo "Corre $(YELLOW)make seed$(RESET) si es la primera vez."

down: ## Baja el stack
	@echo "$(YELLOW)Bajando OpenRelay...$(RESET)"
	@docker compose down
	@echo "$(GREEN)Stack detenido.$(RESET)"

seed: ## Crea el primer merchant y muestra las API keys
	@echo "$(CYAN)Creando merchant inicial...$(RESET)"
	@docker compose exec api node packages/api/dist/scripts/seed.js
	@echo ""
	@echo "$(GREEN)Merchant creado. Guarda las API keys mostradas arriba.$(RESET)"

logs: ## Muestra logs de todos los servicios (Ctrl+C para salir)
	@docker compose logs -f

logs-api: ## Logs solo del API
	@docker compose logs -f api

logs-node: ## Logs solo del nodo
	@docker compose logs -f node

logs-db: ## Logs de PostgreSQL
	@docker compose logs -f postgres

restart: ## Reinicia todos los servicios
	@echo "$(YELLOW)Reiniciando...$(RESET)"
	@docker compose restart
	@echo "$(GREEN)Reiniciado.$(RESET)"

restart-api: ## Reinicia solo el API
	@docker compose restart api

restart-node: ## Reinicia solo el nodo
	@docker compose restart node

status: ## Muestra el estado de todos los servicios
	@echo "$(CYAN)Estado de los servicios:$(RESET)"
	@docker compose ps
	@echo ""
	@echo "$(CYAN)Health checks:$(RESET)"
	@curl -s http://localhost:3000/health | python3 -m json.tool 2>/dev/null || echo "  API: no disponible"
	@curl -s http://localhost:4000/health | python3 -m json.tool 2>/dev/null || echo "  Node: no disponible"

clean: ## Elimina volúmenes y empieza desde cero (¡BORRA DATOS!)
	@echo "$(YELLOW)⚠️  Esto eliminará todos los datos. ¿Continuar? [y/N]$(RESET)"
	@read -r confirm && [ "$$confirm" = "y" ] || exit 1
	@docker compose down -v
	@echo "$(GREEN)Limpio. Corre 'make up && make seed' para empezar de nuevo.$(RESET)"

# ── Desarrollo local ──────────────────────────────────────────

dev-api: ## Corre el API en modo watch (desarrollo)
	@pnpm --filter @openrelay/api dev

dev-node: ## Corre el nodo en modo watch (desarrollo)
	@pnpm --filter @openrelay/node dev

build: ## Construye todos los paquetes
	@pnpm build

test: ## Corre todos los tests TypeScript
	@pnpm test

typecheck: ## Verifica tipos TypeScript en todos los paquetes
	@pnpm typecheck

lint: ## Corre Biome (linter + formatter)
	@pnpm biome check .

# ── Contratos Solidity ────────────────────────────────────────

contracts-build: ## Compila los contratos Solidity
	@cd packages/contracts && forge build

contracts-test: ## Corre los tests Foundry (con output verbose)
	@cd packages/contracts && forge test -vvv

contracts-test-fuzz: ## Corre los tests con más runs de fuzz
	@cd packages/contracts && forge test --fuzz-runs 10000

contracts-fmt: ## Formatea el código Solidity
	@cd packages/contracts && forge fmt

contracts: contracts-build contracts-test ## Build + test de contratos

# ── Deploy & verificación (Base Sepolia) ──────────────────────

check-deploy-env: ## Verifica que el .env tenga todas las vars para deploy
	@test -n "$$DEPLOYER_PRIVATE_KEY" || (echo "$(YELLOW)Error: DEPLOYER_PRIVATE_KEY no está definido$(RESET)" && exit 1)
	@test -n "$$BASE_SEPOLIA_RPC_URL" || (echo "$(YELLOW)Error: BASE_SEPOLIA_RPC_URL no está definido$(RESET)" && exit 1)
	@test -n "$$USDC_ADDRESS" || (echo "$(YELLOW)Error: USDC_ADDRESS no está definido$(RESET)" && exit 1)
	@test -n "$$TREASURY_ADDRESS" || (echo "$(YELLOW)Error: TREASURY_ADDRESS no está definido$(RESET)" && exit 1)
	@test -n "$$ARBITER_1" || (echo "$(YELLOW)Error: ARBITER_1 no está definido$(RESET)" && exit 1)
	@test -n "$$ARBITER_2" || (echo "$(YELLOW)Error: ARBITER_2 no está definido$(RESET)" && exit 1)
	@test -n "$$ARBITER_3" || (echo "$(YELLOW)Error: ARBITER_3 no está definido$(RESET)" && exit 1)
	@echo "$(GREEN)Todas las variables de deploy están configuradas.$(RESET)"

check-sepolia-balance: ## Verifica que el deployer tenga Sepolia ETH suficiente
	@echo "$(CYAN)Verificando balance del deployer...$(RESET)"
	@cd packages/contracts && forge script script/Deploy.s.sol --rpc-url $$BASE_SEPOLIA_RPC_URL --private-key $$DEPLOYER_PRIVATE_KEY --dry-run 2>&1 | grep -E "gas|balance" || echo "Balance check requires full dry-run — usa 'cast balance <addr> --rpc-url \$$BASE_SEPOLIA_RPC_URL'"

deploy-sepolia: check-deploy-env ## Deploy contratos a Base Sepolia (con verify si BASESCAN_API_KEY está seteado)
	@echo "$(CYAN)Desplegando contratos en Base Sepolia...$(RESET)"
	@if [ -n "$$BASESCAN_API_KEY" ]; then \
		cd packages/contracts && forge script script/Deploy.s.sol \
			--rpc-url $$BASE_SEPOLIA_RPC_URL \
			--private-key $$DEPLOYER_PRIVATE_KEY \
			--broadcast \
			--verify \
			--etherscan-api-key $$BASESCAN_API_KEY; \
	else \
		echo "$(YELLOW)⚠️  BASESCAN_API_KEY no seteado — deploy sin verificación$(RESET)"; \
		cd packages/contracts && forge script script/Deploy.s.sol \
			--rpc-url $$BASE_SEPOLIA_RPC_URL \
			--private-key $$DEPLOYER_PRIVATE_KEY \
			--broadcast; \
	fi
	@echo ""
	@echo "$(GREEN)✓ Deploy completo.$(RESET)"
	@echo "$(CYAN)→ Copia las direcciones de arriba a tu .env$(RESET)"
	@echo "$(CYAN)→ Corre 'make deploy-addresses' para verlas después$(RESET)"

deploy-addresses: ## Muestra las direcciones del último deploy en Base Sepolia
	@echo "$(CYAN)Direcciones del último deploy en Base Sepolia (chain 84532):$(RESET)"
	@cat packages/contracts/broadcast/Deploy.s.sol/84532/run-latest.json 2>/dev/null | \
		python3 -c "import json,sys; data=json.load(sys.stdin); [print(f\"  {t['contractName']:20s} {t['contractAddress']}\") for t in data.get('transactions',[]) if t.get('contractName')]" \
		|| echo "$(YELLOW)No se encontró deploy previo. Corre 'make deploy-sepolia' primero.$(RESET)"

verify-sepolia: ## Verifica manualmente los contratos en Basescan (si el deploy no los verificó)
	@test -n "$$BASESCAN_API_KEY" || (echo "$(YELLOW)Error: BASESCAN_API_KEY no está definido$(RESET)" && exit 1)
	@test -n "$$STAKE_MANAGER_ADDRESS" || (echo "$(YELLOW)Error: STAKE_MANAGER_ADDRESS no está definido en .env$(RESET)" && exit 1)
	@test -n "$$DISPUTE_RESOLVER_ADDRESS" || (echo "$(YELLOW)Error: DISPUTE_RESOLVER_ADDRESS no está definido en .env$(RESET)" && exit 1)
	@test -n "$$NODE_REGISTRY_ADDRESS" || (echo "$(YELLOW)Error: NODE_REGISTRY_ADDRESS no está definido en .env$(RESET)" && exit 1)
	@echo "$(CYAN)Verificando StakeManager...$(RESET)"
	@cd packages/contracts && forge verify-contract $$STAKE_MANAGER_ADDRESS src/StakeManager.sol:StakeManager --chain base-sepolia --etherscan-api-key $$BASESCAN_API_KEY
	@echo "$(CYAN)Verificando DisputeResolver...$(RESET)"
	@cd packages/contracts && forge verify-contract $$DISPUTE_RESOLVER_ADDRESS src/DisputeResolver.sol:DisputeResolver --chain base-sepolia --etherscan-api-key $$BASESCAN_API_KEY
	@echo "$(CYAN)Verificando NodeRegistry...$(RESET)"
	@cd packages/contracts && forge verify-contract $$NODE_REGISTRY_ADDRESS src/NodeRegistry.sol:NodeRegistry --chain base-sepolia --etherscan-api-key $$BASESCAN_API_KEY
	@echo "$(GREEN)✓ Verificación completa.$(RESET)"

# ── Setup inicial ─────────────────────────────────────────────

setup: ## Primera configuración (instala deps, copia .env.example)
	@echo "$(CYAN)Configurando OpenRelay por primera vez...$(RESET)"
	@test -f .env || (cp .env.example .env && echo "$(GREEN).env creado desde .env.example$(RESET)")
	@pnpm install
	@echo ""
	@echo "$(GREEN)Setup completo.$(RESET)"
	@echo ""
	@echo "Próximos pasos:"
	@echo "  1. Edita $(YELLOW).env$(RESET) con tus variables"
	@echo "  2. Corre $(YELLOW)make up$(RESET)"
	@echo "  3. Corre $(YELLOW)make seed$(RESET)"
