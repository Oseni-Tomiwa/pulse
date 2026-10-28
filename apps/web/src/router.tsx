import {
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
} from "react-router-dom";
import { createPulseApiClient, type PulseApiClient } from "./api/client";
import { LiveRefresh } from "./live/live-refresh";
import { AppShell } from "./layout/app-shell";
import { IncidentDetailsPage } from "./pages/incident-details-page";
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
      { index: true, element: <LiveRefresh><OverviewPage apiClient={apiClient} /></LiveRefresh> },
      { path: "projects", element: <ProjectsPage apiClient={apiClient} /> },
      { path: "projects/:projectId", element: <ProjectDetailsPage apiClient={apiClient} /> },
      { path: "services/:serviceId", element: <LiveRefresh><ServiceDetailsPage apiClient={apiClient} /></LiveRefresh> },
      { path: "incidents/:incidentId", element: <IncidentDetailsPage apiClient={apiClient} /> },
      { path: "monitors/:monitorId", element: <LiveRefresh><MonitorDetailsPage apiClient={apiClient} /></LiveRefresh> },
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
