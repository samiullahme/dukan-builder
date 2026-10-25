export async function register(): Promise<void> {
  // Runs once when the Next.js server boots (node runtime only, not at build time).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBuildWorker } = await import("./worker/build-worker");
    startBuildWorker();
  }
}
