import { defineStore } from "pinia";

export const useAppStore = defineStore("app", {
  state: () => ({
    currentAuth: null,
    accounts: [],
    loading: false,
    refreshing: false,
    refreshProgress: null,
    autoCheckStatus: null,
    settings: {
      batchPassword: "abcd@1234",
      concurrency: 3,
      autoCheckMinutes: 30,
      orgDiscoveryEnabled: true,
      retryFailedEnabled: false,
      retryFailedTime: "00:00",
      enableLogging: false,
      darkMode: false,
      webhookEnabled: false,
      webhookUrl: "",
      webhookType: "discord",
      onboardingDone: false,
    },
    preferences: {
      viewMode: "full",
      sortBy: "email",
      balanceFilter: "all",
    },
  }),

  getters: {
    currentEmail: (state) => state.currentAuth?.cachedEmail || "",
    accountCount: (state) => state.accounts.length,
    activeAccounts: (state) => state.accounts.filter((a) => a.account_status === "active"),
    newAccounts: (state) => state.accounts.filter((a) => a.account_status === "new"),
    failedAccounts: (state) => state.accounts.filter((a) => a.account_status === "failed"),
    disabledAccounts: (state) => state.accounts.filter((a) => a.account_status === "disabled"),
    validAccounts: (state) => state.accounts.filter((a) => a.token_valid),
    accountsWithBalance: (state) =>
      state.accounts.filter((a) => {
        if (!a.token_valid || a.account_status !== "active") return false;
        const totalUsed = (a.plan_used || 0) + (a.on_demand_used || 0);
        const totalLimit = (a.plan_limit || 0) + (a.on_demand_limit || 0);
        return totalLimit > 0 && totalUsed < totalLimit;
      }),
  },

  actions: {
    async loadCurrentAuth() {
      try {
        this.currentAuth = await window.api.readAuth();
      } catch (e) {
        console.error("[store] loadCurrentAuth failed:", e.message);
      }
    },

    async loadAccounts() {
      this.loading = true;
      try {
        this.accounts = await window.api.listAccounts();
      } catch (e) {
        console.error("[store] loadAccounts failed:", e.message);
      } finally {
        this.loading = false;
      }
    },

    async refreshAllAccounts() {
      this.refreshing = true;
      const cleanup = window.api.onRefreshProgress((progress) => {
        this.refreshProgress = progress;
      });
      try {
        await window.api.refreshAllAccounts();
        await this.loadAccounts();
      } finally {
        this.refreshing = false;
        this.refreshProgress = null;
        cleanup();
      }
    },

    async switchAccount(account, options = {}) {
      try {
        return await window.api.switchAccount(account, options);
      } catch (e) {
        console.error("[store] switchAccount failed:", e.message);
        return { success: false, error: e.message };
      }
    },

    async smartSwitch() {
      try {
        return await window.api.smartSwitch();
      } catch (e) {
        console.error("[store] smartSwitch failed:", e.message);
        return { success: false, error: e.message };
      }
    },

    async loadAutoCheckStatus() {
      this.autoCheckStatus = await window.api.getAutoCheckStatus();
    },

    async setAutoCheckInterval(minutes) {
      await window.api.setAutoCheckInterval(minutes);
      this.settings.autoCheckMinutes = minutes;
      this.saveSettings();
      await this.loadAutoCheckStatus();
    },

    loadSettings() {
      try {
        const saved = localStorage.getItem("cam-settings");
        if (saved) Object.assign(this.settings, JSON.parse(saved));
      } catch {
        // ignore
      }
    },

    saveSettings() {
      localStorage.setItem("cam-settings", JSON.stringify(this.settings));
    },

    loadPreferences() {
      try {
        const saved = localStorage.getItem("cam-preferences");
        if (saved) Object.assign(this.preferences, JSON.parse(saved));
      } catch {
        // ignore
      }
    },

    savePreferences() {
      localStorage.setItem("cam-preferences", JSON.stringify(this.preferences));
    },

    toggleDarkMode() {
      this.settings.darkMode = !this.settings.darkMode;
      this.applyTheme();
      this.saveSettings();
    },

    applyTheme() {
      if (this.settings.darkMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    },
  },
});
