<script setup>
import { ref, onMounted, computed } from "vue";
import { useAppStore } from "../stores/app.js";
import { KeyRound, Layers, HardDrive, Cpu, ShieldCheck, Activity, Timer, PlayCircle } from "lucide-vue-next";

const store = useAppStore();

const form = ref({
  batchPassword: "",
  concurrency: 3,
  autoCheckMinutes: 30,
});

const runningAutoCheck = ref(false);

onMounted(async () => {
  store.loadSettings();
  await store.loadAutoCheckStatus();
  form.value = {
    batchPassword: store.settings.batchPassword,
    concurrency: store.settings.concurrency,
    autoCheckMinutes: store.settings.autoCheckMinutes || 30,
  };
});

function handleSave() {
  Object.assign(store.settings, form.value);
  store.saveSettings();
  store.setAutoCheckInterval(form.value.autoCheckMinutes);
  alert("设置已保存！");
}

async function viewCurrentAuth() {
  await store.loadCurrentAuth();
}

function adjustConcurrency(delta) {
  const next = form.value.concurrency + delta;
  if (next >= 1 && next <= 10) form.value.concurrency = next;
}

function adjustAutoCheck(delta) {
  const next = form.value.autoCheckMinutes + delta;
  if (next >= 5 && next <= 120) form.value.autoCheckMinutes = next;
}

async function runNow() {
  runningAutoCheck.value = true;
  try {
    await window.api.runAutoCheckNow();
    await store.loadAutoCheckStatus();
    await store.loadAccounts();
  } finally {
    runningAutoCheck.value = false;
  }
}

const lastCheckLabel = computed(() => {
  if (!store.autoCheckStatus?.lastCheckTime) return "从未";
  return new Date(store.autoCheckStatus.lastCheckTime).toLocaleString();
});
</script>

