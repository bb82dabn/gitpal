export interface RepoCreateOptions {
  name: string;
  description?: string;
  private: boolean;
  dir: string;
}

export async function isGhInstalled(): Promise<boolean> {
  const result = await Bun.$`which gh`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function isGhAuthenticated(): Promise<boolean> {
  const result = await Bun.$`gh auth status`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function ghAuthLogin(): Promise<void> {
  // Interactive — opens browser
  await Bun.$`gh auth login --web -h github.com`;
}

export async function ghRepoCreate(opts: RepoCreateOptions): Promise<string> {
  const visibility = opts.private ? "--private" : "--public";
  const args = [
    "repo", "create", opts.name,
    visibility,
    "--source", opts.dir,
    "--remote", "origin",
    "--push",
  ];
  if (opts.description) {
    args.push("--description", opts.description);
  }
  await Bun.$`gh ${args}`;
  return `https://github.com/${opts.name}`;
}

export async function getGhUsername(): Promise<string> {
  const result = await Bun.$`gh api user --jq .login`.quiet().nothrow();
  if (result.exitCode !== 0) return "";
  return result.stdout.toString().trim();
}
