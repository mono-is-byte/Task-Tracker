import { redirect } from "next/navigation";

/** Change request Phase 4: user management moved to the dedicated /users page
 *  (visible to Admins and Project Managers). Old bookmarks keep working. */
export default function LegacyAdminUsersPage() {
  redirect("/users");
}
