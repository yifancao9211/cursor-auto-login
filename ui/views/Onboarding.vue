<script setup>
import { ref, computed, onMounted } from "vue";
import { useAppStore } from "../stores/app.js";
import BatchLoginDialog from "../components/BatchLoginDialog.vue";
import { Plus, Upload, RefreshCw, Trash2, AlertTriangle, PackagePlus, ShieldCheck, PlayCircle, BadgeInfo, Search, ClipboardPaste, X, Users, Ban, Undo2 } from "lucide-vue-next";

const store = useAppStore();
const showBatchLogin = ref(false);
const batchLoginEmails = ref("");
const addEmail = ref("");
const retryingSet = ref(new Set());
const filterText = ref("");
const showImportDialog = ref(false);
const importJsonText = ref("");
const importResult = ref(null);
const discoveringTeam = ref(false);

async function handleDiscoverTeam() {
  discoveringTeam.value = true;
  try {
    await window.api.discoverTeam();
    await store.loadAccounts();
  } catch { /* ignore */ }
  discoveringTeam.value = false;
}

const newAccounts = computed(() => {
  const q = filterText.value.toLowerCase();
  return store.newAccounts.filter(a => !q || a.email.toLowerCase().includes(q));
});

const failedAccounts = computed(() => {
  const q = filterText.value.toLowerCase();
  return store.failedAccounts.filter(a => !q || a.email.toLowerCase().includes(q));
});

const disabledAccounts = computed(() => {
  const q = filterText.value.toLowerCase();
  return store.disabledAccounts.filter(a => !q || a.email.toLowerCase().includes(q));
});

function startBatchForNew() {
  batchLoginEmails.value = newAccounts.value.map(a => a.email).join("\n");
  showBatchLogin.value = true;
}

function startBatchForFailed() {
  batchLoginEmails.value = failedAccounts.value.map(a => a.email).join("\n");
  showBatchLogin.value = true;
}

function startBatchAll() {
  const all = [...newAccounts.value, ...failedAccounts.value].map(a => a.email);
  batchLoginEmails.value = all.join("\n");
  showBatchLogin.value = true;
}

async function toggleDisabled(email, isDisabled) {
  await window.api.upsertAccount({ email, account_status: isDisabled ? "disabled" : "failed" });
  await store.loadAccounts();
}

function handleAddSingle() {
  const email = addEmail.value.trim();
  if (!email || !email.includes("@")) return;
  window.api.upsertAccount({ email, account_status: "new", token_valid: 0 });
  addEmail.value = "";
  store.loadAccounts();
}

function openImportDialog() {
  importJsonText.value = "";
  importResult.value = null;
  showImportDialog.value = true;
}

async function handleImportJson() {
  const text = importJsonText.value.trim();
  if (!text) return;
  try {
    const data = JSON.parse(text);
    const count = await window.api.importTokensJson(data);
    importResult.value = { success: true, count: Object.keys(data).length };
    await store.loadAccounts();
    // 2 秒后自动关闭
    setTimeout(() => {
      showImportDialog.value = false;
      importResult.value = null;
    }, 2000);
  } catch (e) {
    importResult.value = { success: false, error: "JSON 格式错误：" + e.message };
  }
}

async function retrySingle(email) {
  if (retryingSet.value.has(email)) return;
  retryingSet.value.add(email);
  try {
    const pwd = store.settings.batchPassword || "abcd@1234";
    const result = await window.api.singleLogin({ email, password: pwd });
    if (result.success && result.token) {
      const data = { email, token: result.token, account_status: "active", token_valid: 1 };
      if (result.accessToken) data.access_token = result.accessToken;
      if (result.refreshToken) data.refresh_token = result.refreshToken;
      await window.api.upsertAccount(data);
      await store.loadAccounts();
    }
  } catch { /* ignore */ }
  retryingSet.value.delete(email);
}

async function batchRetryAll(accounts) {
  showBatchLogin.value = true;
}

async function removeAccount(email) {
  if (!confirm(`确定删除 ${email}？`)) return;
  await window.api.removeAccounts([email]);
  await store.loadAccounts();
}

async function clearAll(status) {
  const lists = { new: store.newAccounts, failed: store.failedAccounts, disabled: store.disabledAccounts };
  const list = lists[status] || [];
  if (list.length === 0) return;
  const labels = { new: '待登录', failed: '已失败', disabled: '已禁用' };
  if (!confirm(`确定清除所有 ${list.length} 个${labels[status]}账号？`)) return;
  await window.api.removeAccounts(list.map(a => a.email));
  await store.loadAccounts();
}

