import { redirect } from "next/navigation";

/** The Book is the front door. */
export default function RootPage() {
  redirect("/book");
}
