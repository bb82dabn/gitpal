import chalk from "chalk";

export const gp = {
  info: (msg: string) => console.log(chalk.cyan("  ●") + "  " + msg),
  success: (msg: string) => console.log(chalk.green("  ✓") + "  " + msg),
  warn: (msg: string) => console.log(chalk.yellow("  ⚠") + "  " + msg),
  error: (msg: string) => console.log(chalk.red("  ✗") + "  " + msg),
  step: (n: number, total: number, msg: string) =>
    console.log(chalk.dim(`  [${n}/${total}]`) + " " + msg),
  header: (title: string) => {
    console.log();
    console.log(chalk.bold.cyan("  " + title));
    console.log(chalk.dim("  " + "─".repeat(title.length + 2)));
  },
  blank: () => console.log(),
  commit: (hash: string, msg: string, when: string) =>
    console.log(
      chalk.dim(`  ${hash}`) + "  " + chalk.white(msg) + "  " + chalk.dim(when)
    ),
  table: (rows: Array<Record<string, string>>, cols: string[]) => {
    const widths = cols.map((col) =>
      Math.max(col.length, ...rows.map((r) => (r[col] ?? "").length))
    );
    const header = cols.map((col, i) => col.padEnd(widths[i] ?? col.length)).join("  ");
    console.log(chalk.bold("  " + header));
    console.log(chalk.dim("  " + widths.map((w) => "─".repeat(w)).join("  ")));
    for (const row of rows) {
      const line = cols.map((col, i) => (row[col] ?? "").padEnd(widths[i] ?? 0)).join("  ");
      console.log("  " + line);
    }
  },
};

export function banner() {
  console.log();
  console.log(chalk.bold.cyan("  GitPal") + chalk.dim(" — git on autopilot"));
  console.log();
}
