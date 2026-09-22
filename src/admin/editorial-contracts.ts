export const editorialFields = [
  "title",
  "date",
  "province",
  "city",
  "venue",
  "address",
  "opensAt",
  "startsAt",
  "endsAt",
  "status",
  "notes",
] as const;
export type EditorialField = (typeof editorialFields)[number];
export const editorialFieldLabels: Record<EditorialField, string> = {
  title: "演出名称",
  date: "日期",
  province: "省份",
  city: "城市",
  venue: "场馆",
  address: "地址",
  opensAt: "入场时间",
  startsAt: "开始时间",
  endsAt: "结束时间",
  status: "活动状态",
  notes: "公开说明",
};
export type EditorialPatch = Partial<Record<EditorialField, string | null>>;
export interface EditorialEvidence {
  captureId: string;
  url: string;
  label: string;
  publisher: string;
  kind: "official" | "organizer" | "venue" | "ticketing";
  observedAt: string;
  excerpt: string;
  supports: EditorialField[];
}
export interface EditorialInput {
  feedbackId: string;
  baselineSha256: string;
  target: { kind: "event"; id: string };
  patch: EditorialPatch;
  evidence: EditorialEvidence[];
  rationale: string;
}
export interface EditorialCandidate extends EditorialInput {
  schemaVersion: "idol-editorial-candidate-v1";
  candidateId: string;
  revisionId: string;
  revisionVersion: number;
  reviewedBy: string;
  reviewedAt: string;
}
export interface EditorialReceipt {
  schemaVersion: "idol-editorial-receipt-v1";
  candidateId: string;
  candidateSha256: string;
  baselineSha256: string;
  resultSha256: string | null;
  status: "applied" | "rejected" | "withdrawn";
  runId: string;
  publicationId: string | null;
  snapshotManifestSha256: string | null;
  message: string;
  completedAt: string;
}
export const editorialStatusLabels = {
  draft: "待审核",
  approved: "已审核待交付",
  rejected: "审核未采纳",
  handed_off: "已交付待维护",
  withdrawal_requested: "等待维护确认撤回",
  withdrawn: "已撤回",
  applied: "维护已应用",
  failed: "维护未应用",
} as const;
export type EditorialStatus = keyof typeof editorialStatusLabels;
export interface EditorialRevision extends EditorialInput {
  id: string;
  version: number;
  status: EditorialStatus;
  createdAt: number;
  updatedAt: number;
  actor: string;
  reviewNote: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  candidate: EditorialCandidate | null;
  candidateSha256: string | null;
  receipt: EditorialReceipt | null;
  history: { at: number; actor: string; action: string; note: string }[];
}
export interface EditorialDiff {
  field: EditorialField;
  before: string | null;
  after: string | null;
}
export interface EditorialBaseline {
  baselineSha256: string;
  updatedAt: string;
  fields: readonly EditorialField[];
  events: ({ id: string } & Record<EditorialField, string | null>)[];
}
export interface EditorialDetail {
  revision: EditorialRevision;
  diff: EditorialDiff[];
  baselineConflict: boolean;
}
