import type { AuthCustomerDto, AuthMeDto, AuthUserDto, Role } from "@fixflow/shared";

/** The columns the serializers read. Callers select exactly these, so nothing else leaks by accident. */
export interface AuthUserRecord {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: Role;
  passwordHash: string | null;
  googleSubject: string | null;
}

export const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  role: true,
  passwordHash: true,
  googleSubject: true,
} as const;

/**
 * The signed-in person as the browser sees them. The password hash and the Google subject are
 * reduced to two booleans; neither value ever leaves the server.
 */
export function toAuthUserDto(user: AuthUserRecord): AuthUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: user.role,
    hasPassword: user.passwordHash !== null,
    hasGoogle: user.googleSubject !== null,
  };
}

export function toAuthMeDto(
  user: AuthUserRecord,
  customer: { id: string; phone: string | null } | null,
): AuthMeDto {
  const customerDto: AuthCustomerDto | undefined =
    customer === null ? undefined : { id: customer.id, phone: customer.phone };
  return { user: toAuthUserDto(user), ...(customerDto !== undefined && { customer: customerDto }) };
}
