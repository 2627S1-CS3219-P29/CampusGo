// AI assistance (26/9/2026): codex
// generated worker followed my design requirements for extracting the metrics i specified. it also added heartbeats and query duration metrics, which was a nice bonus.

import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import log from "../log.ts";
import { meter, queueDurationOptions } from "./instruments.ts";

/** One SQL statement reads a consistent durable backlog, independently of the publisher. */
export interface OutboxSnapshot {
    ready: number;
    delayed: number;
    failed: number;
    oldestPendingAge: number;
}

/**
 * Poll outside request context, with no overlap or database calls during OTLP export.
 * A failed read retains the previous snapshot until staleAfterMs, never fabricating zero backlog.
 * stop() removes callbacks/timers and waits for any in-flight read; it does not cancel DB queries.
 */
export class OutboxMetricsMonitor {
    private snapshot?: OutboxSnapshot;
    private lastSuccess = 0;
    private collecting?: Promise<void>;
    private timer?: ReturnType<typeof setTimeout>;
    private running = false;
    private disposed = false;

    private readonly backlog = meter.createObservableGauge("campusgo.outbox.backlog", { unit: "1" });
    private readonly oldest = meter.createObservableGauge("campusgo.outbox.oldest_pending.age", { unit: "s" });
    private readonly available = meter.createObservableGauge("campusgo.outbox.snapshot.available", { unit: "1" });
    private readonly last = meter.createObservableGauge("campusgo.outbox.snapshot.last_success", { unit: "s" });
    private readonly heartbeat = meter.createObservableGauge("campusgo.telemetry.heartbeat", { unit: "s" });
    private readonly failures = meter.createCounter("campusgo.outbox.snapshot.failures", { unit: "1" });
    private readonly duration = meter.createHistogram("campusgo.outbox.snapshot.duration", queueDurationOptions);

    constructor(
        private readonly read: () => Promise<OutboxSnapshot>,
        private readonly now = Date.now,
        private readonly intervalMs = 30000,
        private readonly staleAfterMs = 90000,
    ) {
        this.backlog.addCallback(this.observeBacklog);
        this.oldest.addCallback(this.observeOldest);
        this.available.addCallback(this.observeAvailable);
        this.last.addCallback(this.observeLast);
        this.heartbeat.addCallback(this.observeHeartbeat);
    }

    private isFresh = () => this.snapshot !== undefined && this.now() - this.lastSuccess <= this.staleAfterMs;

    private observeBacklog = (result: { observe: (value: number, attributes?: Record<string, string>) => void }) => {
        if (this.isFresh()) {
            for (const state of ["ready", "delayed", "failed"] as const)
                result.observe(this.snapshot![state], { state });
        }
    };

    private observeOldest = (result: { observe: (value: number) => void }) => {
        if (this.isFresh()) {
            const pending = this.snapshot!.ready + this.snapshot!.delayed;
            result.observe(pending ? this.snapshot!.oldestPendingAge + (this.now() - this.lastSuccess) / 1000 : 0);
        }
    };

    private observeAvailable = (result: { observe: (value: number) => void }) => result.observe(this.isFresh() ? 1 : 0);
    private observeLast = (result: { observe: (value: number) => void }) => result.observe(this.lastSuccess / 1000);
    private observeHeartbeat = (result: { observe: (value: number) => void }) => result.observe(this.now() / 1000);

    /** Refresh once; concurrent requests share the same read, useful for deterministic unit tests. */
    refresh(): Promise<void> {
        if (this.disposed)
            return Promise.resolve();
        return this.collecting ??= context.with(ROOT_CONTEXT, async () => {
            const start = performance.now();
            let outcome = "success";
            try {
                const snapshot = await this.read();
                log.debug(`snapshot taken ${JSON.stringify(snapshot)}`);
                if (Object.values(snapshot).some(value => !Number.isFinite(value) || value < 0))
                    throw new Error("Invalid outbox metrics snapshot");
                this.snapshot = snapshot;
                this.lastSuccess = this.now();
            } catch (error) {
                outcome = "error";
                this.failures.add(1);
                log.warn(`Outbox metrics snapshot failed: ${error}`);
            } finally {
                this.duration.record((performance.now() - start) / 1000, { outcome });
            }
        }).finally(() => { this.collecting = undefined; });
    }

    /** Start immediately, then schedule the next poll only after the previous read settles. */
    start(): void {
        if (this.running || this.disposed)
            return;
        this.running = true;
        const poll = async () => {
            await this.refresh();
            if (this.running)
                this.timer = setTimeout(() => { poll(); }, this.intervalMs);
        };
        poll();
    }

    /** Dispose this monitor once; a stopped instance must not be restarted. */
    async stop(): Promise<void> {
        this.running = false;
        this.disposed = true;
        clearTimeout(this.timer);
        await this.collecting;
        this.backlog.removeCallback(this.observeBacklog);
        this.oldest.removeCallback(this.observeOldest);
        this.available.removeCallback(this.observeAvailable);
        this.last.removeCallback(this.observeLast);
        this.heartbeat.removeCallback(this.observeHeartbeat);
    }
}
