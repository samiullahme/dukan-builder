import dns from "dns/promises";
import { all } from "./db";

export type DomainRow = {
  site_id: string;
  business_name: string;
  kind: "subdomain" | "custom";
  domain: string;
  published: boolean;
  status: "ok" | "dns_error" | "down" | "unchecked";
  detail: string | null;
};

const CHECK_TIMEOUT_MS = 4000;
const CONCURRENCY = 5;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function checkHttp(domain: string): Promise<"ok" | "down" | "dns_error"> {
  try {
    await withTimeout(dns.resolve(domain), CHECK_TIMEOUT_MS);
  } catch {
    return "dns_error";
  }
  try {
    const res = await withTimeout(fetch(`https://${domain}`, { method: "HEAD", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), redirect: "follow" }), CHECK_TIMEOUT_MS + 1000);
    return res.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

export async function getDomainRows(): Promise<DomainRow[]> {
  const rows = await all<{
    id: string; business_name: string; slug: string; status: string; custom_domain: string | null;
  }>(
    `SELECT id, business_name, slug, status, custom_domain FROM sites
     WHERE status = 'published' OR custom_domain IS NOT NULL AND custom_domain <> ''
     ORDER BY created_at DESC`
  );

  const domains: DomainRow[] = [];
  for (const s of rows) {
    if (s.status === "published") {
      domains.push({
        site_id: s.id, business_name: s.business_name, kind: "subdomain",
        domain: `${s.slug}.dukanbot.website`, published: true, status: "unchecked", detail: null,
      });
    }
    if (s.custom_domain) {
      domains.push({
        site_id: s.id, business_name: s.business_name, kind: "custom",
        domain: s.custom_domain, published: s.status === "published", status: "unchecked", detail: null,
      });
    }
  }

  const queue = [...domains];
  async function worker() {
    while (queue.length) {
      const d = queue.shift()!;
      const result = await checkHttp(d.domain);
      d.status = result;
      if (result === "dns_error") d.detail = "DNS does not resolve";
      else if (result === "down") d.detail = "DNS resolves but the site does not answer";
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const broken = domains.filter((d) => d.status !== "ok");
  const healthy = domains.filter((d) => d.status === "ok");
  return [...broken, ...healthy];
}
