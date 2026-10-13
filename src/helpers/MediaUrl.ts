import { API_URL_FILES } from "@/config/Api";

/** Armazenamento público da mídia: o catálogo atual já aponta para ele. */
const MEDIA_ORIGIN = "https://files.louvorja.com.br";

/**
 * Catálogos guardados antes de 11/10/2026 trazem a mídia como
 * `https://api.louvorja.(workers.dev|com.br)/file/<caminho>`. O número do banco
 * não mudou, então o app nunca renovou essas linhas e continuaria baixando pela
 * API, que conta cada arquivo na cota diária. O mesmo caminho existe em
 * `files.louvorja.com.br`.
 */
const LEGACY_API_FILE = /^https?:\/\/api\.louvorja\.(?:workers\.dev|com\.br)\/file\/(.+)$/i;

export interface MediaReference {
  url: string;
  relativePath: string;
}

function normalizePathname(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const normalized = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  const withoutFilePrefix = normalized.replace(/^file\//i, "");
  if (!withoutFilePrefix || withoutFilePrefix.split("/").some((part) => part === "..")) {
    return null;
  }
  return `/${withoutFilePrefix}`;
}

/** Aceita tanto o sufixo antigo quanto a URL completa nova da API. */
export function resolveMediaReference(value: string | null | undefined): MediaReference | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const relativePath = normalizePathname(parsed.pathname);
      if (!relativePath) return null;
      const legacy = LEGACY_API_FILE.exec(parsed.origin + parsed.pathname);
      const url = legacy
        ? `${MEDIA_ORIGIN}/${legacy[1]}${parsed.search}`
        : parsed.toString();
      return { url, relativePath };
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) return null;
  const relativePath = normalizePathname(raw);
  if (!relativePath || !API_URL_FILES) return null;
  return {
    url: `${API_URL_FILES.replace(/\/+$/, "")}${relativePath}`,
    relativePath,
  };
}

export function encodeMediaPath(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
