<script setup>
import { ref, computed } from "vue";
import { useAppStore } from "../stores/app.js";
import { ArrowRight, ArrowLeft, Check, KeyRound, Users, Timer, Sparkles } from "lucide-vue-next";

const store = useAppStore();
const emit = defineEmits(["done"]);

const step = ref(0);
const cookieInput = ref("");
const importDone = ref(false);
const discoverDone = ref(false);
const discovering = ref(false);

const steps = [
  { title: "欢迎使用", icon: Sparkles, desc: "Cursor Account Manager 帮你管理多个 Cursor 账号的配额与切换" },
  { title: "导入第一个账号", icon: KeyRound, desc: "粘贴你的 WorkosCursorSessionToken Cookie" },
  { title: "发现团队成员", icon: Users, desc: "自动发现组织中的其他成员" },
  { title: "配置完成", icon: Timer, desc: "开始享受自动化管理体验" },
];

const canNext = computed(() => {
  if (step.value === 1) return cookieInput.value.trim().length > 10;
  return true;
});

async function handleImportCookie() {
  if (!cookieInput.value.trim()) return;
  try {
    const data = {};
    const cookie = cookieInput.value.trim();
    const decoded = decodeURIComponent(cookie);
    const parts = decoded.split("::");
    const email = parts.length >= 2 ? `imported-${Date.now()}@cursor` : `manual-${Date.now()}@cursor`;
    data[email] = cookie;
    await window.api.importTokensJson(data);
    await store.loadAccounts();
    importDone.value = true;
  } catch (e) {
    console.error("Import failed:", e);
  }
}

async function handleDiscover() {
  discovering.value = true;
  try {
    await window.api.discoverTeam();
    await store.loadAccounts();
    discoverDone.value = true;
  } catch {}
  discovering.value = false;
}

function finish() {
  store.settings.onboardingDone = true;
  store.saveSettings();
  emit("done");
}

function next() {
  if (step.value === 1 && !importDone.value) handleImportCookie();
  if (step.value < steps.length - 1) step.value++;
  else finish();
}

function back() {
  if (step.value > 0) step.value--;
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-apple-bg/95 backdrop-blur-xl">
      <div class="w-full max-w-lg bg-apple-card rounded-3xl shadow-apple-lg border border-apple-border overflow-hidden"
           v-motion :initial="{ opacity: 0, y: 30 }" :enter="{ opacity: 1, y: 0, transition: { type: 'spring', damping: 20 } }">
        
        <!-- Progress -->
        <div class="flex gap-1 px-8 pt-6">
          <div v-for="(s, i) in steps" :key="i" :class="['h-1 flex-1 rounded-full transition-all duration-500', i <= step ? 'bg-apple-accent' : 'bg-apple-border']"></div>
        </div>

        <!-- Content -->
        <div class="p-8 flex flex-col items-center text-center gap-6 min-h-[320px]">
          <div class="w-16 h-16 rounded-2xl bg-apple-accent/10 flex items-center justify-center text-apple-accent">
            <component :is="steps[step].icon" class="w-8 h-8" />
          </div>
          <div>
            <h2 class="text-2xl font-black text-apple-text mb-2">{{ steps[step].title }}</h2>
            <p class="text-sm text-apple-textMuted">{{ steps[step].desc }}</p>
          </div>

          <!-- Step 1: Import Cookie -->
          <div v-if="step === 1" class="w-full flex flex-col gap-3">
            <textarea
              v-model="cookieInput"
              class="w-full bg-white border border-apple-border rounded-xl px-4 py-3 text-sm outline-none focus:border-apple-accent focus:ring-2 focus:ring-apple-accent/20 font-mono resize-none h-24"
              placeholder="粘贴 WorkosCursorSessionToken 值..."
              :disabled="importDone"
            ></textarea>
            <div v-if="importDone" class="flex items-center gap-2 text-apple-success text-sm font-bold">
              <Check class="w-4 h-4" /> 导入成功！
            </div>
          </div>

          <!-- Step 2: Discover -->
          <div v-if="step === 2" class="w-full flex flex-col gap-3 items-center">
            <button
              v-if="!discoverDone"
              class="apple-btn-primary px-8 flex items-center gap-2"
              @click="handleDiscover"
              :disabled="discovering"
            >
              <Users :class="['w-4 h-4', { 'animate-spin': discovering }]" />
              {{ discovering ? '发现中...' : '开始发现团队成员' }}
            </button>
            <div v-if="discoverDone" class="flex items-center gap-2 text-apple-success text-sm font-bold">
              <Check class="w-4 h-4" /> 发现完成！共 {{ store.accounts.length }} 个账号
            </div>
            <button v-if="!discoverDone" class="text-xs text-apple-textMuted hover:text-apple-text" @click="step++">跳过此步</button>
          </div>

          <!-- Step 3: Done -->
          <div v-if="step === 3" class="flex flex-col gap-2 items-center">
            <p class="text-sm text-apple-textMuted">系统将自动每 30 分钟巡检一次账号状态。</p>
            <p class="text-sm text-apple-textMuted">你可以在设置中调整巡检间隔和其他选项。</p>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-8 py-5 border-t border-apple-border flex justify-between">
          <button v-if="step > 0" class="apple-btn-secondary flex items-center gap-1.5" @click="back">
            <ArrowLeft class="w-4 h-4" /> 上一步
          </button>
          <div v-else></div>
          <button class="apple-btn-primary flex items-center gap-1.5" :disabled="!canNext" @click="next">
            {{ step === steps.length - 1 ? '开始使用' : '下一步' }}
            <component :is="step === steps.length - 1 ? Check : ArrowRight" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
