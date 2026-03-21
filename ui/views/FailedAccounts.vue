<script setup>
import { ref, computed, onMounted } from "vue";
import { useAppStore } from "../stores/app.js";
import { RefreshCw, Trash2, AlertTriangle, ShieldAlert, BadgeInfo, Ban, RotateCcw, Key } from "lucide-vue-next";

const store = useAppStore();
const retryingAll = ref(false);
const retryingSet = ref(new Set());

const failedAccounts = computed(() =>
  store.accounts.filter(a => a.account_status === "failed" || (!a.token_valid && a.account_status !== "active" && a.account_status !== "new" && a.account_status !== "disabled"))
);

async function retrySingle(email) {
  if (retryingSet.value.has(email)) return;
  retryingSet.value.add(email);
  try {
    const pwd = store.settings.batchPassword || "abcd@1234";
    const result = await window.api.singleLogin({ email, password: pwd });
    if (result.success && result.token) {
      const data = { email, token: result.token };
      if (result.accessToken) data.access_token = result.accessToken;
      if (result.refreshToken) data.refresh_token = result.refreshToken;
      await window.api.upsertAccount(data);
      await store.loadAccounts();
    }
  } catch { /* ignore */ }
  retryingSet.value.delete(email);
}

async function retryAll() {
  retryingAll.value = true;
  const emails = failedAccounts.value.map(a => a.email);
  const pwd = store.settings.batchPassword || "abcd@1234";
  try {
    const results = await window.api.batchLogin({
      emails,
      password: pwd,
      headless: false,
    });
    for (const r of results) {
      if (r.success && r.token) {
        const data = { email: r.email, token: r.token };
        if (r.accessToken) data.access_token = r.accessToken;
        if (r.refreshToken) data.refresh_token = r.refreshToken;
        await window.api.upsertAccount(data);
      }
    }
    await store.loadAccounts();
  } catch { /* ignore */ }
  retryingAll.value = false;
}

async function removeAccount(email) {
  if (!confirm(`确定删除 ${email}？`)) return;
  await window.api.removeAccounts([email]);
  await store.loadAccounts();
}

async function clearAllFailed() {
  if (failedAccounts.value.length === 0) return;
  if (!confirm(`确定清除所有 ${failedAccounts.value.length} 个失败账号？`)) return;
  const emails = failedAccounts.value.map(a => a.email);
  await window.api.removeAccounts(emails);
  await store.loadAccounts();
}

async function disableSingle(email) {
  await window.api.disableAccounts([email]);
  await store.loadAccounts();
}

async function disableAllFailed() {
  if (failedAccounts.value.length === 0) return;
  if (!confirm(`确定停用所有 ${failedAccounts.value.length} 个失败账号？\n停用后不再参与自动巡检。`)) return;
  const emails = failedAccounts.value.map(a => a.email);
  await window.api.disableAccounts(emails);
  await store.loadAccounts();
}

async function activateSingle(email) {
  await window.api.activateAccounts([email]);
  await store.loadAccounts();
}

async function activateWithToken() {
  const withToken = failedAccounts.value.filter(a => a.token || a.access_token);
  if (withToken.length === 0) return;
  if (!confirm(`将 ${withToken.length} 个有 Token 的账号恢复为活跃？`)) return;
  const emails = withToken.map(a => a.email);
  await window.api.activateAccounts(emails);
  await store.loadAccounts();
}

const failedWithToken = computed(() => failedAccounts.value.filter(a => a.token || a.access_token));

onMounted(() => store.loadAccounts());
</script>

