<script setup>
import { ref, computed, onMounted } from "vue";
import { useAppStore } from "../stores/app.js";
import SwitchDialog from "../components/SwitchDialog.vue";
import { Download, RefreshCw, Search, Trash2, Copy, CheckCircle2, AlertCircle, ArrowRightCircle, Check, X, Fingerprint, Building2, LayoutGrid, LayoutList, ArrowDownUp, Key, Upload } from "lucide-vue-next";

const store = useAppStore();
const multipleSelection = ref(new Set());
const switchDialogVisible = ref(false);
const switchTarget = ref(null);
const refreshingSingle = ref(new Set());
const balanceFilter = ref("all");
const tokenDialogVisible = ref(false);
const tokenDetail = ref(null);
const searchQuery = ref("");
const viewMode = ref("full"); // 'full' | 'compact'
const sortBy = ref("email"); // 'email' | 'balance'
const copiedKeys = ref(new Set());

const allRows = computed(() => {
  // 仅显示 active 账号
  return store.activeAccounts.map((a) => {
    const totalUsed = (a.plan_used || 0) + (a.on_demand_used || 0);
    const totalLimit = (a.plan_limit || 0) + (a.on_demand_limit || 0);
    const hasData = a.on_demand_limit != null || a.plan_limit != null;
    const hasBalance = hasData && totalUsed < totalLimit;
    const balance = hasData ? +(totalLimit - totalUsed).toFixed(2) : null;
    const usagePercent = totalLimit > 0 ? Math.min(100, (totalUsed / totalLimit) * 100) : 0;
    const machineIdShort = a.machine_id ? a.machine_id.substring(0, 8) : null;
    return {
      ...a,
      totalUsed: +totalUsed.toFixed(2),
      totalLimit: +totalLimit.toFixed(2),
      hasData,
      hasBalance,
      balance,
      usagePercent,
      isCurrent: a.email === store.currentEmail,
      machineIdShort,
    };
  });
});

const tableData = computed(() => {
  let rows = allRows.value;
  const f = balanceFilter.value;
  if (f === "has") rows = rows.filter((r) => r.hasBalance);
  else if (f === "none") rows = rows.filter((r) => r.hasData && !r.hasBalance);
  else if (f === "unknown") rows = rows.filter((r) => !r.hasData);
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase();
    rows = rows.filter((r) => r.email.toLowerCase().includes(q));
  }
  if (sortBy.value === "balance") {
    rows = [...rows].sort((a, b) => (b.balance ?? -1) - (a.balance ?? -1));
  }
  return rows;
});

function toggleSort() {
  sortBy.value = sortBy.value === "balance" ? "email" : "balance";
}

const statsText = computed(() => {
  const total = allRows.value.length;
  const hasB = allRows.value.filter((r) => r.hasBalance).length;
  const noB = allRows.value.filter((r) => r.hasData && !r.hasBalance).length;
  const unknown = total - hasB - noB;
  return { total, hasB, noB, unknown };
});

function toggleSelect(email) {
  const s = new Set(multipleSelection.value);
  if (s.has(email)) s.delete(email);
  else s.add(email);
  multipleSelection.value = s;
}

async function handleRefreshSingle(row) {
  refreshingSingle.value.add(row.email);
  try {
    await window.api.refreshSingleAccount(row.email);
    await store.loadAccounts();
  } finally {
    refreshingSingle.value.delete(row.email);
  }
}

function handleUse(row) {
  switchTarget.value = row;
  switchDialogVisible.value = true;
}

async function handleConfirmSwitch({ resetMachineId = true } = {}) {
  switchDialogVisible.value = false;
  try {
    const t = switchTarget.value;
    const result = await store.switchAccount(
      {
        email: t.email,
        token: t.token,
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        membership_type: t.membership_type,
        stripe_customer_id: t.stripe_customer_id,
        team_id: t.team_id,
      },
      { resetMachineId }
    );
    if (result.success) {
      setTimeout(() => store.loadCurrentAuth(), 3000);
    }
  } catch { /* ignore */ }
}

async function handleRefreshAll() {
  await store.refreshAllAccounts();
}

async function handleDeleteBatch() {
  if (multipleSelection.value.size === 0) return;
  if (!confirm(`确定删除选中的 ${multipleSelection.value.size} 个账号？`)) return;
  const emails = [...multipleSelection.value];
  await window.api.removeAccounts(emails);
  multipleSelection.value = new Set();
  await store.loadAccounts();
}

