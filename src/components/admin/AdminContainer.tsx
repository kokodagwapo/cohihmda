import { ReactNode } from "react";

/**
 * Layout shell for the admin page. Access control is handled by ProtectedRoute (adminOnly);
 * avoid a second gate here — the old isAdmin + setTimeout(null) pattern caused a blank /admin on first paint.
 */
interface AdminContainerProps {
  children: ReactNode;
}

export const AdminContainer = ({ children }: AdminContainerProps) => {
  return <>{children}</>;
};
