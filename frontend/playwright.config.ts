import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
const db =
  process.env.E2E_DATABASE ||
  resolve("/tmp", `borrowapp-e2e-${process.pid}.db`);
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["junit", { outputFile: "test-results/results.xml" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [
    {
      command:
        "dotnet run --no-launch-profile --project ../backend/BorrowApp.Api --urls http://127.0.0.1:5080",
      url: "http://127.0.0.1:5080/api/health",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ASPNETCORE_ENVIRONMENT: "Development",
        DatabaseProvider: process.env.E2E_POSTGRES_CONNECTION
          ? "Postgres"
          : "Sqlite",
        ConnectionStrings__Database:
          process.env.E2E_POSTGRES_CONNECTION || `Data Source=${db}`,
        Bootstrap__Email: "admin@example.test",
        Bootstrap__Password: "Test-Only-Password123!",
        Logging__LogLevel__Default: "Warning",
      },
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
});
