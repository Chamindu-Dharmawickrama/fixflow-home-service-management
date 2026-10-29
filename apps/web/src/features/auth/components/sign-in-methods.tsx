import type { AuthUserDto } from "@fixflow/shared";

import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";

/** Name, email and how the person signs in: the account summary shown on the admin and portal home pages. */
export function AccountSummary({ user }: { user: AuthUserDto }) {
  return (
    <DescriptionList>
      <DescriptionItem term="Name">{user.name}</DescriptionItem>
      <DescriptionItem term="Email address">{user.email}</DescriptionItem>
      <DescriptionItem term="Sign-in methods">
        <ul className="flex flex-col gap-1">
          <li>
            {user.hasPassword ? "Email and password: set up" : "Email and password: not set up"}
          </li>
          <li>{user.hasGoogle ? "Google: linked" : "Google: not linked"}</li>
        </ul>
      </DescriptionItem>
    </DescriptionList>
  );
}
