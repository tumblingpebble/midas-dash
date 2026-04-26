import { NavLink } from "react-router-dom"
import midasLogo from "../assets/brand/midas-logo-navbar-v2.png"

const linkBase =
  "flex-1 rounded-xl px-3 py-2 text-center text-sm font-medium transition border sm:flex-none"
const inactive =
  "border-slate-700 text-slate-300 hover:border-amber-300/70 hover:text-amber-100"
const active =
  "border-[#F8D57A] text-[#FFF4D6] bg-[#F8D57A]/10 shadow-[0_0_18px_rgba(248,213,122,0.12)]"

export function NavBar() {
  return (
    <header className="sticky top-0 z-10 w-full overflow-x-hidden border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-wrap items-center gap-3 px-4 py-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <NavLink
            to="/"
            end
            className="flex min-w-0 shrink-0 items-center"
            aria-label="MIDAS home"
          >
            <img
              src={midasLogo}
              alt="MIDAS"
              className="h-10 w-auto max-w-[220px] object-contain sm:h-12 sm:max-w-[320px]"
            />
          </NavLink>

          <div className="bp-badge rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300" />
        </div>

        <nav className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
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