<template>
  <div class="flex flex-col gap-6 max-w-3xl mx-auto pb-10">
    <!-- Header -->
    <div class="flex-shrink-0 no-drag mb-2">
      <h1 class="text-3xl font-black tracking-tight text-apple-text mb-1">全局设置 <span class="text-apple-textMuted font-medium tracking-normal text-2xl">Settings</span></h1>
    </div>

    <!-- Batch Login Settings -->
    <div class="apple-glass rounded-2xl overflow-hidden flex flex-col no-drag">
      <div class="px-6 py-4 flex items-center gap-3 bg-white/40 border-b border-apple-border/50">
        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-600">
          <Layers class="w-4 h-4" />
        </div>
        <h3 class="font-bold text-apple-text">批量任务配置</h3>
      </div>
      <div class="p-6 flex flex-col gap-6 bg-white/20">
        <!-- Password Row -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="flex flex-col gap-1">
            <span class="font-bold text-sm text-apple-text">自动化统一密码</span>
            <span class="text-xs text-apple-textMuted">填入所有 Cursor 账号(如果是同一密码)的登录密码。</span>
          </div>
          <div class="relative w-full md:w-64 group">
            <KeyRound class="w-4 h-4 text-apple-textMuted absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-apple-accent transition-colors" />
            <input
              class="w-full bg-white border border-apple-border rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-apple-accent focus:ring-2 focus:ring-apple-accent/20 transition-all font-sans"
              type="password"
              v-model="form.batchPassword"
              placeholder="请输入密码"
            />
          </div>
        </div>
        
        <div class="h-px w-full bg-apple-border/50"></div>

        <!-- Concurrency Row -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="flex flex-col gap-1">
            <span class="font-bold text-sm text-apple-text">并行窗口数量</span>
            <span class="text-xs text-apple-textMuted">设置 Playwright 同时启动的无头浏览器窗口数 (推荐 1-5)。</span>
          </div>
          <div class="flex items-center bg-white border border-apple-border rounded-lg overflow-hidden shadow-sm">
            <button class="w-10 h-9 flex items-center justify-center bg-black/5 hover:bg-black/10 transition-colors text-apple-text font-bold disabled:opacity-30 disabled:hover:bg-black/5" @click="adjustConcurrency(-1)" :disabled="form.concurrency <= 1">−</button>
            <input class="w-12 h-9 text-center text-sm font-bold bg-transparent outline-none pointer-events-none" type="text" :value="form.concurrency" readonly />
            <button class="w-10 h-9 flex items-center justify-center bg-black/5 hover:bg-black/10 transition-colors text-apple-text font-bold disabled:opacity-30 disabled:hover:bg-black/5" @click="adjustConcurrency(1)" :disabled="form.concurrency >= 10">+</button>
          </div>
        </div>

        <div class="pt-4 flex justify-end">
          <button class="apple-btn-primary px-8" @click="handleSave">保存配置</button>
        </div>
      </div>
    </div>

    <!-- Auto Check Config -->
    <div class="apple-glass rounded-2xl overflow-hidden flex flex-col no-drag">
      <div class="px-6 py-4 flex items-center gap-3 bg-white/40 border-b border-apple-border/50">
        <div class="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-600">
          <Timer class="w-4 h-4" />
        </div>
        <h3 class="font-bold text-apple-text">定时巡检</h3>
      </div>
      <div class="p-6 flex flex-col gap-6 bg-white/20">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="flex flex-col gap-1">
            <span class="font-bold text-sm text-apple-text">巡检间隔 (分钟)</span>
            <span class="text-xs text-apple-textMuted">每隔 N 分钟自动检查所有账号 Token 和余额 (每个账号间隔随机 1-5 秒)。</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center bg-white border border-apple-border rounded-lg overflow-hidden shadow-sm">
              <button class="w-10 h-9 flex items-center justify-center bg-black/5 hover:bg-black/10 transition-colors text-apple-text font-bold disabled:opacity-30" @click="adjustAutoCheck(-5)" :disabled="form.autoCheckMinutes <= 5">−</button>
              <input class="w-14 h-9 text-center text-sm font-bold bg-transparent outline-none pointer-events-none" type="text" :value="form.autoCheckMinutes" readonly />
              <button class="w-10 h-9 flex items-center justify-center bg-black/5 hover:bg-black/10 transition-colors text-apple-text font-bold disabled:opacity-30" @click="adjustAutoCheck(5)" :disabled="form.autoCheckMinutes >= 120">+</button>
            </div>
            <button class="apple-btn-secondary !text-orange-600 border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/10 flex items-center gap-1.5" :disabled="runningAutoCheck" @click="runNow">
              <PlayCircle :class="['w-4 h-4', { 'animate-spin': runningAutoCheck }]" />
              {{ runningAutoCheck ? '巡检中...' : '立即巡检' }}
            </button>
          </div>
        </div>
        <div class="flex items-center gap-4 text-xs text-apple-textMuted bg-black/5 rounded-lg px-4 py-2.5">
          <span>上次巡检: <span class="font-bold text-apple-text">{{ lastCheckLabel }}</span></span>
          <span v-if="store.autoCheckStatus?.running" class="flex items-center gap-1 text-apple-success font-bold">
            <div class="w-1.5 h-1.5 rounded-full bg-apple-success animate-pulse"></div> 运行中
          </span>
        </div>
      </div>
    </div>

    <!-- Cursor App Status -->
    <div class="apple-glass rounded-2xl overflow-hidden flex flex-col no-drag">
      <div class="px-6 py-4 flex items-center gap-3 bg-white/40 border-b border-apple-border/50">
        <div class="w-8 h-8 rounded-lg bg-apple-success/10 flex items-center justify-center text-apple-success">
          <Cpu class="w-4 h-4" />
        </div>
        <h3 class="font-bold text-apple-text">本地 IDE 注入状态</h3>
      </div>
      <div class="p-6 flex flex-col gap-6 bg-white/20">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="flex flex-col gap-1">
            <span class="font-bold text-sm text-apple-text">当前活跃绑定的邮箱</span>
            <span class="text-xs text-apple-textMuted">目前注入到 Cursor 数据库中的账号</span>
          </div>
          <div class="flex items-center gap-3 bg-white px-4 py-2 rounded-lg border border-apple-border shadow-sm">
            <div class="flex items-center gap-2">
              <div :class="['w-2 h-2 rounded-full shadow-sm', store.currentEmail ? 'bg-apple-success shadow-apple-success/50' : 'bg-apple-danger shadow-apple-danger/50']"></div>
              <span class="text-sm font-bold" :class="store.currentEmail ? 'text-apple-text' : 'text-apple-danger'">
                {{ store.currentEmail || "未绑定" }}
              </span>
            </div>
            <div class="w-px h-4 bg-apple-border ml-2"></div>
            <button class="text-xs font-bold text-apple-accent hover:text-blue-600 transition-colors flex items-center gap-1" @click="viewCurrentAuth">
              <Activity class="w-3.5 h-3.5" /> 检测
            </button>
          </div>
        </div>
        
        <div class="flex flex-col gap-2">
          <span class="font-bold text-sm text-apple-text">目标 SQLite 数据库路径</span>
          <div class="bg-black/5 rounded-lg border border-apple-border/50 p-3 font-mono text-[11px] text-apple-textMuted flex items-center gap-2 cursor-text select-text overflow-hidden">
            <HardDrive class="w-4 h-4 flex-shrink-0 opacity-50" />
            <span class="break-all">~/Library/Application Support/Cursor/User/globalStorage/state.vscdb</span>
          </div>
        </div>
      </div>
    </div>

    <!-- About App -->
    <div class="mt-4 flex flex-col items-center justify-center text-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
      <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-300 shadow-sm flex items-center justify-center text-gray-700 border border-white/50">
        <ShieldCheck class="w-6 h-6" />
      </div>
      <div>
        <h4 class="font-bold tracking-tight text-apple-text">Cursor Account Manager</h4>
        <p class="text-[10px] text-apple-textMuted uppercase tracking-widest mt-0.5">Version 1.0.0 (Apple 2026 Edition)</p>
      </div>
      <p class="text-xs text-apple-textMuted max-w-xs mt-2 font-medium">设计用于无缝管理 Cursor IDE 多账号配额与无痛切换体验。</p>
    </div>
  </div>
</template>
