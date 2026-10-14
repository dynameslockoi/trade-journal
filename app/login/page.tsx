import { AuthCard } from "@/components/auth-card";

/**
 * Sign in and sign up share one page (see `components/auth-card.tsx`). Both URLs still exist and
 * both open on their own panel, so every link and redirect that already points at `/login` or
 * `/signup` keeps working — switching between the two panels afterwards is a state change on this
 * one page rather than a navigation.
 */
export default function Login() {
  return <AuthCard initialMode="signin" />;
}
