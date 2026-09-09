import type { CandidateSourceKind } from "./eventCandidates.ts";

export interface RegisteredSource {
  id: string;
  label: string;
  publisher: string;
  kind: CandidateSourceKind;
  state: "pilot" | "candidate" | "paused";
  collector:
    "manual-browser" | "showstart-public-http" | "provider-unavailable";
  pinnedUrls: string[];
  allowedUrlPrefixes: string[];
  note: string;
}

export interface SourceRegistry {
  schemaVersion: "idol-update-sources-v1";
  timezone: "Asia/Shanghai";
  activities: {
    state: "PAUSED";
    localTime: string;
    firstWindowDays: 30;
    focusDays: 7;
  };
  profiles: {
    state: "PAUSED";
    weekday: "SU";
    localTime: "10:00";
    paidBudgetCredits: 0;
  };
  sources: RegisteredSource[];
}

export function requireState(
  condition: unknown,
  code: string,
): asserts condition {
  if (!condition) throw Object.assign(new Error(code), { code });
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function safePublicUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !/^https:\/\//u.test(value)
  )
    return false;
  // eslint-disable-next-line no-control-regex -- URL入口必须拒绝控制字符。
  if (/[\s\\\u0000-\u001f\u007f]|%0[ad]/iu.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      !url.search &&
      !/^(?:localhost|127\.|0\.|\[|10\.|192\.168\.)/u.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

export function validateSourceRegistry(input: unknown): SourceRegistry {
  requireState(
    object(input) &&
      keys(input, [
        "schemaVersion",
        "timezone",
        "activities",
        "profiles",
        "sources",
      ]),
    "invalid_source_registry",
  );
  requireState(
    input.schemaVersion === "idol-update-sources-v1" &&
      input.timezone === "Asia/Shanghai",
    "invalid_source_registry_version",
  );
  const activities = input.activities;
  requireState(
    object(activities) &&
      keys(activities, [
        "state",
        "localTime",
        "firstWindowDays",
        "focusDays",
      ]) &&
      activities.state === "PAUSED" &&
      typeof activities.localTime === "string" &&
      /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(activities.localTime) &&
      activities.firstWindowDays === 30 &&
      activities.focusDays === 7,
    "invalid_activity_schedule_contract",
  );
  const profiles = input.profiles;
  requireState(
    object(profiles) &&
      keys(profiles, ["state", "weekday", "localTime", "paidBudgetCredits"]) &&
      profiles.state === "PAUSED" &&
      profiles.weekday === "SU" &&
      profiles.localTime === "10:00" &&
      profiles.paidBudgetCredits === 0,
    "paid_profile_schedule_not_authorized",
  );
  requireState(
    Array.isArray(input.sources) &&
      input.sources.length > 0 &&
      input.sources.length <= 100,
    "invalid_source_list",
  );
  const ids = new Set<string>();
  for (const source of input.sources) {
    requireState(
      object(source) &&
        keys(source, [
          "id",
          "label",
          "publisher",
          "kind",
          "state",
          "collector",
          "pinnedUrls",
          "allowedUrlPrefixes",
          "note",
        ]),
      "invalid_registered_source",
    );
    requireState(
      typeof source.id === "string" &&
        /^[a-z][a-z0-9-]{2,79}$/u.test(source.id) &&
        !ids.has(source.id),
      "duplicate_or_invalid_source_id",
    );
    ids.add(source.id);
    for (const name of ["label", "publisher", "note"])
      requireState(
        typeof source[name] === "string" &&
          source[name].trim().length > 0 &&
          source[name].length <= 2000,
        "invalid_source_description",
      );
    requireState(
      [
        "aggregator",
        "official",
        "organizer",
        "venue",
        "wiki",
        "ticketing",
      ].includes(String(source.kind)),
      "invalid_source_kind",
    );
    requireState(
      ["pilot", "candidate", "paused"].includes(String(source.state)) &&
        [
          "manual-browser",
          "showstart-public-http",
          "provider-unavailable",
        ].includes(String(source.collector)),
      "invalid_source_mode",
    );
    requireState(
      Array.isArray(source.pinnedUrls) &&
        source.pinnedUrls.length > 0 &&
        source.pinnedUrls.length <= 20 &&
        source.pinnedUrls.every(safePublicUrl),
      "invalid_source_pinned_urls",
    );
    requireState(
      Array.isArray(source.allowedUrlPrefixes) &&
        source.allowedUrlPrefixes.length <= 10 &&
        source.allowedUrlPrefixes.every(
          (url) => safePublicUrl(url) && url.endsWith("/"),
        ),
      "invalid_source_url_prefix",
    );
    if (source.collector === "showstart-public-http")
      requireState(
        source.kind === "organizer" &&
          source.pinnedUrls.length === 1 &&
          /^https:\/\/www\.showstart\.com\/host\/\d+$/u.test(
            source.pinnedUrls[0],
          ) &&
          source.allowedUrlPrefixes.every(
            (prefix) => prefix === "https://www.showstart.com/event/",
          ),
        "invalid_public_collector_scope",
      );
  }
  return input as unknown as SourceRegistry;
}

export function requireRegisteredUrl(
  source: RegisteredSource,
  value: unknown,
): asserts value is string {
  requireState(safePublicUrl(value), "unsafe_source_url");
  requireState(
    source.pinnedUrls.includes(value) ||
      source.allowedUrlPrefixes.some(
        (prefix) =>
          value.startsWith(prefix) &&
          /^[a-zA-Z0-9-]+$/u.test(value.slice(prefix.length)),
      ),
    "source_url_outside_registry",
  );
}

export function registrySource(
  registry: SourceRegistry,
  id: string,
): RegisteredSource {
  const found = registry.sources.find((source) => source.id === id);
  requireState(found, "unregistered_source");
  return found;
}
