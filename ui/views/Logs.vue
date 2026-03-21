<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useAppStore } from "../stores/app.js";
import { Trash2, Power, PowerOff, Copy, Check } from "lucide-vue-next";

const copied = ref(false);

const store = useAppStore();
const entries = ref([]);
const enabled = ref(false);
const logContainer = ref(null);
const autoScroll = ref(true);
const levelFilter = ref("all"); // "all" | "info" | "warn" | "error"

let cleanupEntry = null;
let cleanupCleared = null;

const filteredEntries = computed(() => {
  if (levelFilter.value === "all") return entries.value;
  return entries.value.filter(e => e.level === levelFilter.value);
});

const levelCounts = computed(() => {
  const counts = { info: 0, warn: 0, error: 0 };
  for (const e of entries.value) {
    if (counts[e.level] !== undefined) counts[e.level]++;
  }
  return counts;
});

onMounted(async () => {
  store.loadSettings();
  enabled.value = store.settings.enableLogging || false;
  entries.value = await window.api.getAllLogs();

  cleanupEntry = window.api.onLogEntry((entry) => {
    entries.value.push(entry);
    if (entries.value.length > 2000) {
      entries.value = entries.value.slice(-2000);
    }
    if (autoScroll.value) nextTick(() => scrollToBottom());
  });

  cleanupCleared = window.api.onLogCleared(() => {
    entries.value = [];
  });

  nextTick(() => scrollToBottom());
});

onUnmounted(() => {
  if (cleanupEntry) cleanupEntry();
  if (cleanupCleared) cleanupCleared();
});

function scrollToBottom() {
  const el = logContainer.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function toggleEnabled() {
  enabled.value = !enabled.value;
  store.settings.enableLogging = enabled.value;
  store.saveSettings();
  await window.api.setLoggingEnabled(enabled.value);
}

async function clearLogs() {
  await window.api.clearLogs();
  entries.value = [];
}

function copyAllLogs() {
  const text = filteredEntries.value
    .map(e => `[${formatTime(e.ts)}] [${e.level.toUpperCase()}] [${e.source}] ${e.msg}`)
    .join('\n');
  navigator.clipboard.writeText(text).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  });
}

function levelColor(level) {
  switch (level) {
    case "warn": return "text-amber-400";
    case "error": return "text-red-400";
    default: return "text-[#cdd6f4]";
  }
}

function levelBadge(level) {
  switch (level) {
    case "warn": return "bg-amber-500/15 text-amber-400";
    case "error": return "bg-red-500/15 text-red-400";
    default: return "bg-gray-500/15 text-gray-400";
  }
}

