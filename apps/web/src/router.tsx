import {
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
} from "react-router-dom";
import { createPulseApiClient, type PulseApiClient } from "./api/client";
import { AppShell } from "./layout/app-shell";
import { MonitorDetailsPage } from "./pages/monitor-details-page";
import { NotFoundPage } from "./pages/not-found-page";
import { OverviewPage } from "./pages/overview-page";
import { ProjectDetailsPage } from "./pages/project-details-page";
import { ProjectsPage } from "./pages/projects-page";
import { ServiceDetailsPage } from "./pages/service-details-page";

function createRoutes(apiClient: PulseApiClient): RouteObject[] {
  return [{
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "projects", element: <ProjectsPage apiClient={apiClient} /> },
      { path: "projects/:projectId", element: <ProjectDetailsPage apiClient={apiClient} /> },
      { path: "services/:serviceId", element: <ServiceDetailsPage apiClient={apiClient} /> },
      { path: "monitors/:monitorId", element: <MonitorDetailsPage apiClient={apiClient} /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  }];
}

export function createAppRouter(
  initialEntries?: string[],
  apiClient: PulseApiClient = createPulseApiClient(),
) {
  const routes = createRoutes(apiClient);
  return initialEntries
    ? createMemoryRouter(routes, { initialEntries })
    : createBrowserRouter(routes);
}
