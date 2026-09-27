import { RouterProvider } from "react-router-dom";
import { createAppRouter } from "./router";
import { ThemeProvider } from "./theme/theme-provider";

const router = createAppRouter();

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
