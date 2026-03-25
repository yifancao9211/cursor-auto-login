<script setup>
import { ref, computed, watch } from "vue";
import { useAppStore } from "../stores/app.js";
import { X, KeyRound, CheckCircle2, AlertCircle, PlayCircle, RotateCw, Globe, Loader2 } from "lucide-vue-next";

const props = defineProps({ modelValue: Boolean, initialEmails: { type: String, default: "" } });
const emit = defineEmits(["update:modelValue", "done"]);

const store = useAppStore();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const activeTab = ref("password"); // "password" | "oauth"
const emailsText = ref("");
const password = ref(store.settings.batchPassword || "abcd@1234");
const running = ref(false);
const progress = ref(null);
const results = ref([]);

// OAuth 状态
const oauthWaiting = ref(false);
const oauthLoginId = ref(null);
const oauthResult = ref(null);

// Pre-fill emails when dialog opens with initialEmails
watch(() => props.modelValue, (visible) => {
  if (visible && props.initialEmails) {
    emailsText.value = props.initialEmails;
  }
  if (!visible) {
    // 关闭时重置 OAuth 状态
    oauthWaiting.value = false;
    oauthResult.value = null;
  }
});

const emailList = computed(() =>
  emailsText.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("@"))
);

const failedResults = computed(() => results.value.filter((r) => !r.success));
const successResults = computed(() => results.value.filter((r) => r.success));

async function startLogin() {
  if (emailList.value.length === 0) return;

  running.value = true;
  results.value = [];

  const cleanup = window.api.onLoginProgress((p) => {
    progress.value = p;
  });

  try {
    const loginResults = await window.api.batchLogin({
      emails: emailList.value,
      password: password.value,
      headless: false,
      concurrency: store.settings.concurrency || 3,
    });

    results.value = loginResults;

    for (const r of loginResults) {
      if (r.success && r.token) {
        const data = { email: r.email, token: r.token, account_status: "active", token_valid: 1 };
        if (r.accessToken) data.access_token = r.accessToken;
        if (r.refreshToken) data.refresh_token = r.refreshToken;
        await window.api.upsertAccount(data);
      } else {
        // 失败的也入库，标记为 failed，可在入库页重试
        await window.api.upsertAccount({ email: r.email, account_status: "failed", token_valid: 0 });
      }
    }

    emit("done");
  } catch { /* ignore */ }
  finally {
    running.value = false;
    progress.value = null;
    cleanup();
  }
}

function retryFailed() {
  const failedEmails = failedResults.value.map((r) => r.email);
  emailsText.value = failedEmails.join("\n");
  results.value = [];
}

// ========== OAuth 浏览器授权 ==========

async function startOAuth() {
  oauthWaiting.value = true;
  oauthResult.value = null;

  try {
    const start = await window.api.startOAuthLogin();
    oauthLoginId.value = start.loginId;

    // 等待用户在浏览器完成登录
    const result = await window.api.completeOAuthLogin(start.loginId);
    oauthResult.value = result;

    if (result.success) {
      emit("done");
    }
  } catch (e) {
    oauthResult.value = { success: false, error: e.message };
  } finally {
    oauthWaiting.value = false;
    oauthLoginId.value = null;
  }
}

