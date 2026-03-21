<script setup>
import { ref, computed } from "vue";
import { parseJwt } from "../utils/account.js";
import { Key, Copy, Check, X } from "lucide-vue-next";

const props = defineProps({ modelValue: Boolean, account: Object });
const emit = defineEmits(["update:modelValue"]);

const copiedKeys = ref(new Set());

const detail = computed(() => {
  if (!props.account) return null;
  const row = props.account;
  const webJwt = row.token ? decodeURIComponent(row.token).split("::")[1] : null;
  return {
    email: row.email,
    cookie: row.token || null,
    accessToken: row.access_token || null,
    refreshToken: row.refresh_token || null,
    webJwtPayload: parseJwt(webJwt),
    sessionJwtPayload: parseJwt(row.access_token),
    hasSessionToken: !!row.access_token,
  };
});

function close() {
  emit("update:modelValue", false);
}

async function copyText(text, key) {
  await navigator.clipboard.writeText(text);
  copiedKeys.value.add(key);
  setTimeout(() => copiedKeys.value.delete(key), 2000);
}
</script>

<template>
  <Transition name="modal">
    <div v-if="modelValue && detail" class="fixed inset-0 z-50 flex items-center justify-center no-drag p-4">
      <div class="absolute inset-0 bg-black/30 backdrop-blur-md" @click="close"></div>
      <div
        class="relative bg-apple-bg w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-apple-lg border border-white/50 flex flex-col overflow-hidden"
        v-motion
        :initial="{ opacity: 0, scale: 0.95, y: 10 }"
        :enter="{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', damping: 25 } }"
      >
        <div class="px-6 py-4 border-b border-apple-border flex justify-between items-center bg-white/80 shrink-0">
          <h3 class="font-bold text-apple-text text-lg">Token 检查器</h3>
          <button class="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-apple-textMuted transition-colors" @click="close">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="p-6 overflow-y-auto flex-1 bg-white/30">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-10 h-10 rounded-full bg-apple-accent/10 flex items-center justify-center text-apple-accent"><Key class="w-5 h-5" /></div>
            <div class="text-xl font-black">{{ detail.email }}</div>
          </div>

          <div class="space-y-6">
            <!-- Session Token -->
            <div class="bg-white rounded-xl border border-apple-border p-4 shadow-sm">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-apple-text">Session Token (IDE 使用)</span>
                  <span :class="['px-2 py-0.5 rounded text-[10px] font-bold tracking-wide', detail.hasSessionToken ? 'bg-apple-success/10 text-apple-success' : 'bg-apple-danger/10 text-apple-danger']">
                    {{ detail.hasSessionToken ? '可用' : '缺失' }}
                  </span>
                </div>
                <button v-if="detail.accessToken" class="text-xs font-semibold text-apple-accent hover:bg-apple-accent/10 px-2.5 py-1 rounded transition-colors flex items-center gap-1.5" @click="copyText(detail.accessToken, 'access')">
                  <Check v-if="copiedKeys.has('access')" class="w-3.5 h-3.5 text-apple-success" />
                  <Copy v-else class="w-3.5 h-3.5" />
                  {{ copiedKeys.has('access') ? '已复制' : '复制' }}
                </button>
              </div>
              <template v-if="detail.accessToken">
                <div class="bg-black/5 p-3 rounded-lg font-mono text-[11px] text-apple-textMuted break-all overflow-hidden mb-3 border border-black/5 cursor-text select-text">
                  {{ detail.accessToken.substring(0, 180) }}{{ detail.accessToken.length > 180 ? '...' : '' }}
                </div>
                <div v-if="detail.sessionJwtPayload" class="flex flex-wrap gap-4 text-[11px] font-medium px-1">
                  <span class="text-apple-textMuted">Type: <span class="font-bold text-apple-text">{{ detail.sessionJwtPayload.type || '未知' }}</span></span>
                  <span class="text-apple-textMuted">Expires: <span class="font-bold text-apple-text">{{ new Date(detail.sessionJwtPayload.exp * 1000).toLocaleString() }}</span></span>
                </div>
              </template>
              <div v-else class="text-sm font-medium text-apple-textMuted/60 px-1 py-2">需要使用网页 Cookie 重新签发获取此 Token。</div>
            </div>

            <!-- Web Cookie -->
            <div class="bg-white rounded-xl border border-apple-border p-4 shadow-sm">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-apple-text">Web Cookie (网页登录凭证)</span>
                  <span :class="['px-2 py-0.5 rounded text-[10px] font-bold tracking-wide', detail.cookie ? 'bg-apple-success/10 text-apple-success' : 'bg-apple-danger/10 text-apple-danger']">
                    {{ detail.cookie ? '可用' : '缺失' }}
                  </span>
                </div>
                <button v-if="detail.cookie" class="text-xs font-semibold text-apple-accent hover:bg-apple-accent/10 px-2.5 py-1 rounded transition-colors flex items-center gap-1.5" @click="copyText(detail.cookie, 'cookie')">
                  <Check v-if="copiedKeys.has('cookie')" class="w-3.5 h-3.5 text-apple-success" />
                  <Copy v-else class="w-3.5 h-3.5" />
                  {{ copiedKeys.has('cookie') ? '已复制' : '复制' }}
                </button>
              </div>
              <template v-if="detail.cookie">
                <div class="bg-black/5 p-3 rounded-lg font-mono text-[11px] text-apple-textMuted break-all overflow-hidden mb-3 border border-black/5 cursor-text select-text">
                  {{ detail.cookie.substring(0, 180) }}{{ detail.cookie.length > 180 ? '...' : '' }}
                </div>
                <div v-if="detail.webJwtPayload" class="flex flex-wrap gap-4 text-[11px] font-medium px-1">
                  <span class="text-apple-textMuted">Type: <span class="font-bold text-apple-text">{{ detail.webJwtPayload.type || '未知' }}</span></span>
                  <span class="text-apple-textMuted">Expires: <span class="font-bold text-apple-text">{{ new Date(detail.webJwtPayload.exp * 1000).toLocaleString() }}</span></span>
                </div>
              </template>
              <div v-else class="text-sm font-medium text-apple-textMuted/60 px-1 py-2">未保存网页 Cookie 数据。</div>
            </div>
          </div>
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
