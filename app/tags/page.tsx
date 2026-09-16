import { redirect } from "next/navigation";

/** Tags moved in with strategies; the old address stays valid for bookmarks and stale links. */
export default function Tags() {
  redirect("/strategies");
}
