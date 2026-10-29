import type { Role } from "./enums.js";

/** The signed-in person, as returned by the auth endpoints (T05). Never contains credentials. */
export interface AuthUserDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: Role;
  /** The account has a local password (so "Change password" applies). */
  hasPassword: boolean;
  /** The account is linked to a Google identity. */
  hasGoogle: boolean;
}

/** The customer record of a `CUSTOMER` user. */
export interface AuthCustomerDto {
  id: string;
  phone: string | null;
}

/** `GET /api/v1/auth/me`. */
export interface AuthMeDto {
  user: AuthUserDto;
  customer?: AuthCustomerDto;
}

/** `POST /api/v1/auth/register` and `POST /api/v1/auth/login`. */
export interface AuthSessionDto {
  user: AuthUserDto;
}

/** `POST /api/v1/auth/google`. */
export interface GoogleAuthDto {
  user: AuthUserDto;
  /** True when this sign-in created the account. */
  isNewUser: boolean;
}

/** The home page for each role, used after sign-in and by the route guards. */
export const ROLE_HOME_PATH = {
  BUSINESS_ADMIN: "/app/dashboard",
  CUSTOMER: "/portal",
} as const satisfies Record<Role, string>;
