declare module "*scripts/publicArtifacts.mjs" {
  export const artifactManifestPath: string;
  export function isGeneratedPublicPath(value: unknown): boolean;
  export function validateArtifactManifest(value: unknown): {
    schemaVersion: "idol-public-artifacts-v1";
    files: { path: string; sha256: string; bytes: number }[];
  };
}
