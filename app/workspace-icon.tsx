import type { CSSProperties } from 'react';

const paths = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="18" width="7" height="3" rx="1"/></>,
  records: <><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></>,
  exceptions: <><path d="m10.3 4-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></>,
  audit: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  architecture: <><rect x="8" y="2" width="8" height="6" rx="1.5"/><rect x="2" y="16" width="7" height="6" rx="1.5"/><rect x="15" y="16" width="7" height="6" rx="1.5"/><path d="M12 8v4H5.5v4M12 12h6.5v4"/></>,
  data: <><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M12 16V3m-5 5 5-5 5 5"/></>,
  arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
  play: <><path d="m8 4 13 8-13 8V4Z"/></>,
  check: <><path d="m5 12 4 4L19 6"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  bolt: <><path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8m-8 4h5"/></>,
  code: <><path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 3l-4 18"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></>,
} as const;

export type IconName = keyof typeof paths;

export function WorkspaceIcon({ name, className = '' }:{ name: IconName; className?: string }) {
  return <svg className={`workspace-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function ResolutionRing({ rate }:{ rate: number }) {
  const clamped = Math.max(0, Math.min(1, rate));
  return <div className="resolution-ring" style={{ '--resolution': `${clamped * 360}deg` } as CSSProperties} aria-hidden="true"><span><WorkspaceIcon name="audit"/></span></div>;
}
