/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 */

// Composables
import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '@/pages/dashboard.vue'
import Login from '@/pages/login.vue'
import DashboardNavBar from '@/components/DashboardNavBar.vue'

const routes = [
    {
        path: '/',
        component: DashboardNavBar,
        children: [
            { path: "", name: "dashboard", component: Dashboard },
        ]
    },
    { path: '/login', component: Login },
]

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
})

export default router
