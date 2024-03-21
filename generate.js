const helpers = require("./src/helpers");
const path = require("path");
const fs = require("fs");
const { reflectHLSLShaders } = require("./src/reflect-hlsl");

helpers.mainWrapper(async (args) => {
  const version = args[0];
  const namespace = args[1];
  const srcDir = args[2];
  const outDir = args[3];

  const files = [];
  for (const file of fs.readdirSync(srcDir)) {
    files.push(path.join(srcDir, file));
  }

  const { shaderInfos, typesFile } = await reflectHLSLShaders(
    files,
    version,
    namespace
  );
  await helpers.writeFileStr(path.join(outDir, "shader-types.hpp"), typesFile);
});
