const helpers = require("./helpers");
const path = require("path");

const hlslShaderReflector = helpers.resolveTool({
  name: "hlsl-shader-reflector",
});

module.exports = { reflectHLSLShader, embedDXTypes, reflectHLSLShaders };

async function reflectHLSLShaders(files, version, namespace) {
  let shaderInfos = await helpers.withLimitNumCpu(
    files.map((inputPath) => async () => {
      const reflected = await reflectHLSLShader(inputPath, version);
      if (!reflected) {
        return null;
      }
      const { profile, identifier, shaderTypes } = reflected;
      return { inputPath, version, profile, identifier, shaderTypes };
    })
  );

  shaderInfos = shaderInfos.filter((x) => x);

  const types = embedDXTypes(
    shaderInfos
      .map((x) => x.shaderTypes)
      .join("\n")
      .split("\n")
      .map((x) => `  ${x}`)
      .join("\n")
  );
  const typesFile = `#pragma once

#if __has_include("shader-types-pre.hpp")
  #include "shader-types-pre.hpp"
#endif

namespace ${namespace} {
${types}
}
`;

  if (shaderInfos.some((x) => !x)) {
    throw new Error("some of shader infos is null");
  }

  return { shaderInfos, typesFile };
}

async function reflectHLSLShader(inputPath, version) {
  const profile = versionToProfile(inputPath, version);
  if (!profile) {
    return null;
  }

  const identifier = helpers.filenameToIdentifier(inputPath);
  const shaderReflection = await getShaderReflection(inputPath, profile);
  // helpers.writeFileJson(
  //   path.join(inputPath, "..", identifier + ".json"),
  //   shaderReflection
  // );
  const typeContainer = toTypeContainer(shaderReflection);
  const shaderTypes = typeContainer.dump();
  await checkShader(inputPath, shaderTypes, typeContainer.dumpChecks());

  return { profile, identifier, shaderTypes };
}

function embedDXTypes(src) {
  return `
    #pragma pack(push)
    #pragma pack(16)

    #ifndef DIRECTX_TYPE_INTRO
    #define DIRECTX_TYPE_INTRO
      using dword = unsigned int;
      struct float2 { float x; float y; };
      struct float3 { float x; float y; float z; };
      struct float4 { float x; float y; float z; float w; };

      struct float2x2 { float2 x; float2 _pad; float2 y; };
      struct float3x3 { float3 x; float _pad1; float3 y; float _pad2; float3 z; };
      struct float4x4 { float m[4][4]; };
    #endif

    #ifndef DIRECTX_TYPE_CHECKS
    #define DIRECTX_TYPE_CHECKS
      static_assert(sizeof(dword) == 4, "directx structure size should match");
      static_assert(sizeof(float2) == 8, "directx structure size should match");
      static_assert(sizeof(float3) == 12, "directx structure size should match");
      static_assert(sizeof(float4) == 16, "directx structure size should match");

      static_assert(sizeof(float2x2) == 24, "directx structure size should match");
      static_assert(sizeof(float3x3) == 44, "directx structure size should match");
      static_assert(sizeof(float4x4) == 64, "directx structure size should match");
    #endif

    ${src}
    #pragma pack(pop)
  `;
}

async function getShaderReflection(filePath, profile) {
  const tmpOutput = helpers.tmpFile(".json");
  await helpers.spawnChildProcess(hlslShaderReflector, [
    "-i",
    filePath,
    "-o",
    tmpOutput,
    "-p",
    profile,
  ]);
  return await helpers.readAsJson(tmpOutput);
}

function versionToProfile(inputPath, version) {
  const splitPath = inputPath.split(".");

  if (splitPath.length < 3 || splitPath[splitPath.length - 1] != "hlsl") {
    //throw new Error(
    //  `invalid path '${inputPath}'. should be like 'some-shader.vs.hlsl'`
    //);
    return null;
  }

  const profile_version = version.replace(".", "_");
  const profile_name = splitPath[splitPath.length - 2];
  return `${profile_name}_${profile_version}`;
}

async function compileAndRunCppProgram(source) {
  const cppFile = helpers.tmpFile(".cpp");
  const objFile = helpers.tmpFile(".obj");
  const exeFile = helpers.tmpFile(".exe");
  await helpers.writeFileStr(cppFile, source);

  await helpers.spawnChildProcess("cmd.exe", [
    "/c",
    path.join(__dirname, "..", "bin", "cl.bat"),
    "/nologo",
    `/Fe:${exeFile}`,
    `/Fo:${objFile}`,
    cppFile,
  ]);

  const out = await helpers.spawnChildProcess(exeFile, []);
  console.log(out.join(""));
}

async function checkShader(fileName, shaderTypes, shaderChecks) {
  try {
    const checkSource = checkProgramSource(
      embedDXTypes(shaderTypes),
      shaderChecks,
      fileName
    );
    await compileAndRunCppProgram(checkSource);
  } catch (err) {
    console.error(`fail to check shader: ${fileName}`);
    throw err;
  }
}

