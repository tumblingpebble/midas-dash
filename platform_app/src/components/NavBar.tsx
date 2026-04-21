import { NavLink } from "react-router-dom"

const linkBase =
  "flex-1 rounded-xl px-3 py-2 text-center text-sm font-medium transition border sm:flex-none"
const inactive =
  "border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white"
const active =
  "border-orange-500 text-white bg-orange-500/10"

export function NavBar() {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="text-xl font-bold tracking-wide text-orange-500 sm:text-2xl">
            MIDAS DASH
          </div>
          <div className="bp-badge rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300" />
        </div>

        <nav className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${linkBase} ${isActive ? active : inactive}`
            }
          >
            Run
          </NavLink>
          <NavLink
            to="/history"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? active : inactive}`
            }
          >
            History
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `${linkBase} ${isActive ? active : inactive}`
            }
          >
            Settings
          </NavLink>
        </nav>
      </div>
    </header>
  )
}