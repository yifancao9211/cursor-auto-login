<script setup>
import { ref } from "vue";
import { AlertTriangle, X } from "lucide-vue-next";

const visible = ref(false);
const title = ref("");
const message = ref("");
const confirmText = ref("确认");
const type = ref("danger"); // "danger" | "warning"
let _resolve = null;

function open({ title: t, message: m, confirmText: ct = "确认", type: tp = "danger" } = {}) {
  title.value = t || "确认操作";
  message.value = m || "";
  confirmText.value = ct;
  type.value = tp;
  visible.value = true;
  return new Promise((resolve) => { _resolve = resolve; });
}

function handleConfirm() {
  visible.value = false;
  _resolve?.(true);
  _resolve = null;
}

function handleCancel() {
  visible.value = false;
  _resolve?.(false);
  _resolve = null;
}

defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="fixed inset-0 z-[60] flex items-center justify-center no-drag p-4">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="handleCancel"></div>
        <div
          class="relative bg-apple-bg w-full max-w-sm rounded-2xl shadow-apple-lg border border-white/50 flex flex-col overflow-hidden"
          v-motion
          :initial="{ opacity: 0, scale: 0.92, y: 8 }"
          :enter="{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', damping: 25, stiffness: 300 } }"
        >
          <div class="px-5 py-4 border-b border-apple-border flex justify-between items-center bg-white/40">
            <h3 class="font-bold text-apple-text">{{ title }}</h3>
            <button class="w-7 h-7 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-apple-textMuted transition-colors" @click="handleCancel">
              <X class="w-4 h-4" />
            </button>
          </div>

          <div class="p-5 flex gap-4 items-start bg-white/20">
            <div :class="['w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', type === 'danger' ? 'bg-apple-danger/10 text-apple-danger' : 'bg-apple-warning/10 text-apple-warning']">
              <AlertTriangle class="w-5 h-5" />
            </div>
            <p class="text-sm text-apple-text font-medium leading-relaxed pt-2">{{ message }}</p>
          </div>

          <div class="px-5 py-4 border-t border-apple-border flex justify-end gap-3 bg-white/40">
            <button class="px-4 py-2 rounded-lg font-medium text-sm text-apple-textMuted hover:bg-black/5 transition-colors" @click="handleCancel">取消</button>
            <button
              :class="[
                'px-5 py-2 rounded-lg font-bold text-sm text-white shadow-sm transition-all active:scale-95',
                type === 'danger' ? 'bg-apple-danger hover:bg-red-600' : 'bg-apple-warning hover:bg-orange-600'
              ]"
              @click="handleConfirm"
            >{{ confirmText }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
