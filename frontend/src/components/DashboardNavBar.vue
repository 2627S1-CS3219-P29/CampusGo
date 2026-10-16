<template>
  <!-- TODO: navigation highlighting and updating of title -->
  <v-layout class="fullscreen">
    <v-navigation-drawer
      permanent
      expand-on-hover
      rail
    >
      <v-list density="compact" nav>
        <v-list-item to="/" prepend-icon="mdi-home" title="Dashboard" exact />
        <v-list-item to="/suppliers" prepend-icon="mdi-store" title="Suppliers" />
        <v-list-item to="/login" prepend-icon="mdi-lock" title="Login" />
      </v-list>

      <template #append>
        <v-list density="compact" nav>
          <v-list-item
            prepend-icon="mdi-account-circle"
            title="Profile"
            to="/profile"
          />
        </v-list>
      </template>

    </v-navigation-drawer>

    <v-app-bar :order="-1">
      <template v-slot:prepend>
        <v-app-bar-nav-icon @click="isNavbarOpened = !isNavbarOpened" />
      </template>
  
      <v-app-bar-title>Application Bar</v-app-bar-title>

      <!-- the signed-in user's credits: spendable balance, and how much is held for their open errands -->
      <template v-if="auth.isAuthenticated" v-slot:append>
        <v-chip
          class="mr-2"
          color="success"
          prepend-icon="mdi-hand-coin-outline"
          :to="{ name: 'dashboard' }"
          variant="tonal"
        >
          <template v-if="credits.balance !== null">
            {{ credits.balance }} credit{{ credits.balance === 1 ? '' : 's' }}
            <span v-if="credits.onHold > 0" class="ml-1 text-medium-emphasis">· {{ credits.onHold }} on hold</span>
          </template>
          <template v-else-if="credits.problem">Credits unavailable</template>
          <template v-else>Loading credits…</template>
        </v-chip>
      </template>
    </v-app-bar>

    <v-main class="fullscreen">
      <router-view /> 
    </v-main>

    <global-alerts/>
  </v-layout>
</template>

<script lang="ts" setup>
import { onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useCreditStore } from '@/stores/credit';
import GlobalAlerts from './GlobalAlerts.vue';

// credits change as errands are requested, completed or cancelled
const CREDIT_REFRESH_MS = 30_000;

const isNavbarOpened = ref(false);

const auth = useAuthStore();
const credits = useCreditStore();
const route = useRoute();

// reload on every page change and when the user signs in, and every 30 s while the tab is visible
watch([() => route.fullPath, () => auth.userId], () => credits.refresh(), { immediate: true });
const creditTimer = setInterval(() => {
  if (document.visibilityState === 'visible')
    credits.refresh();
}, CREDIT_REFRESH_MS);
onUnmounted(() => clearInterval(creditTimer));
</script>

<style scoped>
.fullscreen {
  height: 100%;
  width: 100%;
}
</style>