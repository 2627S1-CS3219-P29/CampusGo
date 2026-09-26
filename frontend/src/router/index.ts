/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 */

// Composables
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import Dashboard from '@/pages/dashboard.vue'
import Login from '@/pages/login.vue'
import Logout from '@/pages/logout.vue'
import DashboardNavBar from '@/components/DashboardNavBar.vue'
import { useAuthStore } from '@/stores/auth';
import { watch } from 'vue';

const routes: RouteRecordRaw[] = [
    {
        path: "/",
        component: DashboardNavBar,
        children: [
            { path: "", name: "dashboard", component: Dashboard },
        ],
        meta: { isAuthRequired: true }
    },
    { path: '/login', name: "login", component: Login },
    { path: '/logout', name: "logout", component: Logout },
];

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
});

router.beforeEach(route => {
    const auth = useAuthStore();

    // navigation occurs to protected page without stored tokens, redirect to login
    if (route.meta.isAuthRequired && !auth.isAuthenticated) {
        return { path: "/login" };
    }

    if (route.name === "login" && auth.isAuthenticated) {
        return { path: "/" };
    }
});

/**
 * Edge case: handle redirection in the case where auth changes (during a request) while on a protected page.
 * Workaround: pinia not yet activated (since we are still within plugin init cycle)
 */
export const initCredentialWatcher = () => {
    const auth = useAuthStore();
    watch(
        () => auth.isAuthenticated,
        isAuthed => {
            if (isAuthed)
                return;
            const route = router.currentRoute.value;
            if (route.meta.isAuthRequired) {
                router.push({ path: "/login" });
            }
        }
    )
}

export default router