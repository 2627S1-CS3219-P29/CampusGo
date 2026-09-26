<template>
  <v-container class="auth-page" fluid>
    <v-card class="pa-8 text-center" width="100%" max-width="360" rounded="xl" elevation="12">
      <v-progress-circular indeterminate color="primary" class="mb-4" />
      <p class="text-body-1">Logging out...</p>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vuetify/lib/composables/router.mjs';

const authStore = useAuthStore();
const router = useRouter();

onMounted(async () => {
  try {
    await authStore.logout();
  } catch (error) {
    console.error('Logout request failed, clearing session locally anyway', error);
  } finally {
    router?.push({ name: 'login', query: { message: 'logged-out' } });
  }
});
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: linear-gradient(135deg, #eef2ff 0%, #f8fafc 50%, #e8f4ff 100%);
}
</style>