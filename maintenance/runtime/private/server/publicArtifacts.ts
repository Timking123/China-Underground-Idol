export const ARTIFACT_MANIFEST = "assets/public-artifacts.v1.json";
export interface PublicArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

/** 与构建器逐项对照；合法命名还必须在精确清单中登记。 */
export function isGeneratedPublicPath(name: string): boolean {
  return [
    /^groups\/g\d{3,8}\.html$/u,
    /^(?:groups|events)\/index\.html$/u,
    /^events\/e-[a-z0-9][a-z0-9_-]{0,95}\.html$/u,
    /^assets\/page-data\/groups\/g\d{3,8}\.json$/u,
    /^assets\/page-data\/catalog\.json$/u,
    /^assets\/prerender\.css$/u,
    /^assets\/media-optimized\/manifest\.v1\.json$/u,
    /^assets\/media-optimized\/[a-f0-9]{20}-\d+\.webp$/u,
    /^feeds\/v1\/manifest\.json$/u,
    /^feeds\/v1\/groups\/g\d{3,8}\.ics$/u,
    /^feeds\/v1\/cities\/[0-9a-f]{2,192}\.ics$/u,
  ].some((pattern) => pattern.test(name));
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parsePublicArtifacts(raw: Buffer): PublicArtifact[] {
  const input: unknown = JSON.parse(raw.toString("utf8"));
  if (
    !object(input) ||
    Object.keys(input).sort().join(",") !== "files,schemaVersion" ||
    input.schemaVersion !== "idol-public-artifacts-v1" ||
    !Array.isArray(input.files) ||
    input.files.length > 9000
  )
    throw new Error("publication_artifact_manifest");
  const seen = new Set<string>();
  for (const item of input.files) {
    if (
      !object(item) ||
      Object.keys(item).sort().join(",") !== "bytes,path,sha256" ||
      typeof item.path !== "string" ||
      !isGeneratedPublicPath(item.path) ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.sha256) ||
      typeof item.bytes !== "number" ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      item.bytes > 20_000_000 ||
      seen.has(item.path.toLowerCase())
    )
      throw new Error("publication_artifact_entry");
    seen.add(item.path.toLowerCase());
  }
  return input.files as PublicArtifact[];
}
