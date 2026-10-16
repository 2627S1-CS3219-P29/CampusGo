<template>
  <v-container class="py-6" max-width="820">
    <!-- Back to wherever the user came from -->
    <v-btn class="mb-4" prepend-icon="mdi-arrow-left" variant="text" @click="goBack">Back</v-btn>

    <!-- Show placeholder outline while the errand is loading -->
    <v-skeleton-loader v-if="isLoading" type="heading, list-item-two-line, list-item-three-line, actions" />

    <!-- Show not found state if the errand doesn't exist or isn't visible to this user -->
    <v-empty-state
      v-else-if="!order"
      icon="mdi-package-variant-remove"
      text="It may not exist, or it is no longer open and you are not part of it."
      title="Errand not found"
    >
      <template #actions>
        <v-btn :to="{ name: 'request-errand' }" variant="tonal">Request an Errand</v-btn>
      </template>
    </v-empty-state>

    <template v-else>
      <!-- Header card like the supplier page: supplier photo banner, title, status and the viewer's role -->
      <v-card class="mb-4" rounded="lg">
        <supplier-image v-if="supplier" :height="260" :supplier="supplier" />

        <div v-else class="d-flex align-center justify-center bg-grey-lighten-3" style="height: 260px">
          <v-icon color="grey" size="48">{{ order.pickupType === 'BUILDING' ? 'mdi-office-building-outline' : 'mdi-store-outline' }}</v-icon>
        </div>

        <v-card-item>
          <v-card-title class="text-h5 text-wrap">{{ order.itemDescription }}</v-card-title>
        </v-card-item>

        <v-card-text>
          <div class="d-flex flex-wrap ga-1 mb-3">
            <v-chip :color="statusInfo.color" label :prepend-icon="statusInfo.icon" size="small">
              {{ statusInfo.label }}
            </v-chip>

            <v-chip
              v-if="isOverdue(order, now)"
              color="error"
              label
              prepend-icon="mdi-alert-outline"
              size="small"
            >Overdue</v-chip>

            <v-chip v-if="myRole" label size="small" variant="outlined">{{ myRole }}</v-chip>
          </div>

          <span class="text-body-2 text-medium-emphasis">
            Requested {{ formatDateTime(order.createdAt) }} · deadline {{ formatDateTime(order.expiresAt) }}
            <span v-if="deadlineLabel(order, now)"> · {{ deadlineLabel(order, now) }}</span>
          </span>
        </v-card-text>
      </v-card>

      <!-- Progress: the happy path, or why it stopped -->
      <v-card class="mb-4" rounded="lg">
        <v-card-text>
          <v-alert
            v-if="order.status === 'CANCELLED' || order.status === 'EXPIRED'"
            :icon="statusInfo.icon"
            :text="order.status === 'CANCELLED'
              ? 'This errand was cancelled. Any reserved credits are returned to the requester.'
              : order.courierId === null
                ? 'No courier accepted this errand in time, so it expired. Any reserved credits are returned to the requester.'
                : 'The courier did not complete this errand in time, so it expired. Any reserved credits are returned to the requester.'"
            :title="statusInfo.label"
            :type="order.status === 'CANCELLED' ? 'info' : 'warning'"
            variant="tonal"
          />

          <div v-else class="progress">
            <div
              v-for="(step, i) in PROGRESS_STEPS"
              :key="step.status"
              class="progress-step"
              :class="{ 'is-done': i <= currentStep, 'is-current': i === currentStep }"
            >
              <v-avatar :color="i <= currentStep ? 'primary' : 'grey-lighten-2'" size="32">
                <v-icon :color="i <= currentStep ? 'white' : 'grey'" size="18">
                  {{ i < currentStep || order.status === 'DELIVERED' ? 'mdi-check' : orderStatusInfo[step.status].icon }}
                </v-icon>
              </v-avatar>

              <span class="text-caption mt-1" :class="i === currentStep ? 'font-weight-bold' : 'text-medium-emphasis'">
                {{ step.label }}
              </span>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Once collected, the requester has nothing to do: the courier completes it, or it expires -->
      <v-alert
        v-if="order.status === 'COLLECTED' && order.requesterId === myId"
        class="mb-4"
        density="compact"
        icon="mdi-information-outline"
        :text="isOverdue(order, now)
          ? `The courier is past the deadline. If they do not deliver by ${formatDateTime(new Date(expiryTime(order)!).toISOString())}, the errand expires and your credits are returned.`
          : 'The courier has your item and will mark the errand as delivered when they hand it over. It can no longer be cancelled.'"
        type="info"
        variant="tonal"
      />

      <!-- Actions the viewer can take right now -->
      <div v-if="actions.length > 0" class="d-flex flex-wrap ga-2 mb-4">
        <v-btn
          v-for="action in actions"
          :key="action.target"
          :color="action.color"
          :prepend-icon="action.icon"
          :variant="action.target === 'CANCELLED' ? 'outlined' : 'flat'"
          @click="pendingAction = action"
        >
          {{ action.label }}
        </v-btn>
      </div>

      <!-- Details -->
      <v-card rounded="lg">
        <v-list class="py-2" lines="two">
          <v-list-item
            :prepend-icon="order.pickupType === 'BUILDING' ? 'mdi-office-building-marker-outline' : 'mdi-store-marker-outline'"
            :subtitle="order.pickupLocation"
            title="Pickup from"
          >
            <template v-if="order.supplierId !== null" #append>
              <v-btn
                size="small"
                :to="{ name: 'supplier', params: { id: order.supplierId } }"
                variant="text"
              >
                View supplier
              </v-btn>
            </template>
          </v-list-item>

          <v-list-item prepend-icon="mdi-map-marker-outline" :subtitle="order.dropoffLocation" title="Deliver to" />

          <v-list-item prepend-icon="mdi-package-variant" title="Item">
            <v-list-item-subtitle class="text-wrap">{{ order.itemDescription }}</v-list-item-subtitle>
          </v-list-item>

          <v-list-item v-if="order.additionalDetails" prepend-icon="mdi-text-box-outline" title="Additional details">
            <v-list-item-subtitle class="text-wrap">{{ order.additionalDetails }}</v-list-item-subtitle>
          </v-list-item>

          <v-list-item
            prepend-icon="mdi-hand-coin-outline"
            :subtitle="`${order.creditBounty} credit${order.creditBounty === 1 ? '' : 's'}`"
            title="Credits offered"
          />

          <v-divider class="my-2" />

          <v-list-item
            prepend-icon="mdi-account-outline"
            :subtitle="personLabel(order.requesterId, myId)"
            title="Requester"
          />

          <v-list-item
            prepend-icon="mdi-bike-fast"
            :subtitle="personLabel(order.courierId, myId)"
            title="Courier"
          />
        </v-list>
      </v-card>

      <p v-if="isActive(order.status)" class="text-caption text-medium-emphasis mt-3">
        <v-icon size="small" start>mdi-refresh</v-icon>Updates automatically while the errand is in progress.
      </p>
    </template>

    <!-- Confirm before changing the status -->
    <v-dialog max-width="440" :model-value="pendingAction !== null" :persistent="isUpdating" @update:model-value="pendingAction = null">
      <v-card v-if="pendingAction" rounded="lg">
        <v-card-title class="pt-5 px-6">{{ pendingAction.label }}?</v-card-title>

        <v-card-text class="px-6">
          <v-alert
            v-if="pendingAction.warning"
            class="mb-3"
            density="compact"
            :text="pendingAction.warning"
            type="warning"
            variant="tonal"
          />
          {{ pendingAction.confirm }}
        </v-card-text>

        <v-card-actions class="px-6 pb-4">
          <v-spacer />
          <v-btn :disabled="isUpdating" variant="text" @click="pendingAction = null">Not now</v-btn>

          <v-btn :color="pendingAction.color" :loading="isUpdating" variant="flat" @click="confirmAction">
            {{ pendingAction.label }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Supplier } from '@/api/supplier'
  import axios from 'axios'
  import { computed, onUnmounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { getOrder, type Order, updateOrderStatus } from '@/api/order'
  import SupplierImage from '@/components/SupplierImage.vue'
  import { useAlertStore } from '@/stores/alerts'
  import { useAuthStore } from '@/stores/auth'
  import { useClock, useExpiryReload } from '@/util/clock'
  import {
    apiErrorMessage,
    availableActions,
    deadlineLabel,
    expiryTime,
    formatDateTime,
    isActive,
    isOverdue,
    type OrderAction,
    orderStatusInfo,
    personLabel,
    PROGRESS_STEPS,
    progressIndex,
  } from '@/util/order'
  import { getSupplierCached } from '@/util/supplierCache'

  // how often an active errand is refreshed, so both sides see progress without reloading
  const REFRESH_MS = 10_000

  const route = useRoute()
  const router = useRouter()
  const alertStore = useAlertStore()
  const auth = useAuthStore()

  const order = ref<Order | null>(null)
  // the pickup supplier, for the photo banner
  const supplier = ref<Supplier | null>(null)
  const isLoading = ref(true)
  const isUpdating = ref(false)
  const pendingAction = ref<OrderAction | null>(null)
  // ticks every second for the countdown and so buttons disappear the moment an errand expires
  const now = useClock()

  const myId = computed(() => auth.userId === null ? null : Number(auth.userId))
  const statusInfo = computed(() => orderStatusInfo[order.value?.status ?? 'OPEN'])
  const currentStep = computed(() => order.value ? progressIndex(order.value.status) : -1)
  const actions = computed(() => order.value ? availableActions(order.value, myId.value, now.value) : [])
  const myRole = computed(() => {
    if (!order.value || myId.value === null) {
      return null
    }
    if (order.value.requesterId === myId.value) {
      return 'You requested this'
    }
    return order.value.courierId === myId.value ? 'You are delivering this' : null
  })

  async function loadOrder (id: string, showLoading: boolean) {
    if (showLoading) {
      isLoading.value = true
      order.value = null
    }
    try {
      order.value = await getOrder(id)
    } catch (error) {
      // 404 shows the not found state
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      if (status === 404) {
        order.value = null
      } else if (showLoading) {
        console.error('Error loading errand', error)
        alertStore.error(apiErrorMessage(error, 'Could not load the errand'))
      }
    } finally {
      isLoading.value = false
    }
  }

  async function confirmAction () {
    if (!order.value || !pendingAction.value) {
      return
    }
    const action = pendingAction.value
    isUpdating.value = true
    try {
      order.value = await updateOrderStatus(order.value.id, action.target)
      alertStore.success(`${action.label}: done`)
      pendingAction.value = null
    } catch (error) {
      // e.g. "Order was already accepted by another courier"; reload to show what changed
      alertStore.error(apiErrorMessage(error, `Could not ${action.label.toLowerCase()}`))
      pendingAction.value = null
      await loadOrder(order.value.id, false)
    } finally {
      isUpdating.value = false
    }
  }

  function goBack () {
    if (window.history.state?.back) {
      router.back()
    } else {
      router.push({ name: 'dashboard' })
    }
  }

  // refresh active errands in the background while the page is open
  const timer = setInterval(() => {
    if (order.value && isActive(order.value.status) && !isUpdating.value && document.visibilityState === 'visible') {
      loadOrder(order.value.id, false)
    }
  }, REFRESH_MS)
  onUnmounted(() => clearInterval(timer))

  // reload the moment an open errand expires, so "Expired" shows straight away
  useExpiryReload(() => order.value ? [order.value] : [], () => {
    if (order.value) {
      loadOrder(order.value.id, false)
    }
  })

  watch(() => route.params.id as string, id => loadOrder(id, true), { immediate: true })

  // shared cache, so the photo is not fetched again on every refresh
  watch(() => order.value?.supplierId, async id => {
    // building pickups have no supplier, so no photo
    supplier.value = id === undefined || id === null ? null : await getSupplierCached(id)
  })
</script>

<style scoped>
.progress {
  display: flex;
  justify-content: space-between;
  position: relative;
}

/* line behind the steps */
.progress::before {
  content: '';
  position: absolute;
  top: 16px;
  left: 12%;
  right: 12%;
  height: 2px;
  background: rgba(var(--v-border-color), var(--v-border-opacity));
}

.progress-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  position: relative;
  text-align: center;
}
</style>
