import { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface AdminContainerProps {
  isAdmin: boolean;
  children: ReactNode;
}

export const AdminContainer = ({ isAdmin, children }: AdminContainerProps) => {
  const navigate = useNavigate();
  const [adminCheckComplete, setAdminCheckComplete] = useState(false);

  // Theme is now controlled by user preference via ThemeProvider

  // Monitor when isAdmin changes from initial false state
  useEffect(() => {
    // Mark check as complete after first render cycle (allows Admin page to set isAdmin)
    if (!adminCheckComplete) {
      const timer = setTimeout(() => setAdminCheckComplete(true), 0);
      return () => clearTimeout(timer);
    }

    // Only redirect after admin check is complete
    if (adminCheckComplete && !isAdmin) {
      navigate("/");
    }
  }, [isAdmin, adminCheckComplete, navigate]);

  // Show loading or nothing while checking
  if (!adminCheckComplete || !isAdmin) {
    return null;
  }

  return <>{children}</>;
};
