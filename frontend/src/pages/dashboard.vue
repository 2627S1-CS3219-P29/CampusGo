<template>
  <v-container class="py-6" max-width="1200">
    <h1 class="text-h5 font-weight-bold mb-1">Dashboard</h1>

    <p class="text-body-2 text-medium-emphasis mb-4">
      Your errands in progress, as a requester and as a courier.
    </p>

    <!-- Quick actions -->
    <v-row class="mb-2" dense>
      <v-col cols="12" sm="4">
        <v-card
          class="h-full"
          color="primary"
          rounded="lg"
          :to="{ name: 'request-errand' }"
          variant="flat"
        >
          <v-card-item prepend-icon="mdi-plus-box-outline" subtitle="Get something collected for you" title="Request Errand" />
        </v-card>
      </v-col>

      <v-col cols="12" sm="4">
        <v-card class="h-full" rounded="lg" :to="{ name: 'open-errands' }" variant="tonal">
          <v-card-item
            prepend-icon="mdi-bike-fast"
            :subtitle="openCount === null ? 'Deliver for others and earn credits' : `${openCount} waiting for a courier`"
            title="Open Errands"
          />
        </v-card>
      </v-col>

      <v-col cols="12" sm="4">
        <v-card class="h-full" rounded="lg" :to="{ name: 'my-errands' }" variant="tonal">
          <v-card-item prepend-icon="mdi-clipboard-list-outline" subtitle="Everything you requested or delivered" title="My Errands" />
        </v-card>
      </v-col>
    </v-row>

    <!-- My active errands, one section per role -->
    <section v-for="section in sections" :key="section.tab" class="mt-6">
      <div class="d-flex align-center justify-space-between mb-2">
        <h2 class="text-h6">
          {{ section.title }}
          <span v-if="!isLoading" class="text-medium-emphasis">({{ section.total }})</span>
        </h2>

        <v-btn
          v-if="section.total > 0"
          size="small"
          :to="{ name: 'my-errands', query: { tab: section.tab, view: 'active' } }"
          variant="text"
        >
          See all
        </v-btn>
      </div>

      <v-skeleton-loader v-if="isLoading" type="card" />

      <v-card v-else-if="section.errands.length === 0" class="pa-4 text-medium-emphasis" rounded="lg" variant="outlined">
        {{ section.empty }}
      </v-card>

      <v-row v-else>
        <v-col
          v-for="errand in section.errands"
          :key="errand.id"
          cols="12"
          md="4"
          sm="6"
        >
          <errand-card :errand="errand" :now="now" show-status />
        </v-col>
      </v-row>
    </section>
  </v-container>
</template>

<script lang="ts" setup>
  import { onMounted, onUnmounted, ref } from 'vue'
  import { listOrders, type Order } from '@/api/order'
  import ErrandCard from '@/components/ErrandCard.vue'
  import { useClock, useExpiryReload } from '@/util/clock'
  import { ACTIVE_STATUSES } from '@/util/order'

  // keep the overview current as couriers and requesters act
  const REFRESH_MS = 30_000
  // cards shown per section; "See all" opens the full list
  const PREVIEW_COUNT = 6

  interface Section {
    tab: 'requested' | 'delivering'
    title: string
    empty: string
    errands: Order[]
    total: number
  }

  const sections = ref<Section[]>([
    { tab: 'requested', title: 'You requested', empty: 'No errands in progress. Request one when you need something collected.', errands: [], total: 0 },
    { tab: 'delivering', title: 'You\'re delivering', empty: 'You are not delivering anything right now. Browse open errands to earn credits.', errands: [], total: 0 },
  ])
  const openCount = ref<number | null>(null)
  const isLoading = ref(true)
  // ticks every second for the "expires in" countdown
  const now = useClock()

  async function loadOverview () {
    try {
      const [requested, delivering, open] = await Promise.all([
        listOrders({ scope: 'requested', statuses: ACTIVE_STATUSES, page: 1 }),
        listOrders({ scope: 'delivering', statuses: ACTIVE_STATUSES, page: 1 }),
        listOrders({ scope: 'open', page: 1 }),
      ])
      for (const [section, result] of [[sections.value[0]!, requested], [sections.value[1]!, delivering]] as const) {
        section.errands = result.data.slice(0, PREVIEW_COUNT)
        section.total = result.pagination.total
      }
      openCount.value = open.pagination.total
    } catch (error) {
      // the overview is best effort; each list page shows its own errors
      console.error('Error loading dashboard', error)
    } finally {
      isLoading.value = false
    }
  }

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadOverview()
    }
  }, REFRESH_MS)
  onUnmounted(() => clearInterval(timer))

  // when a shown errand expires, reload so it drops out of the overview straight away
  useExpiryReload(() => sections.value.flatMap(s => s.errands), loadOverview)

  onMounted(loadOverview)
</script>
