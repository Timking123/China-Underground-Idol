import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { Vault } from "./crypto.ts";
import { privateDirectory, privateFile, privateReadFile } from "./security.ts";
import type {
  Audit,
  ConsoleSettings,
  DailyStat,
  Dashboard,
  Feedback,
  FeedbackInput,
  FeedbackStatus,
  PageResult,
  RegionStat,
  Visit,
} from "../../src/admin/contracts.ts";

const DAY = 86400000;
export const RETENTION_DAYS = 90;
export function chinaDay(time: number): string {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10);
}
const defaults: ConsoleSettings = {
  acceptFeedback: true,
  feedbackNotice: "",
  analyticsEnabled: true,
};
interface RecordRow {
  id: string;
  payload: string;
}
export interface Account {
  username: string;
  passwordHash: string;
  version?: string;
}
export interface Session {
  username: string;
  csrf: string;
  createdAt: number;
  touchedAt: number;
  accountVersion: string;
}

/** 私人载荷全部加密；查询所需的地址/访客标签使用独立密钥 HMAC。 */
export class ConsoleStore {
  readonly db: DatabaseSync;
  readonly vault: Vault;
  readonly filename: string;
  constructor(
    dataDirectory: string,
    key: Buffer,
    options: { readOnly?: boolean } = {},
  ) {
    this.vault = new Vault(key);
    this.filename = path.join(dataDirectory, "console.sqlite");
    if (options.readOnly) {
      // 迁移核验绝不创建库、key-check、账户或升级 schema，也不延长任何到期时间。
      const directory = lstatSync(dataDirectory);
      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        (process.platform !== "win32" && (directory.mode & 0o077) !== 0)
      )
        throw new Error("迁移核验目录必须私有且已存在");
      privateReadFile(this.filename);
      this.db = new DatabaseSync(this.filename, { readOnly: true });
      try {
        if (
          this.get<{ check: string }>("meta", "key-check")?.check !==
            "idol-console-v1" ||
          !this.get<Account>("account", "admin")
        )
          throw new Error("原密钥或管理员缺失");
      } catch (error) {
        this.db.close();
        throw error;
      }
      return;
    }
    privateDirectory(dataDirectory);
    if (!existsSync(this.filename))
      writeFileSync(this.filename, Buffer.alloc(0), {
        flag: "wx",
        mode: 0o600,
      });
    for (const filename of [
      this.filename,
      `${this.filename}-wal`,
      `${this.filename}-shm`,
      `${this.filename}-journal`,
    ])
      if (existsSync(filename)) privateFile(filename);
    this.db = new DatabaseSync(this.filename);
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;",
      );
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS records (bucket TEXT NOT NULL, id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(bucket,id));
        CREATE INDEX IF NOT EXISTS records_recent_stable ON records(bucket,created_at DESC,id DESC);
        CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, day TEXT NOT NULL, ip_tag TEXT NOT NULL, visitor_tag TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS visits_recent_stable ON visits(created_at DESC,id DESC);
        CREATE INDEX IF NOT EXISTS visits_ip_day ON visits(day,ip_tag);
        CREATE INDEX IF NOT EXISTS visits_visitor_day ON visits(day,visitor_tag);
        CREATE TABLE IF NOT EXISTS limits (tag TEXT PRIMARY KEY, expires INTEGER NOT NULL, count INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS limits_expires ON limits(expires);`);
      const check = this.get<{ check: string }>("meta", "key-check");
      if (check?.check !== "idol-console-v1") {
        const count = (
          this.db
            .prepare(
              "SELECT (SELECT count(*) FROM records)+(SELECT count(*) FROM visits)+(SELECT count(*) FROM limits) AS n",
            )
            .get() as { n: number }
        ).n;
        if (count || check) throw new Error("数据库密钥不匹配或初始化不完整");
        this.put("meta", "key-check", { check: "idol-console-v1" }, Date.now());
      }
      // 检索标签不含可还原的状态或 IP；清理只读取到期反馈，不扫描全部私人正文。
      this.transaction(() => {
        const columns = this.db.prepare("PRAGMA table_info(records)").all() as {
          name: string;
        }[];
        if (!columns.some((column) => column.name === "state_tag")) {
          this.db.exec(
            "ALTER TABLE records ADD COLUMN state_tag TEXT NOT NULL DEFAULT ''; ALTER TABLE records ADD COLUMN ip_expires INTEGER;",
          );
          for (const row of this.db
            .prepare("SELECT id,payload FROM records WHERE bucket='feedback'")
            .iterate()) {
            const value = this.vault.open<Feedback>(
              `feedback/${String(row.id)}`,
              String(row.payload),
            );
            this.db
              .prepare(
                "UPDATE records SET state_tag=?,ip_expires=? WHERE bucket='feedback' AND id=?",
              )
              .run(
                this.vault.tag("feedback-state", value.status),
                value.ip ? value.createdAt + RETENTION_DAYS * DAY : null,
                value.id,
              );
          }
        }
        this.db.exec(
          "CREATE INDEX IF NOT EXISTS records_state ON records(bucket,state_tag,created_at DESC,id DESC); CREATE INDEX IF NOT EXISTS records_ip_expires ON records(ip_expires) WHERE ip_expires IS NOT NULL; CREATE INDEX IF NOT EXISTS records_touched ON records(bucket,updated_at); PRAGMA user_version=2;",
        );
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  get<T>(bucket: string, id: string): T | null {
    const row = this.db
      .prepare("SELECT payload FROM records WHERE bucket=? AND id=?")
      .get(bucket, id) as { payload: string } | undefined;
    return row ? this.vault.open<T>(`${bucket}/${id}`, row.payload) : null;
  }
  put(bucket: string, id: string, value: unknown, now: number): void {
    this.db
      .prepare(
        "INSERT INTO records(bucket,id,created_at,updated_at,payload) VALUES (?,?,?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload",
      )
      .run(bucket, id, now, now, this.vault.seal(`${bucket}/${id}`, value));
    if (bucket === "feedback") {
      const feedback = value as Feedback;
      this.db
        .prepare(
          "UPDATE records SET state_tag=?,ip_expires=? WHERE bucket=? AND id=?",
        )
        .run(
          this.vault.tag("feedback-state", feedback.status),
          feedback.ip ? feedback.createdAt + RETENTION_DAYS * DAY : null,
          bucket,
          id,
        );
    }
  }
  remove(bucket: string, id: string): void {
    this.db
      .prepare("DELETE FROM records WHERE bucket=? AND id=?")
      .run(bucket, id);
  }
  list<T>(bucket: string): T[] {
    return (
      this.db
        .prepare(
          "SELECT id,payload FROM records WHERE bucket=? ORDER BY created_at DESC,id DESC",
        )
        .all(bucket) as unknown as RecordRow[]
    ).map((row) => this.vault.open<T>(`${bucket}/${row.id}`, row.payload));
  }
  recordPage<T>(
    bucket: string,
    page: number,
    pageSize: number,
    status = "",
  ): PageResult<T> {
    const state = status ? this.vault.tag("feedback-state", status) : null;
    const where = state ? "bucket=? AND state_tag=?" : "bucket=?";
    const parameters = state ? [bucket, state] : [bucket];
    const total = (
      this.db
        .prepare(`SELECT count(*) AS total FROM records WHERE ${where}`)
        .get(...parameters) as { total: number }
    ).total;
    const rows = this.db
      .prepare(
        `SELECT id,payload FROM records WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...parameters,
        pageSize,
        (page - 1) * pageSize,
      ) as unknown as RecordRow[];
    return {
      items: rows.map((row) =>
        this.vault.open<T>(`${bucket}/${row.id}`, row.payload),
      ),
      total,
      page,
      pageSize,
    };
  }
  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  settings(): ConsoleSettings {
    return this.get<ConsoleSettings>("settings", "main") ?? { ...defaults };
  }
  audit(action: string, target: string, actor: string, now: number): void {
    const id = randomUUID();
    this.put(
      "audit",
      id,
      { id, action, target, actor, createdAt: now } satisfies Audit,
      now,
    );
  }
  /** 限流状态跨重启保留，数据库里不保留可反查的原始 IP。 */
  allow(
    scope: string,
    identity: string,
    maximum: number,
    windowMs: number,
    now: number,
  ): boolean {
    const tag = this.vault.tag(scope, identity);
    return (
      this.db
        .prepare(
          "INSERT INTO limits VALUES (?,?,1) ON CONFLICT(tag) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END WHERE expires<=? OR count<? RETURNING count",
        )
        .get(tag, now + windowMs, now, now, now, maximum) !== undefined
    );
  }
  createFeedback(input: FeedbackInput, ip: string, now: number): Feedback {
    const id = this.vault
      .tag("feedback-id", `${ip}/${input.requestId}`)
      .slice(0, 24);
    const feedback: Feedback = {
      id,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      note: "",
      kind: input.kind,
      target: input.target,
      source: input.source,
      details: input.details,
      contact: input.contact,
      ip,
    };
    return this.transaction(() => {
      const existing = this.get<Feedback>("feedback", id);
      if (existing) return existing;
      this.put("feedback", id, feedback, now);
      this.audit("收到反馈", id, "访客", now);
      return feedback;
    });
  }
  feedbackPage(page: number, status: string): PageResult<Feedback> {
    return this.recordPage<Feedback>("feedback", page, 25, status);
  }
  reviewFeedback(
    id: string,
    status: FeedbackStatus,
    note: string,
    actor: string,
    now: number,
    authorize?: () => void,
  ): Feedback | null {
    return this.transaction(() => {
      authorize?.();
      const record = this.get<Feedback>("feedback", id);
      if (!record) return null;
      const updated: Feedback = { ...record, status, note, updatedAt: now };
      this.put("feedback", id, updated, now);
      this.audit("处理反馈", `${id} / ${status}`, actor, now);
      return updated;
    });
  }
  addVisit(visit: Visit, userAgent: string): void {
    const day = chinaDay(visit.createdAt);
    const ipTag = this.vault.tag("visit-ip", `${day}/${visit.ip}`);
    const visitorTag = this.vault.tag(
      "visit-visitor",
      `${day}/${visit.ip}/${userAgent}`,
    );
    this.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM visits WHERE id=?").get(visit.id))
        return;
      const newIp = !this.db
        .prepare("SELECT 1 FROM visits WHERE day=? AND ip_tag=? LIMIT 1")
        .get(day, ipTag);
      const newVisitor = !this.db
        .prepare("SELECT 1 FROM visits WHERE day=? AND visitor_tag=? LIMIT 1")
        .get(day, visitorTag);
      this.db
        .prepare("INSERT INTO visits VALUES (?,?,?,?,?,?)")
        .run(
          visit.id,
          visit.createdAt,
          day,
          ipTag,
          visitorTag,
          this.vault.seal(`visits/${visit.id}`, visit),
        );
      const daily = this.get<DailyStat>("daily", day) ?? {
        day,
        pv: 0,
        uv: 0,
        ips: 0,
      };
      daily.pv++;
      daily.uv += Number(newVisitor);
      daily.ips += Number(newIp);
      this.put("daily", day, daily, visit.createdAt);
      const regionId = this.vault.tag(
        "region",
        `${visit.country}/${visit.province}`,
      );
      const region = this.get<RegionStat>(`regions:${day}`, regionId) ?? {
        country: visit.country,
        province: visit.province,
        pv: 0,
      };
      region.pv++;
      this.put(`regions:${day}`, regionId, region, visit.createdAt);
      if (!this.get("meta", "first-day"))
        this.put("meta", "first-day", day, visit.createdAt);
    });
  }
  dashboard(days: number, now: number): Dashboard {
    const series: DailyStat[] = [];
    const regions = new Map<string, RegionStat>();
    for (let i = days - 1; i >= 0; i--) {
      const day = chinaDay(now - i * DAY);
      series.push(
        this.get<DailyStat>("daily", day) ?? { day, pv: 0, uv: 0, ips: 0 },
      );
      for (const region of this.list<RegionStat>(`regions:${day}`)) {
        const id = `${region.country}/${region.province}`;
        const current = regions.get(id) ?? { ...region, pv: 0 };
        current.pv += region.pv;
        regions.set(id, current);
      }
    }
    const pending = (
      this.db
        .prepare(
          "SELECT count(*) AS n FROM records WHERE bucket='feedback' AND state_tag=?",
        )
        .get(this.vault.tag("feedback-state", "pending")) as { n: number }
    ).n;
    return {
      days: series,
      regions: [...regions.values()].sort((a, b) => b.pv - a.pv),
      totalPv: series.reduce((n, day) => n + day.pv, 0),
      dailyUv: series.reduce((n, day) => n + day.uv, 0),
      pending,
      firstDay: this.get<string>("meta", "first-day"),
      generatedAt: now,
    };
  }
  visitsPage(page: number, now: number): PageResult<Visit> {
    const after = now - RETENTION_DAYS * DAY;
    const total = (
      this.db
        .prepare("SELECT COUNT(*) AS total FROM visits WHERE created_at>=?")
        .get(after) as { total: number }
    ).total;
    const rows = this.db
      .prepare(
        "SELECT id,payload FROM visits WHERE created_at>=? ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?",
      )
      .all(after, (page - 1) * 50) as unknown as RecordRow[];
    return {
      items: rows.map((row) =>
        this.vault.open<Visit>(`visits/${row.id}`, row.payload),
      ),
      total,
      page,
      pageSize: 50,
    };
  }
  cleanup(now: number): void {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM visits WHERE created_at<?")
        .run(now - RETENTION_DAYS * DAY);
      this.db.prepare("DELETE FROM limits WHERE expires<=?").run(now);
      this.db
        .prepare("DELETE FROM records WHERE bucket='sessions' AND created_at<?")
        .run(now - 8 * 3600000);
      this.db
        .prepare(
          "DELETE FROM records WHERE bucket='sessions' AND updated_at<=?",
        )
        .run(now - 30 * 60000);
      // 投稿 IP 同样遵守 90 天，不因反馈尚未处理而无限保留。
      for (;;) {
        const rows = this.db
          .prepare(
            "SELECT id,payload FROM records WHERE ip_expires<? LIMIT 500",
          )
          .all(now) as unknown as RecordRow[];
        if (!rows.length) break;
        for (const row of rows) {
          const feedback = this.vault.open<Feedback>(
            `feedback/${row.id}`,
            row.payload,
          );
          this.put("feedback", row.id, { ...feedback, ip: "" }, now);
        }
      }
      this.put("meta", "last-cleanup", now, now);
    });
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}