<template>
  <div class="flex flex-col h-full gap-6 max-w-5xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between no-drag">
      <div>
        <h1 class="text-3xl font-black tracking-tight text-apple-text mb-1">失效账号 <span class="text-apple-textMuted font-medium tracking-normal text-2xl">Failed</span></h1>
        <p class="text-sm text-apple-textMuted">Token 已失效或无法连接的账号，请尝试重新登录或清除。</p>
      </div>
      <div class="flex items-center gap-3">
        <button v-if="failedWithToken.length > 0" class="apple-btn-primary bg-apple-success hover:bg-green-600 shadow-sm" @click="activateWithToken">
          <RotateCcw class="w-4 h-4 mr-2" />
          恢复有Token的 ({{ failedWithToken.length }})
        </button>
        <button class="apple-btn-primary bg-apple-warning hover:bg-orange-500 shadow-sm" :disabled="retryingAll || failedAccounts.length === 0" @click="retryAll">
          <RefreshCw :class="['w-4 h-4 mr-2', { 'animate-spin': retryingAll }]" />
          {{ retryingAll ? '处理中...' : '全部重试' }}
        </button>
        <button class="apple-btn border-none bg-amber-500/10 text-amber-600 hover:bg-amber-500/20" :disabled="failedAccounts.length === 0" @click="disableAllFailed">
          <Ban class="w-4 h-4 mr-2" /> 全部停用
        </button>
        <button class="apple-btn border-none bg-apple-danger/10 text-apple-danger hover:bg-apple-danger/20" :disabled="failedAccounts.length === 0" @click="clearAllFailed">
          <Trash2 class="w-4 h-4 mr-2" /> 全部清除
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="failedAccounts.length === 0" class="flex-1 flex flex-col items-center justify-center gap-4 text-apple-textMuted py-20">
      <div class="w-20 h-20 rounded-full bg-apple-success/10 flex items-center justify-center text-apple-success shadow-sm">
        <ShieldAlert class="w-10 h-10" />
      </div>
      <div class="text-center">
        <p class="text-lg font-bold text-apple-text">一切正常</p>
        <p class="text-sm mt-1">当前没有发现失效的账号记录。</p>
      </div>
    </div>

    <!-- Failed Accounts List -->
    <div v-else class="flex flex-col gap-3 pb-6">
      <div v-for="acc in failedAccounts" :key="acc.email" 
           class="apple-glass rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-l-4 border-l-apple-danger hover:-translate-y-0.5 transition-transform" 
           v-motion
           :initial="{ opacity: 0, x: -20 }"
           :enter="{ opacity: 1, x: 0, transition: { type: 'spring', damping: 25 } }">
        
        <div class="flex items-center gap-4">
          <div class="flex flex-col gap-1.5">
            <span class="text-base font-bold text-apple-text">{{ acc.email }}</span>
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="acc.membership_type" :class="['px-1.5 py-0.5 rounded uppercase text-[10px] font-black tracking-wider', acc.membership_type === 'free' ? 'bg-apple-danger/10 text-apple-danger' : 'bg-apple-warning/10 text-apple-warning']">
                {{ acc.membership_type }}
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide bg-apple-danger/10 text-apple-danger flex items-center gap-1">
                Token 失效
              </span>
              <span v-if="acc.token || acc.access_token" class="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide bg-blue-500/10 text-blue-600 flex items-center gap-1">
                <Key class="w-2.5 h-2.5" /> 有凭证
              </span>
              <span v-else class="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide bg-black/5 text-apple-textMuted">
                无凭证
              </span>
              <span v-if="acc.last_checked" class="text-xs text-apple-textMuted flex items-center gap-1">
                <BadgeInfo class="w-3.5 h-3.5" /> 上次检查: {{ new Date(acc.last_checked).toLocaleString() }}
              </span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button v-if="acc.token || acc.access_token" class="apple-btn-secondary !text-apple-success hover:bg-apple-success/10 hover:border-apple-success/30" @click="activateSingle(acc.email)" title="有凭证，恢复为活跃">
            <RotateCcw class="w-4 h-4 mr-1.5" />
            恢复
          </button>
          <button class="apple-btn-secondary !text-apple-accent hover:bg-apple-accent/10 hover:border-apple-accent/30" :disabled="retryingSet.has(acc.email)" @click="retrySingle(acc.email)">
            <RefreshCw :class="['w-4 h-4 mr-1.5', { 'animate-spin': retryingSet.has(acc.email) }]" />
            {{ retryingSet.has(acc.email) ? '连接中...' : '重新签发' }}
          </button>
          <button class="apple-btn-secondary !text-amber-600 hover:bg-amber-500/10 hover:border-amber-500/30 w-10 !px-0 flex items-center justify-center" @click="disableSingle(acc.email)" title="停用此账号">
            <Ban class="w-4 h-4" />
          </button>
          <button class="apple-btn-secondary !text-apple-danger hover:bg-apple-danger/10 hover:border-apple-danger/30 w-10 !px-0 flex items-center justify-center" @click="removeAccount(acc.email)" title="删除此账号">
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
