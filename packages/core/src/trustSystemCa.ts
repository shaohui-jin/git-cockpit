/** Node fetch 默认不读系统 CA；FastGitHub 等 HTTPS 解密代理需要并入系统证书。 */
import tls from 'node:tls';

type TlsWithSystemCa = typeof tls & {
  getCACertificates?: (type?: string) => string[];
  setDefaultCACertificates?: (certs: readonly string[]) => void;
};

let applied = false;

export function trustSystemCa(): void {
  if (applied) return;
  applied = true;
  const t = tls as TlsWithSystemCa;
  if (typeof t.getCACertificates !== 'function' || typeof t.setDefaultCACertificates !== 'function') return;
  try {
    const merged = [...t.getCACertificates('default'), ...t.getCACertificates('system')];
    if (merged.length > 0) t.setDefaultCACertificates(merged);
  } catch {
    /* 当前运行时读不到系统证书库时保持 Node 默认 CA */
  }
}

export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  if (cause instanceof Error && cause.message && cause.message !== err.message) {
    return `${err.message}（${cause.message}）`;
  }
  return err.message;
}
