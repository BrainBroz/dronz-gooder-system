import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const database = "dronz_gooder_flow_test";
const defaultUrl = `postgresql://postgres:postgres@localhost:5432/${database}?schema=public`;

function flowDatabase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL de ensaio inválida; nenhum banco foi acessado.");
  }
  // O seed redefine o admin: este comando só pode usar o banco local exclusivo de ensaio.
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== `/${database}` ||
    url.hash ||
    [...url.searchParams].some(
      ([key, value]) => key !== "schema" || value !== "public"
    )
  ) {
    throw new Error(
      `Ensaio recusado: use somente PostgreSQL local no banco ${database}, schema public.`
    );
  }
  return url;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    assert.equal(flowDatabase(defaultUrl).pathname, `/${database}`);
    assert.equal(
      flowDatabase(defaultUrl.replace("localhost", "127.0.0.1")).hostname,
      "127.0.0.1"
    );
    for (const raw of [
      "inválida",
      defaultUrl.replace(database, "dronz_gooder"),
      defaultUrl.replace("localhost", "example.com"),
      defaultUrl.replace("schema=public", "schema=outro"),
      `${defaultUrl}&host=example.com`,
      `${defaultUrl}#fragmento`
    ])
      assert.throws(() => flowDatabase(raw));
    console.log(
      "Proteções do ensaio: banco operacional, host remoto e parâmetros indevidos recusados."
    );
    return;
  }
  if (process.versions.node.split(".")[0] !== "22")
    throw new Error("Use Node 22 para executar o ensaio.");

  const url = flowDatabase(process.env.FLOW_TEST_DATABASE_URL ?? defaultUrl);
  const pgEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))
    ),
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username) || "postgres",
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "5"
  };
  const probe = spawnSync(
    "psql",
    [
      "--no-psqlrc",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `SELECT 1 FROM pg_database WHERE datname = '${database}'`
    ],
    { env: pgEnv, encoding: "utf8", timeout: 10000 }
  );
  if (probe.status !== 0)
    throw new Error(
      "Não foi possível consultar PostgreSQL local. Verifique o serviço, o cliente psql e o acesso ao banco de ensaio."
    );
  if (probe.stdout.trim() !== "1") {
    const created = spawnSync("createdb", [database], {
      env: pgEnv,
      stdio: "inherit"
    });
    if (created.status !== 0)
      throw new Error("Não foi possível criar o banco exclusivo de ensaio.");
  }

  console.log(
    `ENSAIO SINTÉTICO — banco ${database}; sem contas, tokens ou compras reais.`
  );
  console.log(
    "Etapas: evidências API/e-mail → revisão humana → split/materialização → checkpoints/estoque → venda/recebimentos → indicadores; tracking manual e transporte eBay simulado."
  );
  const result = spawnSync(
    "npm",
    [
      "run",
      "test",
      "--workspace",
      "@dronz-gooder/api",
      "--",
      "--reporter=verbose",
      "test/ebay-buyer-adapter.test.ts",
      "test/marketplace-integrations.integration.test.ts",
      "test/unified-purchases.integration.test.ts",
      "test/inventory.integration.test.ts",
      "test/sales.integration.test.ts",
      "test/analytics-indicators.integration.test.ts",
      "test/tracking.integration.test.ts"
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: url.href,
        DATABASE_TEST_URL: url.href,
        SEED_ADMIN_NAME: "Flow Test Admin",
        SEED_ADMIN_EMAIL: "admin@example.com",
        SEED_ADMIN_PASSWORD: "change-me",
        MARKETPLACE_EBAY_BUYER_ENABLED: "false"
      }
    }
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else
    console.log(
      "Ensaio concluído. Integrações reais e conferência visual NÃO foram homologadas; nenhum banco operacional foi utilizado."
    );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
