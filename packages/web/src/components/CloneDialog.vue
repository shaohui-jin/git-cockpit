<script setup lang="ts">
defineProps<{
  retrying: boolean;
  loading: boolean;
}>();

const visible = defineModel<boolean>('visible', { required: true });
const url = defineModel<string>('url', { required: true });
const dest = defineModel<string>('dest', { required: true });

const emit = defineEmits<{
  submit: [];
}>();
</script>

<template>
  <el-dialog v-model="visible" :title="retrying ? '修改并重新克隆' : '克隆到本地'" width="560px">
    <el-alert
      class="mb"
      title="提交后后台克隆，不占用当前仓库队列。地址不要带 token。完成后会自动加入仓库一览。"
      type="info"
      :closable="false"
      show-icon
    />
    <el-form label-width="100px">
      <el-form-item label="项目地址">
        <el-input v-model="url" placeholder="https://github.com/org/repo.git 或 git@host:org/repo.git" />
      </el-form-item>
      <el-form-item label="保存到">
        <el-input v-model="dest" placeholder="本地空目录的绝对路径，例如 D:\_myproject\repo" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="emit('submit')">开始克隆</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mb {
  margin-bottom: var(--gc-gap);
}
</style>
