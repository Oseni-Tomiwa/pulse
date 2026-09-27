import { Link } from "react-router-dom";
import { PageHeader } from "./page-header";

export function NotFoundPage() {
  return (
    <>
      <PageHeader
        eyebrow="404"
        title="Page not found"
        description="The requested Pulse page does not exist."
      />
      <Link className="text-link" to="/">Return to Overview</Link>
    </>
  );
}
