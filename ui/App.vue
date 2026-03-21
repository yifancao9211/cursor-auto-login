<script setup>
import { ref, computed, onMounted, provide } from "vue";
import Dashboard from "./views/Dashboard.vue";
import Accounts from "./views/Accounts.vue";
import Onboarding from "./views/Onboarding.vue";
import Settings from "./views/Settings.vue";
import Logs from "./views/Logs.vue";
import Toast from "./components/Toast.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import { useAppStore } from "./stores/app.js";
import { LayoutDashboard, Users, PackagePlus, Settings as SettingsIcon, Hexagon, ScrollText, Moon, Sun } from "lucide-vue-next";

const store = useAppStore();
const activeTab = ref("dashboard");
const toastRef = ref(null);
const confirmRef = ref(null);

provide("toast", toastRef);
provide("confirm", confirmRef);

const viewComponents = {
  dashboard: Dashboard,
  accounts: Accounts,
  onboarding: Onboarding,
  logs: Logs,
  settings: Settings,
};
const currentView = computed(() => viewComponents[activeTab.value]);

onMounted(async () => {
  store.loadSettings();
  store.loadPreferences();
  store.applyTheme();
  await store.loadAccounts();
  store.loadCurrentAuth();

  try {
    await window.api.updateScheduleSettings({
      orgDiscoveryEnabled: store.settings.orgDiscoveryEnabled !== false,
      retryFailedEnabled: store.settings.retryFailedEnabled || false,
      retryFailedTime: store.settings.retryFailedTime || "00:00",
      enableLogging: store.settings.enableLogging || false,
      autoCheckMinutes: store.settings.autoCheckMinutes || 30,
      webhookEnabled: store.settings.webhookEnabled || false,
      webhookType: store.settings.webhookType || "discord",
      webhookUrl: store.settings.webhookUrl || "",
      feishuAppId: store.settings.feishuAppId || "",
      feishuAppSecret: store.settings.feishuAppSecret || "",
      feishuChatId: store.settings.feishuChatId || "",
    });
  } catch (e) {
    console.warn("[App] Failed to sync schedule settings:", e.message);
  }
});

const tabs = [
  { key: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { key: "accounts", label: "账号", icon: Users },
  { key: "onboarding", label: "入库", icon: PackagePlus },
  { key: "logs", label: "日志", icon: ScrollText },
  { key: "settings", label: "设置", icon: SettingsIcon },
];
</script>

<template>
  <div class="flex h-screen w-full bg-apple-bg overflow-hidden text-apple-text">
    <div class="drag-region absolute top-0 left-0 right-0 h-7 z-50"></div>

    <!-- Sidebar -->
    <aside class="w-64 flex flex-col pt-12 pb-4 px-3 bg-apple-sidebar/80 backdrop-blur-3xl border-r border-apple-border/50 shadow-sm relative z-40">
      
      <div class="px-3 mb-6 flex items-center gap-3 no-drag">
        <div class="w-8 h-8 rounded-xl bg-apple-accent/10 flex items-center justify-center text-apple-accent shadow-sm">
          <Hexagon class="w-5 h-5 fill-current" />
        </div>
        <div class="flex flex-col">
          <span class="text-sm font-semibold tracking-tight leading-tight">Cursor Manager</span>
          <span class="text-[10px] text-apple-textMuted font-medium tracking-wider uppercase">Pro Edition</span>
        </div>
      </div>

      <nav class="flex-1 flex flex-col gap-1 no-drag">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          @click="activeTab = tab.key"
          :class="[
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 outline-none select-none',
            activeTab === tab.key 
              ? 'bg-apple-accent text-white shadow-sm' 
              : 'text-apple-textMuted hover:bg-black/5 hover:text-apple-text'
          ]"
        >
          <component :is="tab.icon" class="w-4 h-4" :stroke-width="activeTab === tab.key ? 2.5 : 2" />
          {{ tab.label }}
        </button>
      </nav>

      <div class="mt-auto flex flex-col gap-2 no-drag">
        <button 
          @click="store.toggleDarkMode()" 
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-apple-textMuted hover:bg-black/5 hover:text-apple-text transition-all"
        >
          <Moon v-if="!store.settings.darkMode" class="w-4 h-4" />
          <Sun v-else class="w-4 h-4" />
          {{ store.settings.darkMode ? '浅色模式' : '深色模式' }}
        </button>
        <div class="px-3 py-3 rounded-xl bg-black/5 text-xs text-apple-textMuted flex items-center justify-between">
          <span>v3.3.0</span>
          <div class="w-2 h-2 rounded-full bg-apple-success shadow-[0_0_8px_rgba(52,199,89,0.6)]"></div>
        </div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 flex flex-col relative z-30 overflow-hidden bg-apple-bg">
      <div class="flex-1 overflow-y-auto no-drag p-8 pb-12">
        <Transition name="fade-slide" mode="out-in">
          <KeepAlive>
            <component :is="currentView" :key="activeTab" />
          </KeepAlive>
        </Transition>
      </div>
    </main>

    <Toast ref="toastRef" />
    <ConfirmDialog ref="confirmRef" />
  </div>
</template>

<style>
/* Vue Transitions for route change */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.99);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.99);
}
</style>
