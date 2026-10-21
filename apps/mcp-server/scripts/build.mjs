// Bundles the three Lambda handlers with esbuild into infra/.build/<name>/index.mjs.
// The API bundle also carries the statically exported web app (apps/web/out → public/).
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..");
const repo = join(server, "../..");
const outRoot = join(repo, "infra/.build");

rmSync(outRoot, { recursive: true, force: true });
for (const name of ["api", "escalation", "digest"]) {
  const outdir = join(outRoot, name);
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: [join(server, `src/handlers/${name}.ts`)],
    outfile: join(outdir, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    minify: true,
    sourcemap: false,
    // The AWS SDK v3 ships with the Lambda Node.js runtime.
    external: ["@aws-sdk/*"],
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
  writeFileSync(join(outdir, "package.json"), JSON.stringify({ type: "module" }));
  console.log(`built ${name}`);
}

const web = join(repo, "apps/web/out");
if (existsSync(web)) {
  cpSync(web, join(outRoot, "api/public"), { recursive: true });
  console.log("copied web app into api/public");
} else {
  console.warn("apps/web/out not found: run `pnpm --filter @kinloop/web build` first to bundle the dashboard.");
}
