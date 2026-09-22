export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

/** 日期型资料不做时区偏移；带时区的观察时间以中文 UTC+8 展示。 */
export function timeHtml(value) {
  if (!value) return "尚未收录";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match)
    return `<time datetime="${escapeHtml(value)}">${match[1]}年${Number(match[2])}月${Number(match[3])}日</time>`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return escapeHtml(value);
  const label = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(date);
  return `<time datetime="${escapeHtml(value)}">${escapeHtml(label)}（UTC+8）</time>`;
}
