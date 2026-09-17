export const feedbackKinds = [
  "submission",
  "error",
  "event",
  "outdated",
  "rights",
  "feedback",
  "suggestion",
] as const;
export type FeedbackKind = (typeof feedbackKinds)[number];
export const feedbackStatuses = [
  "pending",
  "reviewing",
  "resolved",
  "rejected",
] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];
export const kindLabels: Record<FeedbackKind, string> = {
  submission: "资料投稿",
  error: "资料纠错",
  event: "活动补充",
  outdated: "过时资料",
  rights: "素材权利",
  feedback: "意见反馈",
  suggestion: "功能建议",
};
export const statusLabels: Record<FeedbackStatus, string> = {
  pending: "待处理",
  reviewing: "核实中",
  resolved: "已处理",
  rejected: "未采纳",
};
export interface FeedbackInput {
  kind: FeedbackKind;
  target: string;
  source: string;
  details: string;
  contact: string;
  consent: boolean;
  website: string;
  requestId: string;
}
export interface Feedback extends Omit<
  FeedbackInput,
  "website" | "consent" | "requestId"
> {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: FeedbackStatus;
  note: string;
  ip: string;
}
export interface Region {
  country: string;
  province: string;
  city: string;
}
export interface Visit extends Region {
  id: string;
  createdAt: number;
  ip: string;
  path: string;
  referrer: string;
  browser: string;
  device: string;
}
export interface DailyStat {
  day: string;
  pv: number;
  uv: number;
  ips: number;
}
export interface RegionStat {
  country: string;
  province: string;
  pv: number;
}
export interface Dashboard {
  days: DailyStat[];
  regions: RegionStat[];
  totalPv: number;
  dailyUv: number;
  pending: number;
  firstDay: string | null;
  generatedAt: number;
}
export interface ConsoleSettings {
  acceptFeedback: boolean;
  feedbackNotice: string;
  analyticsEnabled: boolean;
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Audit {
  id: string;
  createdAt: number;
  action: string;
  target: string;
  actor: string;
}
export interface SystemInfo {
  version: string;
  uptimeSeconds: number;
  encryption: string;
  retentionDays: number;
  geoReady: boolean;
  databaseBytes: number;
  siteAvailable: boolean;
  lastCleanup: number;
  username: string;
}
export interface AdminSession {
  username: string;
  csrf: string;
  absoluteRemainingMs: number;
}
export interface ApiResult<T> {
  code: number;
  data: T;
  message: string;
}
