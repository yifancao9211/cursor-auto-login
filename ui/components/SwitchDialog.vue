<script setup>
import { computed, ref } from "vue";
import { X, RefreshCcw } from "lucide-vue-next";

const props = defineProps({
  modelValue: Boolean,
  account: Object,
});

const emit = defineEmits(["update:modelValue", "confirm"]);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const resetMachineId = ref(true);

function handleConfirm() {
  emit("confirm", { resetMachineId: resetMachineId.value });
}
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center no-drag p-4">
      <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="visible = false"></div>
      
      <div class="relative bg-apple-bg w-full max-w-sm rounded-2xl shadow-apple-lg border border-white/50 flex flex-col overflow-hidden" 
           v-motion 
           :initial="{ opacity: 0, scale: 0.95, y: 10 }" 
           :enter="{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', damping: 25 } }">
        
        <div class="px-5 py-4 border-b border-apple-border flex justify-between items-center bg-white/40">
          <h3 class="font-bold text-apple-text">切换体验账号</h3>
          <button class="w-7 h-7 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-apple-textMuted transition-colors" @click="visible = false">
            <X class="w-4 h-4" />
          </button>
        </div>
        
        <div class="p-5 flex flex-col gap-4 bg-white/20" v-if="account">
          <p class="text-sm text-apple-text font-medium">确定要切换到以下账号？</p>
          
          <div class="bg-white/60 rounded-xl border border-apple-border p-3 flex flex-col gap-2">
            <div class="flex justify-between items-center text-sm">
              <span class="text-apple-textMuted">邮箱</span>
              <span class="font-bold text-apple-text truncate max-w-[180px]">{{ account.email }}</span>
            </div>
            <div class="flex justify-between items-center text-sm">
              <span class="text-apple-textMuted">订阅类型</span>
              <span :class="['px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider', account.membership_type === 'free' ? 'bg-apple-danger/10 text-apple-danger' : 'bg-apple-success/10 text-apple-success']">
                {{ account.membership_type || "未知" }}
              </span>
            </div>
          </div>
          
          <label class="flex items-start gap-3 p-3 rounded-xl bg-apple-success/10 border border-apple-success/20 cursor-pointer group hover:bg-apple-success/15 transition-colors">
            <input type="checkbox" v-model="resetMachineId" class="mt-1 w-4 h-4 rounded border-apple-success/30 text-apple-success focus:ring-apple-success/30 cursor-pointer accent-apple-success" />
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-bold text-apple-success">同时切换机器码 (推荐)</span>
              <span class="text-[11px] text-apple-success/70">为每个账号使用独立的硬件指纹。</span>
            </div>
          </label>
          
          <div class="flex items-start gap-2.5 p-3 rounded-xl bg-apple-warning/10 border border-apple-warning/20 text-apple-warning">
            <RefreshCcw class="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span class="text-xs font-semibold">此操作将关闭您当前的 Cursor 进程并强制重新启动。</span>
          </div>
        </div>
        
        <div class="px-5 py-4 border-t border-apple-border flex justify-end gap-3 bg-white/40">
          <button class="px-4 py-2 rounded-lg font-medium text-sm text-apple-textMuted hover:bg-black/5 transition-colors" @click="visible = false">取消</button>
          <button class="apple-btn-primary px-6 bg-apple-text hover:bg-black" @click="handleConfirm">确认切换</button>
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
