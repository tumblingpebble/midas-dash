import { useSettings } from "../hooks/useSettings"

export function SettingsPage() {
  const { settings, setEnableExplain } = useSettings()

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h2 className="text-lg font-semibold text-slate-100">Settings</h2>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-sm font-semibold text-slate-200">Responsive Breakpoints</div>
          <p className="mt-1 text-sm text-slate-400">
            This project includes explicit media queries for{" "}
            <code className="text-slate-200">sm</code>,{" "}
            <code className="text-slate-200">md</code>,{" "}
            <code className="text-slate-200">lg</code>. The badge in the header updates
            based on your screen width.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-sm font-semibold text-slate-200">ML Explainability</div>
          <p className="mt-1 text-sm text-slate-400">
            When enabled, the app requests model explanation data (global feature importances)
            and shows an "Explain" panel in results.
          </p>

          <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3">
            <div>
              <div className="text-sm font-medium text-slate-100">Enable ML Explain</div>
              <div className="text-xs text-slate-400">Adds explain=1 to the gateway request</div>
            </div>

            <input
              type="checkbox"
              checked={settings.enableExplain}
              onChange={(e) => setEnableExplain(e.target.checked)}
              className="h-5 w-5 accent-orange-500"
            />
          </label>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 lg:col-span-2">
          <div className="text-sm font-semibold text-slate-200">API</div>
          <p className="mt-1 text-sm text-slate-400">
            In local development, requests to <code className="text-slate-200">/api</code>{" "}
            are proxied to the gateway service via Vite. In cloud deployment, the same client
            will target the cloud gateway URL.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 lg:col-span-2">
          <div className="text-sm font-semibold text-slate-200">Status / About</div>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Frontend
              </div>
              <div className="mt-1 text-sm text-slate-200">
                React + TypeScript + Vite + Tailwind CSS
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Backend
              </div>
              <div className="mt-1 text-sm text-slate-200">
                FastAPI microservices: context, recommender, gateway, sentiment
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                DevOps
              </div>
              <div className="mt-1 text-sm text-slate-200">
                Docker Compose, GitHub Actions CI, Trivy scans, gitleaks, SBOM artifacts
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Cloud
              </div>
              <div className="mt-1 text-sm text-slate-200">
                Artifact Registry + Cloud Run + OIDC / Workload Identity Federation
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 lg:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                History behavior
              </div>
              <div className="mt-1 text-sm text-slate-200">
                Run history now stores full snapshots so previous analyses can be reopened from the
                History page.
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}