# shader-generator

Uses HLSL shader reflection to generate C++ structure definitions for constant buffers.
Also verifies that constant buffer layout is accurate.

## Usage:

```powershell
$version = "5.0"
$namespace = "render::shaders"
$srcDir = "F:/sh3-tools/prototype/engine-cmake/data/shaders"
$outDir = "F:/sh3-tools/prototype/engine-cmake/core/core/render/shaders"

node ./generate.js $version $namespace $srcDir $outDir
```

## Thirdparty

Scripts doesn't depend on any thirdparty module for manual installation.

Everything it needs already included in this repo.

There is file `plimit.js` which contains 2 node packages contents:

- [p-limit](https://www.npmjs.com/package/p-limit): licensed under MIT license, author: Sindre Sorhus
- [yocto-queue](https://www.npmjs.com/package/yocto-queue): licensed under MIT license, author: Sindre Sorhus
