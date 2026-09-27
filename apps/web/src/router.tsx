import {
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
} from "react-router-dom";
import { AppShell } from "./layout/app-shell";
import { MonitorDetailsPage } from "./pages/monitor-details-page";
import { NotFoundPage } from "./pages/not-found-page";
import { OverviewPage } from "./pages/overview-page";
import { ProjectDetailsPage } from "./pages/project-details-page";
import { ProjectsPage } from "./pages/projects-page";
import { ServiceDetailsPage } from "./pages/service-details-page";

const routes: RouteObject[] = [{
  path: "/",
  element: <AppShell />,
  children: [
    { index: true, element: <OverviewPage /> },
    { path: "projects", element: <ProjectsPage /> },
    { path: "projects/:projectId", element: <ProjectDetailsPage /> },
    { path: "services/:serviceId", element: <ServiceDetailsPage /> },
    { path: "monitors/:monitorId", element: <MonitorDetailsPage /> },
    { path: "*", element: <NotFoundPage /> },
  ],
}];

export function createAppRouter(initialEntries?: string[]) {
  return initialEntries
    ? createMemoryRouter(routes, { initialEntries })
    : createBrowserRouter(routes);
}
