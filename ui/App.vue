<script setup>
import { ref } from "vue";
import Dashboard from "./views/Dashboard.vue";
import Accounts from "./views/Accounts.vue";
import Onboarding from "./views/Onboarding.vue";
import Settings from "./views/Settings.vue";
import { LayoutDashboard, Users, PackagePlus, Settings as SettingsIcon, Hexagon } from "lucide-vue-next";

const activeTab = ref("dashboard");

const tabs = [
  { key: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { key: "accounts", label: "账号", icon: Users },
  { key: "onboarding", label: "入库", icon: PackagePlus },
  { key: "settings", label: "设置", icon: SettingsIcon },
];
</script>

<template>
  <div class="flex h-screen w-full bg-apple-bg overflow-hidden text-apple-text">
    <!-- macOS Window Drag Strip (invisible, sits on top) -->
    <div class="drag-region absolute top-0 left-0 w-full h-7 z-50"></div>

    <!-- Sidebar -->
    <aside class="w-64 flex flex-col pt-12 pb-4 px-3 bg-apple-sidebar/80 backdrop-blur-3xl border-r border-apple-border/50 shadow-sm relative z-40">
      
      <!-- Brand -->
      <div class="px-3 mb-6 flex items-center gap-3 no-drag">
        <div class="w-8 h-8 rounded-xl bg-apple-accent/10 flex items-center justify-center text-apple-accent shadow-sm">
          <Hexagon class="w-5 h-5 fill-current" />
        </div>
        <div class="flex flex-col">
          <span class="text-sm font-semibold tracking-tight leading-tight">Cursor Manager</span>
          <span class="text-[10px] text-apple-textMuted font-medium tracking-wider uppercase">Pro Edition</span>
        </div>
      </div>

      <!-- Navigation -->
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

      <!-- Sidebar Footer Stats -->
      <div class="mt-auto px-3 py-3 rounded-xl bg-black/5 text-xs text-apple-textMuted flex items-center justify-between no-drag">
        <span>Version 2.0.0</span>
        <div class="w-2 h-2 rounded-full bg-apple-success shadow-[0_0_8px_rgba(52,199,89,0.6)]"></div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 flex flex-col relative z-30 overflow-hidden bg-apple-bg">
      <div class="flex-1 overflow-y-auto no-drag">
        <Transition name="fade-slide" mode="out-in">
          <div :key="activeTab" class="h-full w-full p-8 pb-12">
            <Dashboard v-if="activeTab === 'dashboard'" />
            <Accounts v-if="activeTab === 'accounts'" />
            <Onboarding v-if="activeTab === 'onboarding'" />
            <Settings v-if="activeTab === 'settings'" />
          </div>
        </Transition>
      </div>
    </main>
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
