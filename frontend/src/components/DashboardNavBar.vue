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
        <v-list-item to="/errands/new" prepend-icon="mdi-plus-box-outline" title="Request Errand" />
        <v-list-item to="/errands" prepend-icon="mdi-bike-fast" title="Open Errands" exact />
        <v-list-item to="/my-errands" prepend-icon="mdi-clipboard-list-outline" title="My Errands" />
        <v-list-item v-if="auth.isAdmin" to="/admin/users" prepend-icon="mdi-account-group" title="Users" />
      </v-list>

      <template #append>
        <v-list density="compact" nav>
          <v-list-item
            prepend-icon="mdi-account-circle"
            title="Profile"
            to="/profile"
          />
          <v-list-item
            prepend-icon="mdi-logout"
            title="Log out"
            @click="isLogoutOpen = true"
          />
        </v-list>
      </template>

    </v-navigation-drawer>

    <v-app-bar :order="-1">
      <template v-slot:prepend>
        <v-app-bar-nav-icon @click="isNavbarOpened = !isNavbarOpened" />
      </template>
  
      <v-app-bar-title>Application Bar</v-app-bar-title>
    </v-app-bar>

    <v-main class="fullscreen">
      <router-view /> 
    </v-main>

    <global-alerts/>

    <!-- Confirm before logging out, so a stray click on the menu does not sign the user out -->
    <v-dialog v-model="isLogoutOpen" max-width="400">
      <v-card rounded="lg">
        <v-card-title class="pt-5 px-6">Log out?</v-card-title>
        <v-card-text class="px-6">You will need to log in again to use CampusGo.</v-card-text>

        <v-card-actions class="px-6 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="isLogoutOpen = false">Cancel</v-btn>
          <v-btn color="error" prepend-icon="mdi-logout" variant="flat" @click="logout">Log out</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-layout>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import GlobalAlerts from './GlobalAlerts.vue';

const isNavbarOpened = ref(false);
// admins also see the Users page
const auth = useAuthStore();
const router = useRouter();

const isLogoutOpen = ref(false);

// forgets both tokens in this browser, then shows the login page.
// The user service has no logout endpoint yet, so the tokens stay valid until they expire
const logout = async () => {
  isLogoutOpen.value = false;
  await auth.logout();
  router.push({ name: 'login' });
};
</script>

<style scoped>
.fullscreen {
  height: 100%;
  width: 100%;
}
</style>