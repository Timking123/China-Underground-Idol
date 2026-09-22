// 构建、预览与发布共用公开入口，禁止以任意 assets/*.js 扩大公开范围。
export const entryPoints = Object.freeze({
  site: "src/site/map.ts",
  events: "src/events/page.ts",
  contribute: "src/content/page.ts",
  groups: "src/groups/list.ts",
  group: "src/groups/detail.ts",
  discover: "src/discover/page.ts",
  geography: "src/geography/page.ts",
  metrics: "src/metrics/page.ts",
  favorites: "src/favorites/page.ts",
  city: "src/city/page.ts",
  subscriptions: "src/subscriptions/page.ts",
  updates: "src/updates/page.ts",
});

export const publicFiles = Object.freeze([
  "index.html",
  "discover.html",
  "geography.html",
  "groups.html",
  "group.html",
  "events.html",
  "guide.html",
  "contribute.html",
  "about.html",
  "favorites.html",
  "city.html",
  "subscriptions.html",
  "updates.html",
  "app.css",
  "app.js",
  "data.js",
  "data/events.v1.json",
  "styles/site.css",
  "styles/events.css",
  "styles/content.css",
  "styles/groups.css",
  "styles/discover.css",
  "styles/geography.css",
  "styles/preferences.css",
  "styles/city.css",
  "styles/subscriptions.css",
  "styles/updates.css",
  "assets/groups-data.js",
  "assets/public-artifacts.v1.json",
  ...Object.keys(entryPoints).map((name) => `assets/${name}.js`),
]);

export const imageFolders = Object.freeze([
  "avatars",
  "posters",
  "group-visuals",
  "profile-covers",
  "weibo-api-avatar-candidates",
  "weibo-avatars",
  "weibo-cached-visuals",
]);

export function isPublicImage(name) {
  const parts = name.split("/");
  return (
    parts.length === 3 &&
    parts[0] === "assets" &&
    imageFolders.includes(parts[1]) &&
    /^g\d{3}[a-zA-Z0-9.-]*\.(?:png|jpe?g|webp|svg)$/.test(parts[2])
  );
}
