import { redirect } from "next/navigation";

/** Reports overview lives at `/`. Keep `/reports` as a stable alias. */
export default function ReportsIndexPage() {
  redirect("/");
}
