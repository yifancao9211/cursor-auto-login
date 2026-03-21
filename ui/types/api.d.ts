/**
 * Type definitions for the Electron preload bridge (window.api).
 * Provides IntelliSense without requiring full TypeScript migration.
 */

interface Account {
  email: string;
  token?: string;
  access_token?: string;
  refresh_token?: string;
  membership_type?: string;
  days_remaining?: number;
  on_demand_used?: number;
  on_demand_limit?: number;
  plan_used?: number;
  plan_limit?: number;
  reset_date?: string;
  token_valid?: 0 | 1;
  last_checked?: string;
  created_at?: string;
  account_status?: "new" | "active" | "failed" | "disabled";
  org_name?: string;
  org_id?: string;
  machine_id?: string;
  mac_machine_id?: string;
  dev_device_id?: string;
  sqm_id?: string;
  stripe_customer_id?: string;
  team_id?: string;
  is_admin?: 0 | 1;
  team_role?: string;
  tags?: string;
}

interface AuthData {
  accessToken?: string;
  refreshToken?: string;
  cachedEmail?: string;
  cachedSignUpType?: string;
  stripeMembershipType?: string;
  stripeSubscriptionStatus?: string;
  stripeCustomerId?: string;
  teamId?: string;
  browser?: string;
  error?: string;
}

interface SwitchResult {
  success: boolean;
  email?: string;
  tokenType?: string;
  machineIdReset?: { success: boolean; error?: string };
  error?: string;
  reason?: string;
}

interface LoginProgress {
  current: number;
  total: number;
  email: string;
  status: string;
}

interface LoginResult {
  email: string;
  success: boolean;
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

interface MachineIds {
  machineId: string;
  macMachineId: string;
  devDeviceId: string;
  sqmId: string;
}

interface AutoCheckStatus {
  running: boolean;
  intervalMinutes: number;
  lastCheckTime: string | null;
}

interface ScheduleSettings {
  orgDiscoveryEnabled?: boolean;
  retryFailedEnabled?: boolean;
  retryFailedTime?: string;
  enableLogging?: boolean;
  autoCheckMinutes?: number;
}

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
  source: "main" | "renderer";
}

interface ElectronAPI {
  // Cursor DB
  readAuth(): Promise<AuthData>;

  // Cursor API
  fetchUsage(token: string): Promise<any>;
  fetchStripe(token: string): Promise<any>;
  fetchTeams(token: string): Promise<any>;

  // Account DB
  listAccounts(): Promise<Account[]>;
  listAccountsByStatus(status: string): Promise<Account[]>;
  upsertAccount(account: Partial<Account>): Promise<void>;
  removeAccounts(emails: string[]): Promise<number>;
  disableAccounts(emails: string[]): Promise<{ success: boolean; count: number }>;
  activateAccounts(emails: string[]): Promise<{ success: boolean; count: number }>;
  importTokensJson(data: Record<string, string>): Promise<number>;
  exportTokensJson(): Promise<Record<string, string>>;
  exportFull(): Promise<{ success: boolean; count?: number; filePath?: string }>;
  importFull(): Promise<{ success: boolean; count?: number }>;
  refreshAllAccounts(): Promise<any>;
  refreshSingleAccount(email: string): Promise<{ success: boolean; update?: any; error?: string }>;
  discoverTeam(): Promise<{ success: boolean }>;

  // Token Exchange
  exchangeToken(email: string): Promise<{ success: boolean; error?: string }>;
  exchangeAllTokens(): Promise<Array<{ email: string; success: boolean }>>;

  // Switcher
  switchAccount(account: Partial<Account>, options?: { resetMachineId?: boolean }): Promise<SwitchResult>;
  smartSwitch(): Promise<SwitchResult>;

  // Login
  batchLogin(params: { emails: string[]; password: string; headless: boolean; concurrency: number }): Promise<LoginResult[]>;
  singleLogin(params: { email: string; password: string }): Promise<LoginResult>;

  // Machine ID
  readCurrentMachineId(): Promise<MachineIds | null>;
  resetRandomMachineId(): Promise<{ success: boolean; error?: string }>;
  backupOriginalMachineId(): Promise<{ success: boolean; path?: string; error?: string }>;
  restoreOriginalMachineId(): Promise<{ success: boolean; error?: string }>;

  // Auto Check
  setAutoCheckInterval(minutes: number): Promise<{ interval: number }>;
  getAutoCheckStatus(): Promise<AutoCheckStatus>;
  runAutoCheckNow(): Promise<any>;
  stopAutoCheck(): Promise<{ running: boolean }>;
  toggleAutoCheck(): Promise<{ running: boolean; intervalMinutes: number }>;

  // Schedule
  updateScheduleSettings(settings: ScheduleSettings): Promise<ScheduleSettings>;

  // Logger
  getAllLogs(): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
  setLoggingEnabled(enabled: boolean): Promise<void>;
  sendRendererLog(level: string, message: string): Promise<void>;
  openLogDir(): Promise<void>;

  // Usage History
  getUsageHistory(days?: number): Promise<Array<{ date: string; email: string; plan_used: number; plan_limit: number; on_demand_used: number; on_demand_limit: number; account_status: string }>>;

  // Tags
  getAllTags(): Promise<string[]>;

  // Report
  exportCSVReport(): Promise<{ success: boolean; count?: number; filePath?: string }>;

  // Webhook
  testWebhook(settings: { webhookEnabled: boolean; webhookUrl: string; webhookType: string }): Promise<{ success: boolean; error?: string; status?: number }>;

  // Updater
  checkForUpdate(): Promise<any>;
  installUpdate(): void;
  getAppVersion(): Promise<string>;

  // Dialogs
  openFileDialog(options?: any): Promise<any>;
  saveFileDialog(options?: any): Promise<any>;

  // Event Listeners (return cleanup function)
  onLoginProgress(callback: (data: LoginProgress) => void): () => void;
  onRefreshProgress(callback: (data: any) => void): () => void;
  onAutoCheckStarted(callback: (data: any) => void): () => void;
  onAutoCheckFinished(callback: (data: any) => void): () => void;
  onOrgNewMembers(callback: (data: any) => void): () => void;
  onExchangeProgress(callback: (data: any) => void): () => void;
  onUpdateStatus(callback: (data: any) => void): () => void;
  onLogEntry(callback: (entry: LogEntry) => void): () => void;
  onLogCleared(callback: () => void): () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

export {};
