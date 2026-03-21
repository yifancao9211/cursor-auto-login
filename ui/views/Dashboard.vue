<script setup>
import { ref, computed, inject } from "vue";
import { useAppStore } from "../stores/app.js";
import { getBalance, parseJwt, buildSwitchPayload } from "../utils/account.js";
import { computeHealthScore } from "../utils/health-score.js";
import { RefreshCw, Zap, ShieldCheck, Mail, CreditCard, Activity, Users, CheckCircle2, DollarSign, XCircle, ArrowRightCircle, HeartPulse } from "lucide-vue-next";

const store = useAppStore();
const toast = inject("toast");
const refreshLoading = ref(false);
const switchLoading = ref(false);

const currentAccount = computed(() => {
  if (!store.currentEmail) return null;
  return store.accounts.find((a) => a.email === store.currentEmail);
});

const tokenExpiry = computed(() => {
  if (!store.currentAuth?.accessToken) return null;
  try {
    const payload = parseJwt(store.currentAuth.accessToken);
    if (!payload?.exp) return null;
    const exp = payload.exp * 1000;
    const remaining = exp - Date.now();
    if (remaining < 0) return { label: "已过期", type: "danger" };
    const days = Math.floor(remaining / 86400000);
    if (days > 0) return { label: `${days}天`, type: "success" };
    const hours = Math.floor(remaining / 3600000);
    if (hours > 0) return { label: `${hours}小时`, type: "warning" };
    return { label: `${Math.ceil(remaining / 60000)}分钟`, type: "danger" };
  } catch {
    return null;
  }
});

const currentBalance = computed(() => {
  const a = currentAccount.value;
  if (!a) return { totalUsed: 0, totalLimit: 0, usagePercent: 0 };
  return getBalance(a);
});

const totalUsed = computed(() => currentBalance.value.totalUsed);
const totalLimit = computed(() => currentBalance.value.totalLimit);
const usagePercent = computed(() => currentBalance.value.usagePercent);

const usageColorClasses = computed(() => {
  if (usagePercent.value > 90) return "bg-apple-danger shadow-[0_0_12px_rgba(255,59,48,0.5)]";
  if (usagePercent.value > 70) return "bg-apple-warning shadow-[0_0_12px_rgba(255,149,0,0.5)]";
  return "bg-apple-success shadow-[0_0_12px_rgba(52,199,89,0.5)]";
});

const stats = computed(() => {
  const total = store.accounts.length;
  const valid = store.validAccounts.length;
  const withBalance = store.accountsWithBalance.length;
  const failed = store.accounts.filter(a => !a.token_valid).length;
  return { total, valid, withBalance, failed };
});

const health = computed(() => computeHealthScore(store.accounts));

const bestAccounts = computed(() => {
  return store.accounts
    .filter(a => a.token_valid)
    .map(a => ({ ...a, ...getBalance(a) }))
    .filter(a => a.hasBalance)
    .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
    .slice(0, 5);
});

async function handleRefresh() {
  refreshLoading.value = true;
  try {
    await store.refreshAllAccounts();
    await store.loadCurrentAuth();
    toast.value?.show("数据刷新完成", "success");
  } catch (e) {
    toast.value?.show("刷新失败: " + e.message, "error");
  }
  refreshLoading.value = false;
}

async function handleSmartSwitch() {
  switchLoading.value = true;
  try {
    const result = await store.smartSwitch();
    if (result.success) {
      toast.value?.show("已切换到最优账号", "success");
      await store.loadCurrentAuth();
    } else {
      toast.value?.show(result.reason === "current_has_balance" ? "当前账号仍有余额，无需切换" : "没有可用的备选账号", "warning");
    }
  } catch (e) {
    toast.value?.show("智能切号失败: " + e.message, "error");
  }
  switchLoading.value = false;
}

