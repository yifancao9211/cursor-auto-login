<script setup>
import { ref, computed } from "vue";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-vue-next";

const toasts = ref([]);
let nextId = 0;

function show(message, type = "info", duration = 3000) {
  const id = nextId++;
  toasts.value.push({ id, message, type });
  if (duration > 0) {
    setTimeout(() => dismiss(id), duration);
  }
}

function dismiss(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

defineExpose({ show });
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[999] flex flex-col gap-2 pointer-events-none" style="max-width: 360px">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="[
            'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-apple-lg border backdrop-blur-xl text-sm font-medium transition-all',
            toast.type === 'success' ? 'bg-apple-success/10 border-apple-success/30 text-apple-success' :
            toast.type === 'error'   ? 'bg-apple-danger/10 border-apple-danger/30 text-apple-danger' :
            toast.type === 'warning' ? 'bg-apple-warning/10 border-apple-warning/30 text-apple-warning' :
                                       'bg-white/90 border-apple-border text-apple-text',
          ]"
        >
          <CheckCircle2 v-if="toast.type === 'success'" class="w-4 h-4 flex-shrink-0" />
          <AlertCircle v-else-if="toast.type === 'error'" class="w-4 h-4 flex-shrink-0" />
          <AlertCircle v-else-if="toast.type === 'warning'" class="w-4 h-4 flex-shrink-0" />
          <Info v-else class="w-4 h-4 flex-shrink-0" />
          <span class="flex-1">{{ toast.message }}</span>
          <button class="w-5 h-5 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors flex-shrink-0 opacity-60 hover:opacity-100" @click="dismiss(toast.id)">
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-leave-active {
  transition: all 0.2s ease-out;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(60px) scale(0.95);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.95);
}
</style>
