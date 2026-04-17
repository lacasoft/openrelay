# Contribuir a OpenRelay

OpenRelay está construido para la comunidad hispanohablante de desarrolladores y para el ecosistema global de código abierto por igual. **Las contribuciones en inglés también son bienvenidas como ciudadanos de primera clase junto a las contribuciones en español.** Los issues, PRs, documentación y discusiones de la comunidad pueden ser en cualquiera de los dos idiomas.

---

## Por qué contribuir ahora

La ventana para construir infraestructura de pagos propiedad de la comunidad antes de que se definan los estándares institucionales no se mide en años. Se mide en meses.

En abril de 2026, BlackRock entró al gobierno federal de México vinculado a la transición obligatoria de México hacia los pagos digitales. CoinShares se listó en Nasdaq esa misma semana. El posicionamiento institucional está ocurriendo ahora. OpenRelay es la respuesta técnica — y necesita colaboradores ahora, no después de que los estándares estén definidos.

Un nodo que ejecutes hoy en Ciudad de México o Madrid es infraestructura que ninguna institución controla. El código que entregues hoy es la base sobre la que operarán comercios reales en 2026.

---

## Formas de contribuir

**Escribir código** — bugs, funcionalidades, SDKs, plugins. Revisa los issues abiertos etiquetados como `good first issue` o `help wanted`.

**Operar un nodo** — haz crecer la red y gana comisiones de enrutamiento en USDC. Cada nodo comunitario en LATAM o España importa. Consulta [INFRASTRUCTURE.md](./INFRASTRUCTURE.md#13-node-operation-guide).

**Escribir documentación** — en español, inglés o portugués. La persona desarrolladora que no puede leer la documentación no puede usar el protocolo.

**Revisar y auditar** — los smart contracts necesitan ojos. Más revisores significa mejor seguridad. El análisis económico y lógico de los contratos es tan valioso como la experiencia en Solidity.

**Plugins de WooCommerce / Shopify** — el camino más rápido hacia la adopción por parte de comercios en México. Contribución de alto impacto para la Fase 2 si tienes experiencia en PHP.

**Integración SPEI / Oxxo Pay** — la rampa de entrada que desbloquea el 80% de las transacciones mexicanas que todavía se hacen en efectivo. Crítico si tienes experiencia con APIs fintech mexicanas.

**Correr la voz** — en comunidades de desarrolladores de LATAM (CDMX Dev, Wizeline, La Maquinista), el Twitter tech en español, YouTube en español. OpenRelay existe solo si la comunidad de desarrolladores lo conoce.

---

## Configuración de desarrollo

**Requisitos:** Node.js >= 20, pnpm >= 9, Foundry (`curl -L https://foundry.paradigm.xyz | bash`)

```bash
git clone https://github.com/lacasoft/openrelay
cd openrelay
pnpm install
cp .env.example .env
pnpm build
pnpm test
```

**Ejecución local**

```bash
docker compose -f infra/docker/docker-compose.yml up   # stack completo
pnpm --filter @openrelay/api dev                        # API en modo watch
pnpm --filter @openrelay/node dev                       # nodo en modo watch
cd packages/contracts && forge test -vvv                # tests de Solidity
```

---

## Hacer cambios

1. Haz fork del repositorio
2. Crea una branch: `git checkout -b feat/tu-funcionalidad` o `fix/tu-bug`
3. Realiza tus cambios
4. Ejecuta `pnpm test` y `pnpm typecheck` — ambos deben pasar
5. Ejecuta `pnpm biome check .` — debe pasar sin violaciones
6. Haz commit con un mensaje claro:

```
feat(sdk): add x402 middleware for Next.js
fix(routing): handle node rejection correctly
feat(sdk): agregar soporte para middleware de Fastify
fix(api): corregir manejo de errores en webhooks
```

Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

---

## Cambios en smart contracts

- Todos los cambios deben incluir tests en `packages/contracts/test/`
- Ejecuta `forge test -vvv` y `forge fmt --check` antes de abrir un PR
- Cualquier cambio de interfaz requiere un RFC primero
- Sin patrones de actualizabilidad, patrones de proxy o llaves de admin — no negociable
- Los cambios relevantes para la seguridad requieren revisión de al menos dos maintainers

---

## Cambios en el protocolo (proceso RFC)

1. Abre un issue en GitHub con la etiqueta `RFC`
2. Periodo de discusión: mínimo 7 días
3. Si se alcanza consenso, abre un PR actualizando `PROTOCOL.md` y el código afectado
4. Los cambios en interfaces de smart contracts requieren una auditoría independiente antes de mainnet

---

## Estilo de código

[Biome](https://biomejs.dev/) para linting y formateo. Nada de `any` sin un comentario. Zod para todas las entradas externas. JSDoc con `@example` en todas las funciones exportadas.

---

## Vulnerabilidades de seguridad

**security@openrelay.dev** — divulgación responsable, recompensas por hallazgos críticos, acuse de recibo en 48 horas.

No abras issues públicos para vulnerabilidades de seguridad.

---

## Licencia

Al contribuir, aceptas que tus contribuciones serán licenciadas bajo la Apache License 2.0.

---

*If you have questions in English, feel free to open an issue in English or reach out to the team on Discord. The English-speaking community is a fundamental part of this project, not an afterthought.*