function quickSwitch(acc) {
  store.switchAccount(buildSwitchPayload(acc), { resetMachineId: true }).then(result => {
    if (result.success) {
      toast.value?.show("已切换到 " + acc.email, "success");
      setTimeout(() => store.loadCurrentAuth(), 3000);
    }
  });
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-5xl mx-auto">
    <!-- Header Title -->
    <div class="flex items-center justify-between no-drag">
      <h1 class="text-3xl font-black tracking-tight text-apple-text">仪表盘 <span class="text-apple-textMuted font-medium tracking-normal text-2xl">Overview</span></h1>
      
      <div class="flex items-center gap-3">
        <button class="apple-btn-secondary" :disabled="refreshLoading" @click="handleRefresh">
          <RefreshCw :class="['w-4 h-4 mr-2', { 'animate-spin': refreshLoading }]" />
          刷新数据
        </button>
        <button class="apple-btn-primary group" :disabled="switchLoading" @click="handleSmartSwitch">
          <Zap :class="['w-4 h-4 mr-2 group-hover:text-yellow-300 transition-colors', { 'animate-pulse text-yellow-300': switchLoading }]" />
          智能切号
        </button>
      </div>
    </div>

    <!-- Hero Card (Current Account) -->
    <div class="apple-glass rounded-2xl p-6 relative overflow-hidden group">
      <!-- Decorative Gradient Blob -->
      <div class="absolute -top-24 -right-24 w-64 h-64 bg-apple-accent/10 rounded-full blur-3xl group-hover:bg-apple-accent/20 transition-all duration-700"></div>

      <div class="flex flex-col md:flex-row gap-8 relative z-10">
        <!-- User Info -->
        <div class="flex flex-col justify-between flex-1 gap-6">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center">
              <ShieldCheck class="w-5 h-5 text-apple-accent" />
            </div>
            <div>
              <h2 class="text-lg font-bold">当前生效账号</h2>
              <p class="text-xs text-apple-textMuted">正在供 Cursor IDE 使用的配置</p>
            </div>
          </div>

          <div class="space-y-4">
            <div class="flex items-center gap-4">
              <div class="w-8 flex justify-center"><Mail class="w-4 h-4 text-apple-textMuted" /></div>
              <div class="flex-1 text-sm font-semibold truncate">{{ store.currentEmail || "未登录" }}</div>
            </div>
            
            <div class="flex items-center gap-4">
              <div class="w-8 flex justify-center"><CreditCard class="w-4 h-4 text-apple-textMuted" /></div>
              <div class="flex-1 flex gap-2">
                <span v-if="currentAccount?.membership_type" 
                      :class="['px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase', 
                              currentAccount.membership_type === 'free' ? 'bg-apple-danger/10 text-apple-danger' : 'bg-apple-success/10 text-apple-success']">
                  {{ currentAccount.membership_type }}
                </span>
                <span v-else class="text-sm text-apple-textMuted">未知</span>
              </div>
            </div>

            <div class="flex items-center gap-4">
              <div class="w-8 flex justify-center"><Activity class="w-4 h-4 text-apple-textMuted" /></div>
              <div class="flex-1 flex gap-2">
                <span v-if="tokenExpiry" 
                      :class="['px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide', 
                              tokenExpiry.type === 'danger' ? 'bg-apple-danger/10 text-apple-danger' : 
                              tokenExpiry.type === 'warning' ? 'bg-apple-warning/10 text-apple-warning' : 
                              'bg-apple-success/10 text-apple-success']">
                  {{ tokenExpiry.label }}
                </span>
                <span v-else class="text-sm text-apple-textMuted">无 Token 或已失效</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Quota Progress -->
        <div class="flex-1 flex flex-col justify-center border-t md:border-t-0 md:border-l border-apple-border/50 pt-6 md:pt-0 md:pl-8">
          <template v-if="totalLimit > 0">
            <div class="flex justify-between items-end mb-3">
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-wider text-apple-textMuted mb-1">配额使用情况</h3>
                <div class="text-2xl font-black">${{ totalUsed }} <span class="text-base text-apple-textMuted font-medium">/ ${{ totalLimit }}</span></div>
              </div>
              <div class="text-xs font-bold" :class="usagePercent > 90 ? 'text-apple-danger' : usagePercent > 70 ? 'text-apple-warning' : 'text-apple-success'">
                {{ Math.round(usagePercent) }}%
              </div>
            </div>

            <div class="w-full h-2.5 bg-black/5 rounded-full overflow-hidden mb-3 p-[1.5px]">
              <div class="h-full rounded-full transition-all duration-1000 ease-out" 
                   :class="usageColorClasses" 
                   :style="{ width: usagePercent + '%' }"></div>
            </div>

            <div class="flex justify-between text-[11px] text-apple-textMuted font-medium">
              <span>Plan: ${{ currentAccount?.plan_used ?? 0 }}/${{ currentAccount?.plan_limit ?? 0 }}</span>
              <span>OnDemand: ${{ currentAccount?.on_demand_used ?? 0 }}/${{ currentAccount?.on_demand_limit ?? 0 }}</span>
            </div>
          </template>
          <template v-else>
            <div class="h-full flex flex-col items-center justify-center text-apple-textMuted space-y-3 opacity-60">
              <Activity class="w-8 h-8" />
              <span class="text-sm font-medium">暂无配额数据</span>
            </div>
          </template>
        </div>
      </div>

      <!-- Refresh Progress Overlay (Bottom Edge) -->
      <div v-if="store.refreshing && store.refreshProgress" class="absolute bottom-0 left-0 w-full h-1 bg-black/5">
        <div class="h-full bg-apple-accent transition-all duration-300" 
             :style="{ width: Math.round((store.refreshProgress.current / store.refreshProgress.total) * 100) + '%' }"></div>
      </div>
    </div>

    <!-- Health Score + Stats Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <div class="apple-glass rounded-xl p-5 flex flex-col gap-3 items-center justify-center text-center">
        <div :class="['w-14 h-14 rounded-full flex items-center justify-center text-xl font-black border-4', 
          health.score >= 90 ? 'border-apple-success/30 text-apple-success bg-apple-success/10' : 
          health.score >= 60 ? 'border-apple-warning/30 text-apple-warning bg-apple-warning/10' : 
          'border-apple-danger/30 text-apple-danger bg-apple-danger/10'
        ]">
          {{ health.grade }}
        </div>
        <div>
          <div class="text-2xl font-black tabular-nums">{{ health.score }}</div>
          <div class="text-xs font-medium text-apple-textMuted">健康度</div>
        </div>
      </div>
      <div class="apple-glass rounded-xl p-5 flex flex-col gap-3">
        <div class="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
          <Users class="w-5 h-5" />
        </div>
        <div>
          <div class="text-3xl font-black tabular-nums">{{ stats.total }}</div>
          <div class="text-xs font-medium text-apple-textMuted">总账号记录</div>
        </div>
      </div>
      
      <div class="apple-glass rounded-xl p-5 flex flex-col gap-3">
        <div class="w-10 h-10 rounded-full bg-apple-success/10 flex items-center justify-center text-apple-success">
          <CheckCircle2 class="w-5 h-5" />
        </div>
        <div>
          <div class="text-3xl font-black tabular-nums">{{ stats.valid }}</div>
          <div class="text-xs font-medium text-apple-textMuted">Token 有效可用</div>
        </div>
      </div>

      <div class="apple-glass rounded-xl p-5 flex flex-col gap-3">
        <div class="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-500">
          <DollarSign class="w-5 h-5" />
        </div>
        <div>
          <div class="text-3xl font-black tabular-nums">{{ stats.withBalance }}</div>
          <div class="text-xs font-medium text-apple-textMuted">剩余有效额度</div>
        </div>
      </div>

      <div class="apple-glass rounded-xl p-5 flex flex-col gap-3">
        <div class="w-10 h-10 rounded-full bg-apple-danger/10 flex items-center justify-center text-apple-danger">
          <XCircle class="w-5 h-5" />
        </div>
        <div>
          <div class="text-3xl font-black tabular-nums">{{ stats.failed }}</div>
          <div class="text-xs font-medium text-apple-textMuted">Token 已失效</div>
        </div>
      </div>
    </div>

    <!-- Best Accounts -->
    <div v-if="bestAccounts.length > 0" class="flex flex-col gap-4">
      <h3 class="text-sm font-bold uppercase tracking-wider text-apple-textMuted pl-1">最优备选账号推荐</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <div v-for="acc in bestAccounts" :key="acc.email" 
             class="apple-glass rounded-xl p-4 flex flex-col justify-between gap-4 transition-transform hover:-translate-y-1">
          <div class="flex max-w-full justify-between items-start">
            <div class="flex items-center gap-2">
              <div :class="['w-2 h-2 rounded-full', acc.email === store.currentEmail ? 'bg-apple-success shadow-[0_0_6px_rgba(52,199,89,0.8)]' : 'bg-apple-border']"></div>
              <span class="text-xs font-semibold truncate">{{ acc.email.split('@')[0] }}<span class="text-apple-textMuted opacity-50">@{{ acc.email.split('@')[1] }}</span></span>
            </div>
          </div>
          <div class="flex items-end justify-between">
            <div class="flex flex-col">
              <span v-if="acc.membership_type" :class="['text-[10px] font-bold uppercase tracking-wide', acc.membership_type === 'free' ? 'text-apple-danger' : 'text-apple-success']">{{ acc.membership_type }}</span>
              <span class="text-lg font-black">${{ acc.balance }}</span>
            </div>
            <ArrowRightCircle v-if="acc.email === store.currentEmail" class="w-5 h-5 text-apple-success opacity-50" />
            <button v-else @click="quickSwitch(acc)" class="w-6 h-6 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center transition-colors text-apple-text" title="切换到此号">
              <ArrowRightCircle class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>
