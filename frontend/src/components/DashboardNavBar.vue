<template>
  <!-- TODO: navigation highlighting and updating of title -->
  <v-layout class="fullscreen">
    <v-navigation-drawer
      permanent
      expand-on-hover
      rail
    >
      <v-list density="compact" nav>
        <v-list-item to="/" prepend-icon="mdi-home" title="Dashboard" />
        <v-list-item to="/login" prepend-icon="mdi-lock" title="Login" />
      </v-list>
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
  </v-layout>
</template>

<script lang="ts" setup>
import { ref } from 'vue';

const isNavbarOpened = ref(false);
</script>

<style scoped>
.fullscreen {
  height: 100%;
  width: 100%;
}
</style>