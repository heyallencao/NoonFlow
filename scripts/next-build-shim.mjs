import Module from 'node:module';
import * as generateBuildIdModule from 'next/dist/build/generate-build-id.js';

delete process.env.TURBOPACK;

const originalLoad = Module._load;
const originalGenerateBuildId = generateBuildIdModule.generateBuildId
  ?? generateBuildIdModule.default?.generateBuildId;

if (typeof originalGenerateBuildId !== 'function') {
  throw new Error('Unable to load Next generateBuildId shim target');
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'next/dist/build/generate-build-id' || request === './generate-build-id') {
    return {
      generateBuildId: async (generate, fallback) =>
        originalGenerateBuildId(
          typeof generate === 'function' ? generate : () => null,
          fallback,
        ),
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};
