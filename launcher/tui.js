#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const NODE_MODULES_DIR = path.join(ROOT, "node_modules");
const SERVER_ENTRY = path.join(ROOT, "server.js");

const runningChildren = [];

function printBanner() {
    console.clear();
    console.log("=====================================");
    console.log("         Boat Game Launcher");
    console.log("=====================================");
    console.log("");
}

function question(rl, prompt) {
    return new Promise((resolve) => rl.question(prompt, resolve));
}

function openUrl(url) {
    const command =
        process.platform === "win32"
            ? "start"
            : process.platform === "darwin"
                ? "open"
                : "xdg-open";
    const args =
        process.platform === "win32"
            ? ["/c", "start", "", url]
            : [url];
    const bin = process.platform === "win32" ? "cmd" : command;

    const opener = spawn(bin, args, {
        cwd: ROOT,
        stdio: "ignore",
        detached: true
    });
    opener.unref();
}

function pipePrefixed(stream, label, isError = false) {
    const writer = isError ? process.stderr : process.stdout;
    let buffer = "";

    stream.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        lines.forEach((line) => {
            if (!line.trim()) return;
            writer.write(`[${label}] ${line}\n`);
        });
    });

    stream.on("end", () => {
        if (buffer.trim()) {
            writer.write(`[${label}] ${buffer}\n`);
        }
    });
}

function spawnNode(scriptPath, scriptArgs, label) {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
        cwd: ROOT,
        env: process.env,
        // In Windows batch-launched terminals, inheriting stdin can throw spawn EINVAL.
        stdio: ["ignore", "pipe", "pipe"]
    });

    pipePrefixed(child.stdout, label);
    pipePrefixed(child.stderr, label, true);

    runningChildren.push(child);
    return child;
}

function runNpmBlocking(args, label) {
    return new Promise((resolve, reject) => {
        const command = process.platform === "win32" ? "npm.cmd" : "npm";
        const child = spawn(command, args, {
            cwd: ROOT,
            env: process.env,
            // Keep output visible, but don't inherit stdin on Windows launcher consoles.
            stdio: ["ignore", "inherit", "inherit"]
        });

        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${label} failed with code ${code}`));
        });
    });
}

function hasModule(moduleName) {
    try {
        require.resolve(moduleName, { paths: [ROOT] });
        return true;
    } catch {
        return false;
    }
}

async function ensureBaseDependencies() {
    if (
        fs.existsSync(NODE_MODULES_DIR) &&
        hasModule("express") &&
        hasModule("socket.io")
    ) {
        return;
    }

    console.log("First run setup: installing dependencies...");
    await runNpmBlocking(["install"], "npm install");
}

function getLocalTunnelEntry() {
    try {
        return require.resolve("localtunnel/bin/lt", { paths: [ROOT] });
    } catch {
        return null;
    }
}

function watchForExit(child, label) {
    child.on("exit", (code, signal) => {
        if (signal) {
            console.log(`[${label}] stopped (${signal})`);
            return;
        }
        if (code !== 0) {
            console.log(`[${label}] exited with code ${code}`);
        }
    });
}

function stopAllChildren() {
    runningChildren.forEach((child) => {
        if (!child || child.killed) return;
        child.kill("SIGTERM");
    });
}

function registerShutdownHandlers() {
    const shutdown = () => {
        stopAllChildren();
        setTimeout(() => process.exit(0), 200);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("exit", stopAllChildren);
}

async function startLocalOnly() {
    console.log("Starting server...");
    const server = spawnNode(SERVER_ENTRY, [], "server");
    watchForExit(server, "server");

    setTimeout(() => {
        openUrl("http://127.0.0.1:3000");
        console.log("Opened http://127.0.0.1:3000 in your browser.");
    }, 1500);
}

async function startWithTunnel() {
    console.log("Starting server and LocalTunnel...");

    const tunnelEntry = getLocalTunnelEntry();
    if (!tunnelEntry) {
        console.log("LocalTunnel is not installed in this copy yet.");
        console.log("Starting local play only.");
        console.log("If you're running from source, run `npm install` once to enable online sharing.");
        await startLocalOnly();
        return;
    }

    const server = spawnNode(SERVER_ENTRY, [], "server");
    watchForExit(server, "server");

    const tunnel = spawnNode(
        tunnelEntry,
        ["--port", "3000", "--local-host", "127.0.0.1"],
        "tunnel"
    );
    watchForExit(tunnel, "tunnel");

    tunnel.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        const match = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/i);
        if (match) {
            const url = match[0];
            console.log(`\nShare URL: ${url}`);
            console.log("LocalTunnel may show an IP confirmation page first.");
            openUrl(url);
        }
    });

    setTimeout(() => {
        openUrl("http://127.0.0.1:3000");
    }, 1500);
}

async function main() {
    registerShutdownHandlers();
    printBanner();

    if (typeof process.versions.node !== "string") {
        console.error("Node.js is required to run this launcher.");
        process.exit(1);
    }

    await ensureBaseDependencies();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log("1) Start game locally");
    console.log("2) Start game + online share (LocalTunnel)");
    console.log("3) Exit");
    console.log("");

    const choice = (await question(rl, "Choose an option (1-3): ")).trim();
    rl.close();

    if (choice === "1") {
        await startLocalOnly();
    } else if (choice === "2") {
        await startWithTunnel();
    } else {
        process.exit(0);
    }

    console.log("\nLauncher is running. Press Ctrl+C to stop.");
}

main().catch((err) => {
    console.error(`Launcher error: ${err.message}`);
    process.exit(1);
});