const makeEnum = (...arr) => [...arr].reduce((p, c) => ({ ...p, [c]: c }), {});

const or0 = (a, b) => (a || a === 0 ? a : b);

const NodeType = makeEnum("VARIABLE", "CONSTANT_BUFFER");

class PlainStruct {
  name = "";
  members = [];
  size = 0;

  constructor(name, size) {
    this.name = name;
    this.size = size;
  }

  addMember({ type, name, size, offset, elements }) {
    this.members.push({ type, name, size, offset, elements });
  }

  dump() {
    const memberStrings = [];

    for (const { type, name, size, offset, elements } of this.members) {
      // const sizeStr = size || size === 0 ? `${size} bytes` : ``;
      // const offsetStr = offset || offset === 0 ? ` offset: ${offset}` : ``;
      // const comment = `  // ${sizeStr} ${offsetStr}`;
      const comment = ``;
      let arraySuffix = "";
      if (elements) {
        arraySuffix = `[${elements}]`;
      }
      memberStrings.push(`  ${type} ${name}${arraySuffix};${comment}`);
    }

    let sizeComment = "";
    // if (this.size || this.size === 0) {
    //   sizeComment = ` // ${this.size} bytes`;
    // }

    return [`struct ${this.name} {${sizeComment}`, ...memberStrings, "};"].join(
      "\n"
    );
  }

  dumpChecks() {
    const assertions = [];

    if (this.size || this.size === 0) {
      assertions.push(`check_eq(sizeof(${this.name}), ${this.size});`);
    }

    for (const { type, name, size, offset } of this.members) {
      if (size || size === 0) {
        assertions.push(`check_eq(sizeof(${this.name}::${name}), ${size});`);
      }
      if (offset || offset == 0) {
        assertions.push(
          `check_eq(offsetof(${this.name}, ${name}), ${offset});`
        );
      }
    }

    return assertions.join("\n");
  }
}

class TypeContainer {
  #types = new Map();

  push(type, depth) {
    if (type.name.includes("::<unnamed>")) {
      throw new Error("unnamed types is not yet supported");
    }
    this.#types.set(type.name, { type, depth });
  }

  has(name) {
    return this.#types.has(name);
  }

  setTypeDepth(name, depth) {
    const typeInfo = this.#types.get(name);
    typeInfo.depth = Math.max(typeInfo.depth, depth);
  }

  dump() {
    const types = [...this.#types.values()];
    return types
      .sort((a, b) => b.depth - a.depth)
      .map(({ type }) => type.dump() + "\n")
      .join("\n");
  }

  dumpChecks() {
    return [...this.#types.values()].map((x) => x.type.dumpChecks()).join("\n");
  }
}

function toTypeContainer(shaderReflection) {
  // console.dir(shader, { depth: 4 });
  const typeContainer = new TypeContainer();
  const typeQueue = shaderReflection.map((node) => ({ node, depth: 0 }));

  while (typeQueue.length) {
    const { node, depth } = typeQueue.shift();
    const currentDepth = depth + 1;
    const name = getTypeName(node);

    if (typeContainer.has(name)) {
      typeContainer.setTypeDepth(name, currentDepth);
      continue;
    }

    if (node.size && node.typeDesc && node.typeDesc.elements) {
      node.size /= node.typeDesc.elements;
    }
    const size = or0(node.size, (node.typeDesc && node.typeDesc.size) || null);
    const struct = new PlainStruct(name, size);

    for (const variable of node.children) {
      struct.addMember({
        type: variable.typeDesc.name,
        name: variable.name,
        size: variable.size,
        offset: or0(variable.startOffset, variable.typeDesc.offset),
        elements: variable.typeDesc.elements,
      });
      if (variable.typeDesc.class == "STRUCT") {
        typeQueue.push({ node: variable, depth: currentDepth });
      }
    }

    typeContainer.push(struct, currentDepth);
  }

  // console.log(typeContainer.dump());
  return typeContainer;
}

function getTypeName(node) {
  return node.nodeType == NodeType.CONSTANT_BUFFER
    ? node.typeName
    : node.typeDesc.name;
}

function checkProgramSource(structs, checks, fileName) {
  fileName = fileName.replace(/\\/g, "/");

  checks = checks
    .split("\n")
    .map((x) => "      " + x)
    .join("\n")
    .trimLeft();

  structs = structs
    .split("\n")
    .map((x) => "    " + x)
    .join("\n")
    .trimLeft();

  return `
    #include <stdio.h>
    #include <stdlib.h>
    #include <stddef.h>

    ${structs}

    bool checks_failed = false;

    #define check_eq(a, b) \\
      if ((a) != (b)) { \\
        printf("\\ncheck "#a" == "#b" failed! (${fileName})\\n"); \\
        printf("  actual:   %u\\n", (unsigned int)(a)); \\
        printf("  expected: %u\\n", (unsigned int)(b)); \\
        checks_failed = true; \\
      } \\

    int main(int, char**) {
      ${checks}
      if (checks_failed) {
        return 1;
      }
      printf("checks for ${fileName} done!");
      return 0;
    }
  `;
}
