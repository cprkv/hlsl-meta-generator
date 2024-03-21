const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { pLimit } = require("../deps/plimit");
const fsp = fs.promises;

const cleanupFiles = [];

function cleanup() {
  for (const file of cleanupFiles) {
    if (fs.existsSync(file)) {
      // console.log(`removing tmp file: ${file}`);
      for (let i = 0; i < 3; i++) {
        try {
          fs.unlinkSync(file);
          break;
        } catch (err) {
          console.error(`try unlink#${i + 1} ${file}: ${err.toString()}`);
        }
      }
    }
  }
}

function formatBytes(bytes, codeColumns = 16, codeIndent = 2) {
  const lines = [];
  for (let i = 0; i < bytes.length; i++) {
    const lineIdx = Math.floor(i / codeColumns);
    if (lines.length == lineIdx) {
      lines.push("");
    }
    lines[lineIdx] += bytes[i] + ", ";
  }
  const indent = Array(codeIndent).fill(" ").join("");
  return lines.map((x) => indent + x.trim()).join("\n");
}

function resolveTool({ name, isOptional }) {
  const binName = process.platform == "win32" ? name + ".exe" : name;
  const toolsDirs = [path.join(__dirname, "..", "bin")];

  if (process.env.VULKAN_SDK) {
    const vulkanBin = path.join(process.env.VULKAN_SDK, "Bin");
    if (fs.existsSync(vulkanBin)) {
      toolsDirs.push(vulkanBin);
    } else {
      console.warn(
        `VULKAN_SDK environment variable is set but not contains Bin path...`
      );
    }
  } else {
    console.warn(`VULKAN_SDK environment variable not set`);
  }

  for (const toolDir of toolsDirs) {
    const p = path.join(toolDir, binName);
    if (fs.existsSync(p)) {
      // console.log(`found suitable tool ${p}`);
      return p;
    }
  }

  if (isOptional) {
    return null;
  }

  throw new Error(
    `vulkan tool ${name} not found! please install vulkan sdk or check environment variable VULKAN_SDK to be correct path!`
  );
}

function tmpFile(ext) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();
  const dd = now.getDate();
  const rand = (Math.random() * 0x100000000 + 1).toString(36);
  const name = `${yyyy}${mm}${dd}-${process.pid}-${rand}${ext}`;
  const filepath = path.join(os.tmpdir(), name);
  cleanupFiles.push(filepath);
  return filepath;
}

const spawnChildProcess = (exe, args) =>
  new Promise((resolve, reject) => {
    console.log(`spawning ${exe} ${args.join(" ")}`);
    const proc = childProcess.spawn(exe, args);
    proc.on("error", (err) => {
      reject(`failed to start subprocess: ${err}`);
    });
    const output = [];
    if (proc.stdout) {
      proc.stdout.on("data", (data) => output.push(data));
    }
    if (proc.stderr) {
      proc.stderr.on("data", (data) => output.push(data));
    }
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `process ${exe} exited with code ${code}\noutput was: ${output.join(
              "\n"
            )}`
          )
        );
      } else {
        // console.log(`process ${exe} exit ok!`);
        resolve(output);
      }
    });
  });

async function readAsText(filepath) {
  return fsp.readFile(filepath, "utf-8");
}

async function readAsCppBytesArray(filepath) {
  const buf = await fsp.readFile(filepath);
  const res = [];
  for (let i = 0; i < buf.length; i++) {
    res.push("0x" + buf.slice(i, i + 1).toString("hex"));
  }
  return res;
}

async function writeFileStr(filepath, str) {
  await fsp.writeFile(filepath, str, "utf-8");
}

async function writeFileJson(filepath, obj) {
  await writeFileStr(filepath, JSON.stringify(obj, null, 2));
}

async function readAsJson(filepath) {
  const buf = await fsp.readFile(filepath, "utf-8");
  return JSON.parse(buf);
}

function filenameToIdentifier(fileName) {
  const base = path.basename(fileName);
  const name = base.substring(0, base.lastIndexOf("."));
  return name.replace(/[^0-9a-zA-Z_]/g, "_");
}

function mainWrapper(func) {
  const args = process.argv.slice(2);
  func(args)
    .then(() => {
      cleanup();
      process.exit(0);
    })
    .catch((err) => {
      cleanup();
      console.error(err);
      process.exit(1);
    });
}

async function writeShaders(shaders, dir, type, namespace) {
  const definitions = [];

  namespace = namespace || `shaders::${type}`

  for (const shader of shaders) {
    const { identifier, bytes } = shader;
    const formatted = formatBytes(bytes);

    definitions.push({
      header: `  extern uint8_t* g_${identifier};
  extern uint32_t g_${identifier}_size;`,
      impl: `uint8_t g_${identifier}_impl[ ${bytes.length} ] = {
${formatted}
};

uint8_t* ${namespace}::g_${identifier}      = g_${identifier}_impl;
uint32_t ${namespace}::g_${identifier}_size = ${bytes.length};
`,
    });
  }

  await writeFileStr(
    path.join(dir, "shaders.hpp"),
    `#pragma once
#include <cstdint>

namespace ${namespace} {
${definitions.map(({ header }) => header).join("\n")}
}
`
  );
  await writeFileStr(
    path.join(dir, "shaders.cpp"),
    `#include \"shaders.hpp\"

${definitions.map(({ impl }) => impl).join("\n\n")}
`
  );
}

function withLimitNumCpu(jobs) {
  const limit = pLimit(os.cpus().length);
  const promises = jobs.map((job) => limit(job));
  return Promise.all(promises);
}

async function fileExists(p) {
  await fsp.stat(p);
  return p;
}

async function findProgram(program) {
  if (!program.endsWith(".exe")) {
    program += ".exe";
  }
  const PATH = process.env.path
    .split(";")
    .filter((x) => x)
    .map((p) => path.join(p, program));
  const task = await Promise.allSettled(PATH.map(fileExists));
  const paths = task
    .filter((x) => x.status === "fulfilled")
    .map((x) => x.value);
  if (!paths.length) {
    return null;
  }
  return paths[0];
}

module.exports = {
  cleanup,
  tmpFile,
  resolveTool,
  spawnChildProcess,
  readAsCppBytesArray,
  readAsJson,
  readAsText,
  mainWrapper,
  writeFileStr,
  writeFileJson,
  filenameToIdentifier,
  withLimitNumCpu,
  writeShaders,
  formatBytes,
  findProgram,
};