function sourceBadge(source) {
  return source === "renderer"
    ? "bg-blue-500/15 text-blue-400"
    : "bg-purple-500/15 text-purple-400";
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function handleScroll() {
  const el = logContainer.value;
  if (!el) return;
  autoScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}
</script>

<template>
  <div class="flex flex-col gap-4 h-full max-w-5xl mx-auto">
    <!-- Header -->
    <div class="flex-shrink-0 no-drag flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-black tracking-tight text-apple-text mb-1">运行日志 <span class="text-apple-textMuted font-medium tracking-normal text-2xl">Logs</span></h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          class="apple-btn-secondary flex items-center gap-1.5 text-sm"
          @click="clearLogs"
          :disabled="entries.length === 0"
        >
          <Trash2 class="w-3.5 h-3.5" />
          清空
        </button>
        <button
          class="apple-btn-secondary flex items-center gap-1.5 text-sm"
          @click="copyAllLogs"
          :disabled="filteredEntries.length === 0"
        >
          <Check v-if="copied" class="w-3.5 h-3.5 text-apple-success" />
          <Copy v-else class="w-3.5 h-3.5" />
          {{ copied ? '已复制' : '复制全部' }}
        </button>
        <button
          :class="[
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 shadow-sm',
            enabled
              ? 'bg-apple-success text-white hover:bg-green-600'
              : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
          ]"
          @click="toggleEnabled"
        >
          <Power v-if="enabled" class="w-4 h-4" />
          <PowerOff v-else class="w-4 h-4" />
          {{ enabled ? '记录中' : '已关闭' }}
        </button>
      </div>
    </div>

    <!-- Status bar + Level filter -->
    <div class="flex items-center gap-3 text-xs text-apple-textMuted bg-black/5 rounded-lg px-4 py-2">
      <div class="flex items-center gap-1.5">
        <div :class="['w-2 h-2 rounded-full', enabled ? 'bg-apple-success animate-pulse' : 'bg-gray-300']"></div>
        <span>{{ enabled ? '正在实时记录' : '日志记录已关闭' }}</span>
      </div>
      <!-- Level filter buttons -->
      <div class="flex items-center gap-1 ml-4">
        <button
          :class="['px-2.5 py-1 rounded-md font-bold transition-all text-[11px]', levelFilter === 'all' ? 'bg-white shadow-sm text-apple-text' : 'hover:bg-white/50 text-apple-textMuted']"
          @click="levelFilter = 'all'"
        >ALL <span class="opacity-50">{{ entries.length }}</span></button>
        <button
          :class="['px-2.5 py-1 rounded-md font-bold transition-all text-[11px]', levelFilter === 'info' ? 'bg-white shadow-sm text-gray-700' : 'hover:bg-white/50 text-apple-textMuted']"
          @click="levelFilter = 'info'"
        >INFO <span class="opacity-50">{{ levelCounts.info }}</span></button>
        <button
          :class="['px-2.5 py-1 rounded-md font-bold transition-all text-[11px]', levelFilter === 'warn' ? 'bg-amber-100 shadow-sm text-amber-700' : 'hover:bg-white/50 text-apple-textMuted']"
          @click="levelFilter = 'warn'"
        >WARN <span class="opacity-50">{{ levelCounts.warn }}</span></button>
        <button
          :class="['px-2.5 py-1 rounded-md font-bold transition-all text-[11px]', levelFilter === 'error' ? 'bg-red-100 shadow-sm text-red-700' : 'hover:bg-white/50 text-apple-textMuted']"
          @click="levelFilter = 'error'"
        >ERROR <span class="opacity-50">{{ levelCounts.error }}</span></button>
      </div>
      <span class="ml-auto font-bold text-apple-text">{{ filteredEntries.length }} 条</span>
    </div>

    <!-- Log entries -->
    <div
      ref="logContainer"
      class="flex-1 min-h-0 overflow-y-auto bg-[#1e1e2e] rounded-xl border border-apple-border/30 shadow-inner select-text cursor-text"
      @scroll="handleScroll"
    >
      <div v-if="filteredEntries.length === 0" class="flex items-center justify-center h-full text-gray-500 text-sm select-none py-20">
        {{ enabled ? '等待日志输出...' : '开启日志记录后，后台与前端的所有操作日志将在此实时显示' }}
      </div>
      <table v-else class="w-full text-[12px] font-mono leading-relaxed">
        <tbody>
          <tr
            v-for="(entry, i) in filteredEntries"
            :key="entry.ts + i"
            class="hover:bg-white/5 transition-colors border-b border-white/[0.03] last:border-0"
          >
            <td class="pl-3 pr-2 py-1 text-gray-500 whitespace-nowrap align-top w-[70px]">{{ formatTime(entry.ts) }}</td>
            <td class="px-1 py-1 align-top w-[50px]">
              <span :class="['inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase', levelBadge(entry.level)]">{{ entry.level }}</span>
            </td>
            <td class="px-1 py-1 align-top w-[56px]">
              <span :class="['inline-block px-1.5 py-0.5 rounded text-[10px] font-bold', sourceBadge(entry.source)]">{{ entry.source === 'renderer' ? 'UI' : 'MAIN' }}</span>
            </td>
            <td :class="['px-2 py-1 break-all whitespace-pre-wrap', levelColor(entry.level)]">{{ entry.msg }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
