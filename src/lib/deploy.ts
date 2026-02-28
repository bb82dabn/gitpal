/**
 * Auto-deploy logic — called after gp push succeeds.
 * Detects if the project has Docker and rebuilds/restarts changed services.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DeployResult {
  ran: boolean;
  success: boolean;
  message: string;
}

export function hasDeployTarget(dir: string): boolean {
  return (
    existsSync(join(dir, "docker-compose.yml")) ||
    existsSync(join(dir, "docker-compose.yaml")) ||
    existsSync(join(dir, "deploy.sh"))
  );
}

/** Which services in the compose file have a `build:` section (i.e. need rebuild) */
function getBuildableServices(dir: string): string[] {
  const composePath = join(dir, "docker-compose.yml") || join(dir, "docker-compose.yaml");
  if (!existsSync(composePath)) return [];
  try {
    const content = readFileSync(composePath, "utf8");
    // Find service blocks that contain a "build:" key
    const servicePattern = /^  (\w[\w-]+):\n(?:.*\n)*?.*build:/gm;
    const matches = content.matchAll(servicePattern);
    return Array.from(matches).map(m => m[1]!);
  } catch { return []; }
}

export async function runDeploy(dir: string): Promise<DeployResult> {
  // Prefer custom deploy.sh if it exists
  if (existsSync(join(dir, "deploy.sh"))) {
    const r = await Bun.$`bash ${join(dir, "deploy.sh")}`.cwd(dir).nothrow();
    return {
      ran: true,
      success: r.exitCode === 0,
      message: r.exitCode === 0 ? "deploy.sh ran successfully" : `deploy.sh failed (exit ${r.exitCode})`,
    };
  }

  // Docker compose: rebuild buildable services, then restart all
  const composePath = existsSync(join(dir, "docker-compose.yml"))
    ? join(dir, "docker-compose.yml")
    : join(dir, "docker-compose.yaml");

  if (!existsSync(composePath)) {
    return { ran: false, success: false, message: "No deploy target found" };
  }

  const buildable = getBuildableServices(dir);

  if (buildable.length > 0) {
    // Build changed services
    const build = await Bun.$`docker compose build ${buildable}`.cwd(dir).nothrow();
    if (build.exitCode !== 0) {
      return { ran: true, success: false, message: `docker compose build failed:\n${build.stderr.toString().slice(0, 300)}` };
    }
  }

  // Restart (up -d applies changes without rebuilding what didn't change)
  const up = await Bun.$`docker compose up -d`.cwd(dir).nothrow();
  if (up.exitCode !== 0) {
    return { ran: true, success: false, message: `docker compose up -d failed:\n${up.stderr.toString().slice(0, 300)}` };
  }

  const serviceList = buildable.length > 0 ? `rebuilt + restarted: ${buildable.join(", ")}` : "restarted all services";
  return { ran: true, success: true, message: serviceList };
}
