import type { DB } from "../db.ts";

export type LifecycleState =
  | "Created"
  | "Booting"
  | "DatabaseReady"
  | "HttpReady"
  | "Ready"
  | "Running"
  | "Draining"
  | "Stopped";

export type LifecycleStage = {
  stage: string;
  duration_ms: number;
  failure_reason?: string;
};

/** Runtime-owned lifecycle and shutdown coordinator. */
export class Application {
  private _state: LifecycleState = "Created";
  private shutdownPromise: Promise<void> | null = null;
  private readonly stages: LifecycleStage[] = [];

  constructor(
    private readonly db: DB,
    private pidFile?: string,
  ) {}

  get state(): LifecycleState {
    return this._state;
  }
  get stageLog(): readonly LifecycleStage[] {
    return this.stages;
  }

  setPidFile(path: string): void {
    this.pidFile = path;
  }

  recordStage(stage: string, durationMs: number): void {
    const entry = { stage, duration_ms: Math.round(durationMs * 100) / 100 };
    this.stages.push(entry);
    console.info(JSON.stringify({ event: "lifecycle.stage", ...entry }));
  }

  transition(state: LifecycleState): void {
    this._state = state;
  }

  async stage<T>(name: string, work: () => T | Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const value = await work();
      this.stages.push({
        stage: name,
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
      });
      console.info(
        JSON.stringify({
          event: "lifecycle.stage",
          stage: name,
          duration_ms: this.stages.at(-1)?.duration_ms,
        }),
      );
      return value;
    } catch (error) {
      const failure_reason = error instanceof Error
        ? error.message
        : String(error);
      this.stages.push({
        stage: name,
        duration_ms: Math.round(performance.now() - started),
        failure_reason,
      });
      console.error(
        JSON.stringify({
          event: "lifecycle.stage.failed",
          stage: name,
          failure_reason,
        }),
      );
      throw error;
    }
  }

  async shutdown(reason = "requested"): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = (async () => {
      if (this._state === "Stopped") return;
      this.transition("Draining");
      console.info(JSON.stringify({ event: "lifecycle.shutdown", reason }));
      try {
        this.db.closeActiveSessions();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "lifecycle.shutdown.sessions_failed",
            reason: String(error),
          }),
        );
      }
      try {
        this.db.close();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "lifecycle.shutdown.database_failed",
            reason: String(error),
          }),
        );
      }
      if (this.pidFile) {
        try {
          await Deno.remove(this.pidFile);
        } catch { /* already absent */ }
      }
      this.transition("Stopped");
    })();
    return this.shutdownPromise;
  }
}
