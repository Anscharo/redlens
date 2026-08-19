import { waitForDeployment } from "./health";

export default async function globalSetup(): Promise<void> {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error("BASE_URL is required (for example BASE_URL=http://localhost:3000 pnpm test:e2e)");
  }

  const expectedCommit = process.env.EXPECTED_APP_COMMIT || undefined;
  const health = await waitForDeployment({ baseUrl, expectedCommit });
  console.log(
    `E2E target ready: app=${health.app_commit ?? "unchecked"} atlas=${health.atlas_sha} docs=${health.docs}`,
  );
}