function onBatchDone() {
  store.loadAccounts();
}

onMounted(() => store.loadAccounts());
</script>

<template>
  <div class="flex flex-col h-full gap-6 max-w-5xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between no-drag">
      <div>
        <h1 class="text-3xl font-black tracking-tight text-apple-text mb-1">账号入库 <span class="text-apple-textMuted font-medium tracking-normal text-2xl">Onboarding</span></h1>
        <p class="text-sm text-apple-textMuted">新增、导入、登录获取 Token，管理待处理和失败的账号。</p>
      </div>
      <div class="flex items-center gap-3">
        <button class="apple-btn-secondary flex items-center gap-1.5" @click="handleDiscoverTeam" :disabled="discoveringTeam">
          <Users :class="['w-4 h-4', { 'animate-spin': discoveringTeam }]" />
          {{ discoveringTeam ? '发现中...' : '团队入库' }}
        </button>
        <button class="apple-btn-secondary flex items-center gap-1.5" @click="openImportDialog">
          <ClipboardPaste class="w-4 h-4" /> 批量导入
        </button>
        <button class="apple-btn-primary flex items-center gap-1.5" @click="startBatchAll" :disabled="newAccounts.length + failedAccounts.length === 0">
          <PlayCircle class="w-4 h-4" /> 全部登录 ({{ newAccounts.length + failedAccounts.length }})
        </button>
      </div>
    </div>

    <!-- Quick Add -->
    <div class="apple-glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3 no-drag">
      <div class="flex-1 relative">
        <Plus class="w-4 h-4 text-apple-textMuted absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          class="w-full bg-white border border-apple-border rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-apple-accent focus:ring-2 focus:ring-apple-accent/20 transition-all"
          v-model="addEmail"
          @keyup.enter="handleAddSingle"
          placeholder="输入邮箱，按回车快速添加..."
        />
      </div>
      <button class="apple-btn-secondary flex items-center gap-1.5 whitespace-nowrap" @click="handleAddSingle" :disabled="!addEmail.trim()">
        <Plus class="w-4 h-4" /> 添加
      </button>
    </div>

    <!-- Search Filter -->
    <div class="relative no-drag" v-if="store.newAccounts.length + store.failedAccounts.length > 5">
      <Search class="w-4 h-4 text-apple-textMuted absolute left-3 top-1/2 -translate-y-1/2" />
      <input class="w-full bg-white/60 border border-apple-border rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:border-apple-accent transition-all" v-model="filterText" placeholder="搜索邮箱..." />
    </div>

    <!-- SECTION: New Accounts -->
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-apple-accent"></div>
          <h3 class="font-bold text-apple-text text-sm">待登录</h3>
          <span class="text-xs text-apple-textMuted bg-apple-accent/10 px-1.5 py-0.5 rounded font-bold">{{ newAccounts.length }}</span>
        </div>
        <div class="flex items-center gap-2">
          <button v-if="newAccounts.length" class="apple-btn-secondary text-xs px-3 flex items-center gap-1 !text-apple-accent" @click="startBatchForNew">
            <PlayCircle class="w-3.5 h-3.5" /> 批量登录 ({{ newAccounts.length }})
          </button>
          <button v-if="newAccounts.length" class="text-xs text-apple-danger hover:text-red-600 font-medium transition-colors" @click="clearAll('new')">全部清除</button>
        </div>
      </div>

      <div v-if="newAccounts.length === 0" class="text-center py-8 text-apple-textMuted text-sm">
        <PackagePlus class="w-8 h-8 mx-auto mb-2 opacity-30" />
        没有待登录的账号，请添加或通过组织自动发现。
      </div>

      <div v-for="acc in newAccounts" :key="acc.email"
           class="apple-glass rounded-xl p-3.5 flex items-center justify-between gap-3 border-l-4 border-l-apple-accent hover:-translate-y-0.5 transition-transform"
           v-motion :initial="{ opacity: 0, x: -15 }" :enter="{ opacity: 1, x: 0, transition: { type: 'spring', damping: 25 } }">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-full bg-apple-accent/10 flex items-center justify-center text-apple-accent flex-shrink-0">
            <PackagePlus class="w-4 h-4" />
          </div>
          <div class="flex flex-col min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-bold text-apple-text truncate">{{ acc.email }}</span>
              <span v-if="acc.is_admin" class="px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider bg-amber-500/15 text-amber-600 flex-shrink-0">👑 ADMIN</span>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="acc.org_name" class="text-[10px] text-apple-textMuted">{{ acc.org_name }}</span>
              <span v-if="acc.plan_limit != null || acc.on_demand_limit != null" class="text-[10px] font-bold" :class="((acc.plan_limit || 0) + (acc.on_demand_limit || 0) - (acc.plan_used || 0) - (acc.on_demand_used || 0)) > 0 ? 'text-apple-success' : 'text-apple-danger'">
                余额 ${{ +((acc.plan_limit || 0) + (acc.on_demand_limit || 0) - (acc.plan_used || 0) - (acc.on_demand_used || 0)).toFixed(2) }}
              </span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button class="apple-btn-secondary !text-apple-accent hover:bg-apple-accent/10 text-xs px-3" :disabled="retryingSet.has(acc.email)" @click="retrySingle(acc.email)">
            <RefreshCw :class="['w-3.5 h-3.5 mr-1', { 'animate-spin': retryingSet.has(acc.email) }]" />
            {{ retryingSet.has(acc.email) ? '签发中' : '登录' }}
          </button>
          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-apple-danger/10 text-apple-textMuted hover:text-apple-danger transition-colors" @click="removeAccount(acc.email)">
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- SECTION: Failed Accounts -->
    <div class="flex flex-col gap-3" v-if="failedAccounts.length > 0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-apple-danger"></div>
          <h3 class="font-bold text-apple-text text-sm">已失败</h3>
          <span class="text-xs text-apple-textMuted bg-apple-danger/10 px-1.5 py-0.5 rounded font-bold">{{ failedAccounts.length }}</span>
        </div>
        <div class="flex items-center gap-2">
          <button v-if="failedAccounts.length" class="apple-btn-secondary text-xs px-3 flex items-center gap-1 !text-apple-warning" @click="startBatchForFailed">
            <PlayCircle class="w-3.5 h-3.5" /> 批量重试 ({{ failedAccounts.length }})
          </button>
          <button class="text-xs text-apple-danger hover:text-red-600 font-medium transition-colors" @click="clearAll('failed')">全部清除</button>
        </div>
      </div>

      <div v-for="acc in failedAccounts" :key="acc.email"
           class="apple-glass rounded-xl p-3.5 flex items-center justify-between gap-3 border-l-4 border-l-apple-danger hover:-translate-y-0.5 transition-transform"
           v-motion :initial="{ opacity: 0, x: -15 }" :enter="{ opacity: 1, x: 0, transition: { type: 'spring', damping: 25 } }">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-full bg-apple-danger/10 flex items-center justify-center text-apple-danger flex-shrink-0">
            <AlertTriangle class="w-4 h-4" />
          </div>
          <div class="flex flex-col min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-bold text-apple-text truncate">{{ acc.email }}</span>
              <span v-if="acc.is_admin" class="px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider bg-amber-500/15 text-amber-600 flex-shrink-0">👑 ADMIN</span>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="acc.membership_type" class="text-[10px] font-bold uppercase tracking-wider text-apple-danger/70">{{ acc.membership_type }}</span>
              <span v-if="acc.plan_limit != null || acc.on_demand_limit != null" class="text-[10px] font-bold" :class="((acc.plan_limit || 0) + (acc.on_demand_limit || 0) - (acc.plan_used || 0) - (acc.on_demand_used || 0)) > 0 ? 'text-apple-success' : 'text-apple-danger'">
                余额 ${{ +((acc.plan_limit || 0) + (acc.on_demand_limit || 0) - (acc.plan_used || 0) - (acc.on_demand_used || 0)).toFixed(2) }}
              </span>
              <span v-if="acc.last_checked" class="text-[10px] text-apple-textMuted flex items-center gap-0.5">
                <BadgeInfo class="w-3 h-3" /> {{ new Date(acc.last_checked).toLocaleString() }}
              </span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button class="apple-btn-secondary !text-apple-warning hover:bg-apple-warning/10 text-xs px-3" :disabled="retryingSet.has(acc.email)" @click="retrySingle(acc.email)">
            <RefreshCw :class="['w-3.5 h-3.5 mr-1', { 'animate-spin': retryingSet.has(acc.email) }]" />
            {{ retryingSet.has(acc.email) ? '重试中' : '重试' }}
          </button>
          <button class="apple-btn-secondary !text-apple-textMuted hover:bg-black/5 text-xs px-2" title="标记为禁用" @click="toggleDisabled(acc.email, true)">
            <Ban class="w-3.5 h-3.5" />
          </button>
          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-apple-danger/10 text-apple-textMuted hover:text-apple-danger transition-colors" @click="removeAccount(acc.email)">
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- SECTION: Disabled Accounts -->
    <div class="flex flex-col gap-3" v-if="disabledAccounts.length > 0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-apple-textMuted/50"></div>
          <h3 class="font-bold text-apple-text text-sm">已禁用</h3>
          <span class="text-xs text-apple-textMuted bg-black/5 px-1.5 py-0.5 rounded font-bold">{{ disabledAccounts.length }}</span>
        </div>
        <button class="text-xs text-apple-danger hover:text-red-600 font-medium transition-colors" @click="clearAll('disabled')">全部清除</button>
      </div>

      <div v-for="acc in disabledAccounts" :key="acc.email"
           class="apple-glass rounded-xl p-3.5 flex items-center justify-between gap-3 border-l-4 border-l-apple-textMuted/30 opacity-60">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-apple-textMuted flex-shrink-0">
            <Ban class="w-4 h-4" />
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-sm font-bold text-apple-textMuted truncate line-through">{{ acc.email }}</span>
            <span v-if="acc.org_name" class="text-[10px] text-apple-textMuted">{{ acc.org_name }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button class="apple-btn-secondary text-xs px-3 flex items-center gap-1" @click="toggleDisabled(acc.email, false)">
            <Undo2 class="w-3.5 h-3.5 mr-0.5" /> 恢复
          </button>
          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-apple-danger/10 text-apple-textMuted hover:text-apple-danger transition-colors" @click="removeAccount(acc.email)">
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State when everything is clean -->
    <div v-if="newAccounts.length === 0 && failedAccounts.length === 0 && !filterText" class="flex-1 flex flex-col items-center justify-center gap-3 py-12 text-apple-textMuted">
      <div class="w-16 h-16 rounded-full bg-apple-success/10 flex items-center justify-center text-apple-success">
        <ShieldCheck class="w-8 h-8" />
      </div>
      <p class="text-base font-bold text-apple-text">全部就绪</p>
      <p class="text-sm">所有账号均已成功入库，无待处理项。</p>
    </div>

    <div class="pb-6"></div>

    <!-- Batch Login Dialog -->
    <BatchLoginDialog v-model="showBatchLogin" :initial-emails="batchLoginEmails" @done="onBatchDone" />

    <!-- Import JSON Dialog -->
    <Transition name="modal">
      <div v-if="showImportDialog" class="fixed inset-0 z-50 flex items-center justify-center no-drag">
        <div class="absolute inset-0 bg-black/20 backdrop-blur-sm" @click="showImportDialog = false"></div>
        <div class="relative bg-apple-bg w-full max-w-lg rounded-2xl shadow-apple-lg border border-white/50 overflow-hidden flex flex-col"
             v-motion :initial="{ opacity: 0, scale: 0.95, y: 10 }" :enter="{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', damping: 25 } }">
          <div class="px-5 py-4 border-b border-apple-border flex justify-between items-center bg-white/40">
            <h3 class="font-bold text-apple-text">批量导入 Token</h3>
            <button class="w-7 h-7 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-apple-textMuted transition-colors" @click="showImportDialog = false">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="p-5 flex flex-col gap-4 bg-white/20">
            <p class="text-xs text-apple-textMuted">粘贴 <span class="font-bold">tokens.json</span> 格式的 JSON，格式：<code class="bg-black/5 px-1 rounded">{ "email": "token", ... }</code></p>
            <textarea
              class="w-full bg-white border border-apple-border rounded-lg px-3 py-2 text-sm outline-none focus:border-apple-accent focus:ring-2 focus:ring-apple-accent/20 transition-all font-mono resize-none h-40"
              v-model="importJsonText"
              placeholder='{&#10;  "user@example.com": "user_xxx%3A%3AeyJ...",&#10;  ...&#10;}'
            ></textarea>
            <div v-if="importResult" :class="['text-sm font-bold px-3 py-2 rounded-lg', importResult.success ? 'bg-apple-success/10 text-apple-success' : 'bg-apple-danger/10 text-apple-danger']">
              {{ importResult.success ? `✅ 成功导入 ${importResult.count} 个账号` : importResult.error }}
            </div>
          </div>
          <div class="px-5 py-4 border-t border-apple-border flex justify-end gap-3 bg-white/40">
            <button class="px-4 py-2 rounded-lg font-medium text-sm text-apple-textMuted hover:bg-black/5 transition-colors" @click="showImportDialog = false">取消</button>
            <button class="apple-btn-primary px-6" @click="handleImportJson" :disabled="!importJsonText.trim()">导入</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