function cancelOAuth() {
  if (oauthLoginId.value) {
    window.api.cancelOAuthLogin(oauthLoginId.value);
  }
  oauthWaiting.value = false;
  oauthLoginId.value = null;
}
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center no-drag p-4">
      <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="!running && !oauthWaiting && (visible = false)"></div>
      
      <div class="relative bg-apple-bg w-full max-w-lg rounded-2xl shadow-apple-lg border border-white/50 flex flex-col overflow-hidden" 
           v-motion 
           :initial="{ opacity: 0, scale: 0.95, y: 10 }" 
           :enter="{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', damping: 25 } }">
        
        <div class="px-5 py-4 border-b border-apple-border flex justify-between items-center bg-white/40">
          <h3 class="font-bold text-apple-text">添加账号</h3>
          <button v-if="!running && !oauthWaiting" class="w-7 h-7 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-apple-textMuted transition-colors" @click="visible = false">
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Tab 切换 -->
        <div class="flex border-b border-apple-border bg-white/30">
          <button 
            class="flex-1 px-4 py-2.5 text-sm font-medium transition-colors relative"
            :class="activeTab === 'password' ? 'text-apple-accent' : 'text-apple-textMuted hover:text-apple-text'"
            @click="activeTab = 'password'"
            :disabled="running || oauthWaiting"
          >
            <KeyRound class="w-4 h-4 inline-block mr-1 -mt-0.5" />
            密码批量登录
            <div v-if="activeTab === 'password'" class="absolute bottom-0 left-2 right-2 h-0.5 bg-apple-accent rounded-full"></div>
          </button>
          <button 
            class="flex-1 px-4 py-2.5 text-sm font-medium transition-colors relative"
            :class="activeTab === 'oauth' ? 'text-apple-accent' : 'text-apple-textMuted hover:text-apple-text'"
            @click="activeTab = 'oauth'"
            :disabled="running || oauthWaiting"
          >
            <Globe class="w-4 h-4 inline-block mr-1 -mt-0.5" />
            浏览器授权
            <div v-if="activeTab === 'oauth'" class="absolute bottom-0 left-2 right-2 h-0.5 bg-apple-accent rounded-full"></div>
          </button>
        </div>
        
        <div class="p-5 flex flex-col gap-5 bg-white/20">
          <!-- ===== 密码批量登录 Tab ===== -->
          <template v-if="activeTab === 'password'">
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-apple-textMuted uppercase tracking-wider pl-1">邮箱列表 (每行一个)</label>
              <textarea
                class="w-full bg-white border border-apple-border rounded-xl px-3 py-2 text-sm outline-none focus:border-apple-accent focus:ring-2 focus:ring-apple-accent/20 transition-all font-mono resize-none h-32 disabled:bg-black/5 disabled:text-apple-textMuted"
                v-model="emailsText"
                :disabled="running"
                placeholder="user1@example.com&#10;user2@example.com"
              />
              <span class="text-[11px] text-apple-textMuted font-medium pl-1">识别到 {{ emailList.length }} 个有效邮箱</span>
            </div>
            
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-apple-textMuted uppercase tracking-wider pl-1">统一登录密码</label>
              <div class="relative group">
                <KeyRound class="w-4 h-4 text-apple-textMuted absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-apple-accent transition-colors" />
                <input 
                  class="w-full bg-white border border-apple-border rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:border-apple-accent focus:ring-2 focus:ring-apple-accent/20 transition-all font-sans disabled:bg-black/5 disabled:text-apple-textMuted" 
                  v-model="password" 
                  :disabled="running" 
                  type="password" 
                  placeholder="密码将用于所有账号登录"
                />
              </div>
            </div>

            <!-- Progress -->
            <div v-if="progress" class="flex flex-col gap-2 mt-2 bg-white/50 p-4 rounded-xl border border-apple-border">
              <div class="flex justify-between items-center text-xs font-bold">
                <span class="text-apple-text">{{ progress.current }} / {{ progress.total }}</span>
                <span :class="['px-2 py-0.5 rounded uppercase tracking-wide text-[10px]', progress.status === 'success' ? 'bg-apple-success/10 text-apple-success' : progress.status === 'failed' ? 'bg-apple-danger/10 text-apple-danger' : 'bg-blue-500/10 text-blue-600']">
                  {{ progress.status === 'logging_in' ? '自动签发中...' : progress.status }}
                </span>
              </div>
              <div class="w-full h-1.5 bg-black/5 rounded-full overflow-hidden">
                <div class="h-full bg-apple-accent transition-all duration-300" :style="{ width: Math.round((progress.current / progress.total) * 100) + '%' }"></div>
              </div>
              <span class="text-xs text-apple-textMuted truncate">{{ progress.email }}</span>
            </div>

            <!-- Results -->
            <div v-if="results.length > 0" class="flex flex-col gap-3 mt-2">
              <div class="flex items-center gap-2 pb-2 border-b border-apple-border/50">
                <span class="px-2 py-0.5 rounded text-xs font-bold tracking-wide bg-apple-success/10 text-apple-success border border-apple-success/20">成功 {{ successResults.length }}</span>
                <span v-if="failedResults.length > 0" class="px-2 py-0.5 rounded text-xs font-bold tracking-wide bg-apple-danger/10 text-apple-danger border border-apple-danger/20">失败 {{ failedResults.length }}</span>
              </div>
              <div class="max-h-40 overflow-y-auto flex flex-col gap-1.5 pr-1">
                <div v-for="r in results" :key="r.email" class="flex items-center gap-2 text-xs bg-white/60 p-2 rounded-lg border border-apple-border">
                  <CheckCircle2 v-if="r.success" class="w-4 h-4 text-apple-success flex-shrink-0" />
                  <AlertCircle v-else class="w-4 h-4 text-apple-danger flex-shrink-0" />
                  <span class="font-bold flex-1 truncate text-apple-text">{{ r.email }}</span>
                  <span v-if="r.error" class="text-apple-danger truncate max-w-[150px] font-medium" :title="r.error">{{ r.error }}</span>
                </div>
              </div>
            </div>
          </template>

          <!-- ===== OAuth 浏览器授权 Tab ===== -->
          <template v-if="activeTab === 'oauth'">
            <div class="flex flex-col items-center gap-4 py-4">
              <!-- 等待中 -->
              <template v-if="oauthWaiting">
                <div class="w-16 h-16 flex items-center justify-center rounded-full bg-apple-accent/10">
                  <Loader2 class="w-8 h-8 text-apple-accent animate-spin" />
                </div>
                <div class="text-center">
                  <p class="text-sm font-bold text-apple-text">等待浏览器授权...</p>
                  <p class="text-xs text-apple-textMuted mt-1">请在浏览器中完成 Cursor 账号登录</p>
                  <p class="text-xs text-apple-textMuted">登录完成后将自动获取 Token</p>
                </div>
              </template>

              <!-- 结果 -->
              <template v-else-if="oauthResult">
                <div v-if="oauthResult.success" class="w-full bg-apple-success/5 border border-apple-success/20 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle2 class="w-5 h-5 text-apple-success flex-shrink-0 mt-0.5" />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-apple-success">授权成功</p>
                    <p v-if="oauthResult.email" class="text-xs text-apple-textMuted mt-1 truncate">{{ oauthResult.email }}</p>
                    <p class="text-xs text-apple-textMuted mt-0.5">已获取 Token 并自动入库</p>
                  </div>
                </div>
                <div v-else class="w-full bg-apple-danger/5 border border-apple-danger/20 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle class="w-5 h-5 text-apple-danger flex-shrink-0 mt-0.5" />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-apple-danger">授权失败</p>
                    <p class="text-xs text-apple-textMuted mt-1">{{ oauthResult.error === 'cancelled' ? '已取消' : oauthResult.error === 'poll_timeout' ? '等待超时，请重试' : oauthResult.error }}</p>
                  </div>
                </div>
              </template>

              <!-- 初始状态 -->
              <template v-else>
                <div class="w-16 h-16 flex items-center justify-center rounded-full bg-blue-500/10">
                  <Globe class="w-8 h-8 text-blue-500" />
                </div>
                <div class="text-center">
                  <p class="text-sm font-bold text-apple-text">浏览器 OAuth 授权</p>
                  <p class="text-xs text-apple-textMuted mt-1">适合密码和统一密码不同的账号</p>
                  <p class="text-xs text-apple-textMuted">点击下方按钮后，将打开浏览器登录页面</p>
                  <p class="text-xs text-apple-textMuted">登录完成后自动获取 Token 入库</p>
                </div>
              </template>
            </div>
          </template>
        </div>
        
        <div class="px-5 py-4 border-t border-apple-border flex justify-end items-center gap-3 bg-white/40">
          <button class="px-4 py-2 rounded-lg font-medium text-sm text-apple-textMuted hover:bg-black/5 transition-colors" @click="visible = false" :disabled="running || oauthWaiting">关闭面板</button>
          
          <!-- 密码登录按钮 -->
          <template v-if="activeTab === 'password'">
            <button v-if="failedResults.length > 0 && !running" class="apple-btn-secondary !text-apple-warning border-apple-warning/20 hover:bg-apple-warning/10 px-4 flex items-center gap-1.5" @click="retryFailed">
              <RotateCw class="w-4 h-4" /> 重试失败 ({{ failedResults.length }})
            </button>
            
            <button class="apple-btn-primary px-6 flex items-center gap-1.5" @click="startLogin" :disabled="running || emailList.length === 0">
              <template v-if="running">
                <RotateCw class="w-4 h-4 animate-spin" /> 处理中...
              </template>
              <template v-else>
                <PlayCircle class="w-4 h-4" /> 开始自动登录
              </template>
            </button>
          </template>

          <!-- OAuth 按钮 -->
          <template v-if="activeTab === 'oauth'">
            <button v-if="oauthWaiting" class="apple-btn-secondary !text-apple-danger border-apple-danger/20 hover:bg-apple-danger/10 px-4 flex items-center gap-1.5" @click="cancelOAuth">
              <X class="w-4 h-4" /> 取消等待
            </button>
            <button v-else class="apple-btn-primary px-6 flex items-center gap-1.5" @click="startOAuth" :disabled="oauthWaiting">
              <Globe class="w-4 h-4" />
              {{ oauthResult ? '重新授权' : '打开浏览器授权' }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
