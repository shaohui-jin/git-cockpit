export interface DesktopUpdateState {
  version: string;
  latest: string | null;
  updateAvailable: boolean;
  downloaded: boolean;
  percent: number | null;
  installMode: 'nsis' | 'zip' | 'none';
  jobId: string | null;
}

export interface DesktopActionResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

export interface DesktopBridge {
  getState(): Promise<DesktopUpdateState>;
  onState(cb: (state: DesktopUpdateState) => void): () => void;
  download(): Promise<DesktopActionResult>;
  install(): Promise<DesktopActionResult>;
  openRelease(): Promise<void>;
  upgradeService(): Promise<DesktopActionResult>;
  cancelDownload(): Promise<DesktopActionResult>;
}

export function getDesktopBridge(): DesktopBridge | null {
  const host = window as Window & { gitCockpitDesktop?: DesktopBridge };
  return host.gitCockpitDesktop ?? null;
}
