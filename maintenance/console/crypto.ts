import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

/** 每条记录独立随机 nonce，AAD 将密文绑定到表和主键，不能交换记录。 */
export class Vault {
  private readonly encryptionKey: Buffer;
  private readonly indexKey: Buffer;
  constructor(masterKey: Buffer) {
    if (masterKey.length !== 32) throw new Error("管理密钥必须为 32 字节");
    this.encryptionKey = Buffer.from(
      hkdfSync("sha256", masterKey, "idol-console-v1", "record-encryption", 32),
    );
    this.indexKey = Buffer.from(
      hkdfSync("sha256", masterKey, "idol-console-v1", "private-index", 32),
    );
  }
  seal(scope: string, value: unknown): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
    cipher.setAAD(Buffer.from(scope, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      nonce.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  }
  open<T>(scope: string, envelope: string): T {
    const parts = envelope.split(".");
    if (
      parts.length !== 4 ||
      parts[0] !== "v1" ||
      parts
        .slice(1)
        .some((part) => Buffer.from(part, "base64").toString("base64") !== part)
    )
      throw new Error("加密记录格式无效");
    const nonce = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    if (nonce.length !== 12 || tag.length !== 16)
      throw new Error("加密记录格式无效");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, nonce);
    decipher.setAAD(Buffer.from(scope, "utf8"));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(parts[3], "base64")),
        decipher.final(),
      ]).toString("utf8"),
    ) as T;
  }
  tag(scope: string, value: string): string {
    return createHmac("sha256", this.indexKey)
      .update(scope)
      .update("\0")
      .update(value)
      .digest("hex");
  }
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 14 || password.length > 256)
    throw new Error("密码须为 14 至 256 个字符");
  const salt = randomBytes(24);
  return `s1$${salt.toString("base64")}$${(await derive(password, salt)).toString("base64")}`;
}
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (password.length > 256) return false;
  const [version, salt, digest, extra] = stored.split("$");
  if (version !== "s1" || !salt || !digest || extra !== undefined) return false;
  const expected = Buffer.from(digest, "base64");
  const decodedSalt = Buffer.from(salt, "base64");
  if (
    decodedSalt.length !== 24 ||
    expected.length !== 64 ||
    decodedSalt.toString("base64") !== salt ||
    expected.toString("base64") !== digest
  )
    return false;
  const actual = await derive(password, decodedSalt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
