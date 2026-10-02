// Module shims for wa-sqlite artifacts that ship without TypeScript types.

declare module 'wa-sqlite/dist/wa-sqlite-async.mjs' {
  // Emscripten module factory. We always pass { locateFile } so the WASM
  // binary is loaded from Vite's emitted asset URL.
  const factory: (options?: {
    locateFile?: (path: string, prefix: string) => string;
  }) => Promise<unknown>;
  export default factory;
}

declare module 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js' {
  export class OriginPrivateFileSystemVFS {
    constructor();
    readonly name: string;
  }
}
