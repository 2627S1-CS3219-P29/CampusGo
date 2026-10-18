<template>
  <v-container class="py-6" max-width="1200">
    <h1 class="text-h5 font-weight-bold mb-4">Dashboard</h1>

    <!-- Credits: what the user can spend, and what is held for errands they requested -->
    <section>
      <h2 class="text-h6 mb-2">Credits</h2>

      <v-skeleton-loader v-if="credits.balance === null && !credits.problem" type="card" />

      <v-card v-else-if="credits.problem" class="pa-4 text-medium-emphasis" rounded="lg" variant="outlined">
        {{ credits.problem === 'missing'
          ? 'You do not have a credit account yet. It is created when you register; try again shortly.'
          : 'Could not load your credits right now. Try again later.' }}
      </v-card>

      <v-card v-else rounded="lg" variant="outlined">
        <v-row class="pa-2" dense>
          <v-col cols="6">
            <v-card-item prepend-icon="mdi-hand-coin-outline" subtitle="Available to spend">
              <v-card-title class="text-h4 font-weight-bold">{{ credits.balance }}</v-card-title>
            </v-card-item>
          </v-col>

          <v-col cols="6">
            <v-card-item prepend-icon="mdi-lock-clock" subtitle="On hold for your errands">
              <v-card-title class="text-h4 font-weight-bold">{{ credits.onHold }}</v-card-title>
            </v-card-item>
          </v-col>
        </v-row>

        <template v-if="credits.activeHolds.length > 0">
          <v-divider />

          <v-list density="compact">
            <v-list-subheader>Held until each errand is completed (paid to the courier) or cancelled (refunded to you)</v-list-subheader>

            <v-list-item
              v-for="hold in credits.activeHolds"
              :key="hold.errandId"
              prepend-icon="mdi-package-variant"
              :title="`Errand #${hold.errandId}`"
            >
              <template #append>
                <span class="font-weight-medium">{{ hold.amount }} credit{{ hold.amount === 1 ? '' : 's' }}</span>
              </template>
            </v-list-item>
          </v-list>
        </template>
      </v-card>
    </section>
  </v-container>
</template>

<script lang="ts" setup>
  import { useCreditStore } from '@/stores/credit'

  // loaded and kept fresh by the app bar
  const credits = useCreditStore()
</script>
