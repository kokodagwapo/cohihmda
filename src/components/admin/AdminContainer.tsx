import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/components/theme-provider';

interface AdminContainerProps {
  isAdmin: boolean;
  children: ReactNode;
}

export const AdminContainer = ({ isAdmin, children }: AdminContainerProps) => {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const [adminCheckComplete, setAdminCheckComplete] = useState(false);

  // Force light theme for admin page
  useEffect(() => {
    setTheme('light');
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    localStorage.setItem('vite-ui-theme', 'light');
  }, [setTheme]);

  // Monitor when isAdmin changes from initial false state
  useEffect(() => {
    // Mark check as complete after first render cycle (allows Admin page to set isAdmin)
    if (!adminCheckComplete) {
      const timer = setTimeout(() => setAdminCheckComplete(true), 0);
      return () => clearTimeout(timer);
    }
    
    // Only redirect after admin check is complete
    if (adminCheckComplete && !isAdmin) {
      navigate('/');
    }
  }, [isAdmin, adminCheckComplete, navigate]);

  // Show loading or nothing while checking
  if (!adminCheckComplete || !isAdmin) {
    return null;
  }

  return <>{children}</>;
};