// Add/Import moved to Onboarding page

function parseJwt(token) {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

function handleViewToken(row) {
  const webJwt = row.token ? decodeURIComponent(row.token).split("::")[1] : null;
  const webPayload = parseJwt(webJwt);
  const sessionPayload = parseJwt(row.access_token);
  tokenDetail.value = {
    email: row.email,
    cookie: row.token || null,
    accessToken: row.access_token || null,
    refreshToken: row.refresh_token || null,
    webJwtPayload: webPayload,
    sessionJwtPayload: sessionPayload,
    hasSessionToken: !!row.access_token,
  };
  tokenDialogVisible.value = true;
}

async function copyText(text, key) {
  await navigator.clipboard.writeText(text);
  copiedKeys.value.add(key);
  setTimeout(() => copiedKeys.value.delete(key), 2000);
}

async function handleExport() {
  try {
    const result = await window.api.exportFull();
    if (result.success) alert(`已导出 ${result.count} 个账号到文件`);
  } catch { /* ignore */ }
}

async function handleImportFile() {
  try {
    const result = await window.api.importFull();
    if (result.success) {
      alert(`已导入 ${result.count} 个账号`);
      await store.loadAccounts();
    }
  } catch (e) {
    alert("导入失败：" + e.message);
  }
}

function usageBarColorClasses(pct) {
  if (pct > 90) return "bg-apple-danger shadow-[0_0_8px_rgba(255,59,48,0.5)]";
  if (pct > 70) return "bg-apple-warning shadow-[0_0_8px_rgba(255,149,0,0.5)]";
  return "bg-apple-success shadow-[0_0_8px_rgba(52,199,89,0.5)]";
}

onMounted(async () => {
  await store.loadAccounts();
  await store.loadCurrentAuth();
});
</script>

<template>
  <div class="flex flex-col h-full gap-5 max-w-7xl mx-auto">
    <!-- Header Title & Description -->
    <div class="flex-shrink-0 no-drag">
      <h1 class="text-3xl font-black tracking-tight text-apple-text mb-1">活跃账号 <span class="text-apple-textMuted font-medium tracking-normal text-2xl">Active</span></h1>
    </div>

    <!-- Toolbar -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 no-drag bg-apple-card/50 backdrop-blur-md p-3 rounded-xl border border-apple-border/50">
      <div class="flex flex-wrap gap-2">
        <button class="apple-btn-secondary" @click="handleExport">
          <Download class="w-4 h-4 mr-1.5 text-apple-textMuted" /> 导出
        </button>
        <button class="apple-btn-secondary" @click="handleImportFile">
          <Upload class="w-4 h-4 mr-1.5 text-apple-textMuted" /> 导入
        </button>
        <button class="apple-btn-secondary" :disabled="store.refreshing" @click="handleRefreshAll">
          <RefreshCw :class="['w-4 h-4 mr-1.5 text-apple-textMuted', { 'animate-spin': store.refreshing }]" /> 刷新
        </button>
        <button :class="['apple-btn-secondary', sortBy === 'balance' ? '!bg-apple-accent/10 !text-apple-accent !border-apple-accent/30' : '']" @click="toggleSort">
          <ArrowDownUp class="w-4 h-4 mr-1.5" /> {{ sortBy === 'balance' ? '余额排序' : '默认排序' }}
        </button>
        <div class="flex bg-white/60 border border-apple-border rounded-lg overflow-hidden">
          <button :class="['px-2 py-1.5 transition-colors', viewMode === 'full' ? 'bg-apple-accent text-white' : 'text-apple-textMuted hover:bg-black/5']" @click="viewMode = 'full'" title="详细视图">
            <LayoutGrid class="w-4 h-4" />
          </button>
          <button :class="['px-2 py-1.5 transition-colors', viewMode === 'compact' ? 'bg-apple-accent text-white' : 'text-apple-textMuted hover:bg-black/5']" @click="viewMode = 'compact'" title="紧凑视图">
            <LayoutList class="w-4 h-4" />
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div class="relative w-48 group">
          <Search class="w-4 h-4 text-apple-textMuted absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-apple-accent transition-colors" />
          <input 
            class="w-full bg-white/70 border border-apple-border rounded-lg pl-9 pr-3 py-1.5 text-sm outline-none focus:border-apple-accent focus:ring-2 focus:ring-apple-accent/20 transition-all font-sans text-apple-text placeholder:text-apple-textMuted/60" 
            v-model="searchQuery" 
            placeholder="搜索邮箱..." 
          />
        </div>
        <button v-if="multipleSelection.size > 0" class="apple-btn bg-apple-danger text-white hover:bg-red-600 shadow-sm transition-all" @click="handleDeleteBatch">
          <Trash2 class="w-4 h-4 mr-1.5" /> 删除 ({{ multipleSelection.size }})
        </button>
      </div>
    </div>

    <!-- Filter Tabs -->
    <div class="flex gap-2 no-drag px-1">
      <button :class="['px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 border', balanceFilter === 'all' ? 'bg-apple-text text-white border-apple-text shadow-md' : 'bg-transparent text-apple-textMuted border-apple-border hover:bg-black/5']" @click="balanceFilter = 'all'">
        全部 ({{ statsText.total }})
      </button>
      <button :class="['px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 border', balanceFilter === 'has' ? 'bg-apple-success text-white border-apple-success shadow-md shadow-apple-success/30' : 'bg-transparent text-apple-success border-apple-success/30 hover:bg-apple-success/10']" @click="balanceFilter = 'has'">
        有余额 ({{ statsText.hasB }})
      </button>
      <button :class="['px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 border', balanceFilter === 'none' ? 'bg-apple-danger text-white border-apple-danger shadow-md shadow-apple-danger/30' : 'bg-transparent text-apple-danger border-apple-danger/30 hover:bg-apple-danger/10']" @click="balanceFilter = 'none'">
        无余额 ({{ statsText.noB }})
      </button>
      <button v-if="statsText.unknown > 0" :class="['px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 border', balanceFilter === 'unknown' ? 'bg-apple-textMuted text-white border-apple-textMuted shadow-md' : 'bg-transparent text-apple-textMuted border-apple-border hover:bg-black/5']" @click="balanceFilter = 'unknown'">
        未知 ({{ statsText.unknown }})
      </button>
    </div>

    <!-- Refresh progress -->
    <div v-if="store.refreshing && store.refreshProgress" class="no-drag flex flex-col gap-1.5 px-2">
      <div class="w-full h-1.5 bg-black/5 rounded-full overflow-hidden">
        <div class="h-full bg-apple-success transition-all duration-300" :style="{ width: Math.round((store.refreshProgress.current / store.refreshProgress.total) * 100) + '%' }"></div>
      </div>
      <span class="text-xs text-apple-textMuted font-medium tracking-wide">{{ store.refreshProgress.current }}/{{ store.refreshProgress.total }} {{ store.refreshProgress.email }}</span>
    </div>

    <!-- Compact View -->
    <div v-if="viewMode === 'compact'" class="flex-1 overflow-y-auto no-drag pb-6 pr-2 -mr-2">
      <div class="apple-glass rounded-xl overflow-hidden border border-apple-border/50">
        <div v-for="(row, idx) in tableData" :key="row.email"
          :class="[
            'flex items-center gap-3 px-4 py-2.5 transition-colors',
            idx > 0 ? 'border-t border-apple-border/30' : '',
            row.isCurrent ? 'bg-apple-success/5' : 'hover:bg-black/[0.02]'
          ]"
        >
          <!-- Current dot -->
          <div class="w-2 h-2 rounded-full flex-shrink-0" :class="row.isCurrent ? 'bg-apple-success shadow-[0_0_4px_rgba(52,199,89,0.6)]' : 'bg-transparent'"></div>
          <!-- Email -->
          <span class="text-sm font-medium text-apple-text truncate flex-1 min-w-0">{{ row.email }}</span>
          <!-- Balance -->
          <span v-if="row.hasData" :class="['text-sm font-black tabular-nums w-16 text-right flex-shrink-0', row.hasBalance ? 'text-apple-success' : 'text-apple-danger']">
            ${{ row.balance ?? 0 }}
          </span>
          <span v-else class="text-xs text-apple-textMuted w-16 text-right flex-shrink-0">--</span>
          <!-- Switch Button -->
          <button v-if="row.isCurrent" class="px-3 py-1 rounded-lg text-xs font-bold bg-apple-success/10 text-apple-success flex-shrink-0">
            使用中
          </button>
          <button v-else class="px-3 py-1 rounded-lg text-xs font-bold bg-apple-accent text-white hover:bg-apple-accent/90 transition-colors flex-shrink-0" @click.stop="handleUse(row)">
            切号
          </button>
        </div>
      </div>
      <!-- Empty State -->
      <div v-if="tableData.length === 0" class="py-12 flex flex-col items-center justify-center gap-3 text-apple-textMuted">
        <Search class="w-8 h-8 opacity-30" />
        <p class="text-sm font-medium">没有找到账号</p>
      </div>
    </div>

    <!-- Full Card Grid -->
    <div v-else class="flex-1 overflow-y-auto no-drag pb-6 pr-2 -mr-2">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <div
          v-for="row in tableData"
          :key="row.email"
          :class="[
            'apple-glass rounded-2xl p-4 flex flex-col gap-4 cursor-default relative overflow-hidden group transition-all duration-200',
            row.isCurrent ? 'border-l-4 border-l-apple-success shadow-md' : 'border-l-4 border-l-transparent',
            multipleSelection.has(row.email) ? 'bg-apple-accent/5 border-apple-accent' : ''
          ]"
          @click="toggleSelect(row.email)"
        >
          <!-- Current Account Indicator -->
          <div v-if="row.isCurrent" class="absolute top-0 right-0 px-2 py-0.5 bg-apple-success text-white text-[9px] font-black tracking-wider rounded-bl-lg">当前</div>

          <!-- Top Row -->
          <div class="flex items-start gap-3 relative z-10">
            <div class="pt-0.5">
              <input 
                type="checkbox" 
                :checked="multipleSelection.has(row.email)" 
                class="w-4 h-4 rounded-sm border-apple-border/80 text-apple-accent focus:ring-apple-accent/30 cursor-pointer accent-apple-accent" 
                @click.stop 
                @change="toggleSelect(row.email)" 
              />
            </div>
            
            <div class="flex-1 min-w-0 flex flex-col gap-1 text-left">
              <div class="flex items-center gap-1.5">
                <div v-if="row.isCurrent" class="w-2 h-2 rounded-full bg-apple-success shadow-[0_0_6px_rgba(52,199,89,0.8)] flex-shrink-0 animate-pulse"></div>
                <span class="text-sm font-bold text-apple-text truncate select-text" @click.stop>{{ row.email }}</span>
              </div>
              
              <div class="flex gap-1.5 flex-wrap mt-0.5">
                <span v-if="row.membership_type" :class="['px-1.5 py-0.5 rounded uppercase text-[9px] font-black tracking-wider', row.membership_type === 'free' ? 'bg-apple-danger/10 text-apple-danger' : row.membership_type === 'enterprise' ? 'bg-apple-success/10 text-apple-success' : 'bg-apple-warning/10 text-apple-warning']">
                  {{ row.membership_type }}
                </span>
                <span :class="['px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide flex items-center gap-1', row.token_valid ? 'bg-apple-success/10 text-apple-success' : 'bg-apple-danger/10 text-apple-danger']">
                  <CheckCircle2 v-if="row.token_valid" class="w-2.5 h-2.5" />
                  <AlertCircle v-else class="w-2.5 h-2.5" />
                  {{ row.token_valid ? '有效' : '失效' }}
                </span>
                <span v-if="row.access_token" class="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-blue-500/10 text-blue-600">SESSION</span>
                <span v-else class="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-black/5 text-apple-textMuted">WEB ONLY</span>
                <span v-if="row.machineIdShort" class="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-purple-500/10 text-purple-600 flex items-center gap-0.5">
                  <Fingerprint class="w-2.5 h-2.5" /> {{ row.machineIdShort }}
                </span>
                <span v-if="row.org_name" class="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-indigo-500/10 text-indigo-600 flex items-center gap-0.5">
                  <Building2 class="w-2.5 h-2.5" /> {{ row.org_name }}
                </span>
              </div>
            </div>
          </div>

          <!-- Usage Row -->
          <div v-if="row.hasData" class="flex flex-col gap-2 relative z-10 p-3 bg-white/40 rounded-xl border border-white/50">
            <div class="flex justify-between items-end">
              <div class="flex flex-col">
                <span class="text-[10px] font-semibold text-apple-textMuted uppercase tracking-wider mb-0.5">配额使用 / 全部</span>
                <span class="font-mono text-sm font-bold">${{ row.totalUsed }} <span class="text-apple-textMuted opacity-60 font-medium">/ ${{ row.totalLimit }}</span></span>
              </div>
              <span v-if="row.hasBalance" class="text-lg font-black text-apple-success">${{ row.balance }}</span>
              <span v-else class="text-xs font-bold text-apple-danger px-2 py-0.5 bg-apple-danger/10 rounded-full">无余额</span>
            </div>
            
            <div class="w-full h-1.5 bg-black/5 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-700 ease-out" :class="usageBarColorClasses(row.usagePercent)" :style="{ width: row.usagePercent + '%' }"></div>
            </div>
          </div>
          <div v-else class="flex flex-col justify-center items-center py-4 bg-white/30 rounded-xl border border-white/20 relative z-10 text-apple-textMuted">
            <span class="text-[11px] font-medium tracking-wide">暂无配额数据记录</span>
          </div>

          <!-- Actions Row -->
          <div class="flex justify-between items-center relative z-10 pt-1 border-t border-apple-border/40 mt-1">
            <div class="flex items-center gap-1">
              <button class="text-xs font-semibold text-apple-textMuted hover:text-apple-accent hover:bg-apple-accent/10 px-2.5 py-1.5 rounded-md transition-colors" @click.stop="handleViewToken(row)">
                查看 Token
              </button>
              <button 
                class="text-xs font-semibold text-apple-textMuted hover:text-orange-600 hover:bg-orange-500/10 px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1" 
                @click.stop="handleRefreshSingle(row)"
                :disabled="refreshingSingle.has(row.email)"
              >
                <RefreshCw :class="['w-3 h-3', { 'animate-spin': refreshingSingle.has(row.email) }]" />
                {{ refreshingSingle.has(row.email) ? '刷新中...' : '刷新' }}
              </button>
            </div>
            <button 
              v-if="row.token_valid" 
              class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-all shadow-sm active:scale-95" 
              :class="row.isCurrent ? 'bg-apple-success/10 text-apple-success hover:bg-apple-success/20' : 'bg-apple-accent text-white hover:bg-blue-600 hover:shadow-md'" 
              @click.stop="handleUse(row)">
              {{ row.isCurrent ? '使用中' : '连使用此号' }}
              <ArrowRightCircle v-if="!row.isCurrent" class="w-4 h-4" />
              <CheckCircle2 v-else class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="tableData.length === 0" class="col-span-full py-20 flex flex-col items-center justify-center gap-4 text-apple-textMuted border-2 border-dashed border-apple-border/50 rounded-2xl mx-2">
        <div class="w-16 h-16 rounded-full bg-black/5 flex items-center justify-center">
          <Search class="w-8 h-8 opacity-50" />
        </div>
        <div class="text-center">
          <p class="font-bold text-apple-text">没有找到账号</p>
          <p class="text-xs mt-1">尝试减轻过滤条件或者新导入一些账号。</p>
        </div>
        <button class="apple-btn-secondary mt-2" @click="balanceFilter = 'all'; searchQuery = ''">清除过滤</button>
      </div>
    </div>

    <!-- Switch Dialog -->
    <SwitchDialog v-model="switchDialogVisible" :account="switchTarget" @confirm="handleConfirmSwitch" />

    <!-- Add Dialog removed — moved to Onboarding page -->

    <!-- Token Detail Dialog (Re-styled modal) -->
    <Transition name="modal">
      <div v-if="tokenDialogVisible" class="fixed inset-0 z-50 flex items-center justify-center no-drag p-4 pl-[220px]">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-md" @click="tokenDialogVisible = false"></div>
        <div class="relative bg-apple-bg w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-apple-lg border border-white/50 flex flex-col overflow-hidden" v-motion :initial="{ opacity: 0, scale: 0.95, y: 10 }" :enter="{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', damping: 25 } }">
          <div class="px-6 py-4 border-b border-apple-border flex justify-between items-center bg-white/80 shrink-0">
            <h3 class="font-bold text-apple-text text-lg">Token 检查器</h3>
            <button class="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-apple-textMuted transition-colors" @click="tokenDialogVisible = false">
              <X class="w-5 h-5" />
            </button>
          </div>
          
          <div class="p-6 overflow-y-auto flex-1 bg-white/30" v-if="tokenDetail">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-10 h-10 rounded-full bg-apple-accent/10 flex items-center justify-center text-apple-accent"><Key class="w-5 h-5" /></div>
              <div class="text-xl font-black">{{ tokenDetail.email }}</div>
            </div>

            <div class="space-y-6">
              <!-- Session Token -->
              <div class="bg-white rounded-xl border border-apple-border p-4 shadow-sm">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-apple-text">Session Token (IDE 使用)</span>
                    <span :class="['px-2 py-0.5 rounded text-[10px] font-bold tracking-wide', tokenDetail.hasSessionToken ? 'bg-apple-success/10 text-apple-success' : 'bg-apple-danger/10 text-apple-danger']">
                      {{ tokenDetail.hasSessionToken ? '可用' : '缺失' }}
                    </span>
                  </div>
                  <button v-if="tokenDetail.accessToken" class="text-xs font-semibold text-apple-accent hover:bg-apple-accent/10 px-2.5 py-1 rounded transition-colors flex items-center gap-1.5" @click="copyText(tokenDetail.accessToken, 'access')">
                    <Check v-if="copiedKeys.has('access')" class="w-3.5 h-3.5 text-apple-success" />
                    <Copy v-else class="w-3.5 h-3.5" /> 
                    {{ copiedKeys.has('access') ? '已复制' : '复制' }}
                  </button>
                </div>
                
                <template v-if="tokenDetail.accessToken">
                  <div class="bg-black/5 p-3 rounded-lg font-mono text-[11px] text-apple-textMuted break-all overflow-hidden mb-3 border border-black/5 cursor-text select-text">
                    {{ tokenDetail.accessToken.substring(0, 180) }}{{ tokenDetail.accessToken.length > 180 ? '...' : '' }}
                  </div>
                  <div v-if="tokenDetail.sessionJwtPayload" class="flex flex-wrap gap-4 text-[11px] font-medium px-1">
                    <span class="text-apple-textMuted">Type: <span class="font-bold text-apple-text">{{ tokenDetail.sessionJwtPayload.type || '未知' }}</span></span>
                    <span class="text-apple-textMuted">Expires: <span class="font-bold text-apple-text">{{ new Date(tokenDetail.sessionJwtPayload.exp * 1000).toLocaleString() }}</span></span>
                  </div>
                </template>
                <div v-else class="text-sm font-medium text-apple-textMuted/60 px-1 py-2">需要使用网页 Cookie 重新签发获取此 Token。</div>
              </div>

              <!-- Web Cookie -->
              <div class="bg-white rounded-xl border border-apple-border p-4 shadow-sm">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-apple-text">Web Cookie (网页登录凭证)</span>
                    <span :class="['px-2 py-0.5 rounded text-[10px] font-bold tracking-wide', tokenDetail.cookie ? 'bg-apple-success/10 text-apple-success' : 'bg-apple-danger/10 text-apple-danger']">
                      {{ tokenDetail.cookie ? '可用' : '缺失' }}
                    </span>
                  </div>
                  <button v-if="tokenDetail.cookie" class="text-xs font-semibold text-apple-accent hover:bg-apple-accent/10 px-2.5 py-1 rounded transition-colors flex items-center gap-1.5" @click="copyText(tokenDetail.cookie, 'cookie')">
                    <Check v-if="copiedKeys.has('cookie')" class="w-3.5 h-3.5 text-apple-success" />
                    <Copy v-else class="w-3.5 h-3.5" /> 
                    {{ copiedKeys.has('cookie') ? '已复制' : '复制' }}
                  </button>
                </div>
                
                <template v-if="tokenDetail.cookie">
                  <div class="bg-black/5 p-3 rounded-lg font-mono text-[11px] text-apple-textMuted break-all overflow-hidden mb-3 border border-black/5 cursor-text select-text">
                    {{ tokenDetail.cookie.substring(0, 180) }}{{ tokenDetail.cookie.length > 180 ? '...' : '' }}
                  </div>
                  <div v-if="tokenDetail.webJwtPayload" class="flex flex-wrap gap-4 text-[11px] font-medium px-1">
                    <span class="text-apple-textMuted">Type: <span class="font-bold text-apple-text">{{ tokenDetail.webJwtPayload.type || '未知' }}</span></span>
                    <span class="text-apple-textMuted">Expires: <span class="font-bold text-apple-text">{{ new Date(tokenDetail.webJwtPayload.exp * 1000).toLocaleString() }}</span></span>
                  </div>
                </template>
                <div v-else class="text-sm font-medium text-apple-textMuted/60 px-1 py-2">未保存网页 Cookie 数据。</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Batch Login moved to Onboarding page -->
  </div>
</template>

<style scoped>
/* Transitive classes for the v-motion lists and modals */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.list-enter-active,
.list-leave-active,
.list-move {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.list-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
.list-leave-to {
  opacity: 0;
  transform: translateY(-20px) scale(0.95);
}
.list-leave-active {
  position: absolute;
}
</style>
