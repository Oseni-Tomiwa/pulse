import { NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "../theme/theme-provider";

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Pulse overview">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Pulse</span>
        </a>
        <nav aria-label="Primary navigation">
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/projects">Projects</NavLink>
        </nav>
        <p className="sidebar-context">Project → Service → Monitor</p>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar-label">Monitoring workspace</span>
          <ThemeToggle />
        </header>
        <main className="content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
